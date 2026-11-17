package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore implements Store using PostgreSQL via pgxpool.
type PostgresStore struct {
	pool *pgxpool.Pool
}

// NewPostgresStore establishes a connection pool and runs auto-migrations.
func NewPostgresStore(ctx context.Context, connString string) (*PostgresStore, error) {
	config, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, fmt.Errorf("invalid postgres connection string: %w", err)
	}

	config.MaxConns = 25
	config.MinConns = 2
	config.MaxConnLifetime = 1 * time.Hour
	config.MaxConnIdleTime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create pgxpool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	store := &PostgresStore{pool: pool}
	if err := store.autoMigrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to run postgres migrations: %w", err)
	}

	return store, nil
}

func (p *PostgresStore) autoMigrate(ctx context.Context) error {
	schema := `
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

	CREATE TABLE IF NOT EXISTS sessions (
		token TEXT PRIMARY KEY,
		username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

	CREATE TABLE IF NOT EXISTS friendships (
		id TEXT PRIMARY KEY,
		requester TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
		receiver TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
		status TEXT NOT NULL,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester);
	CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships(receiver);
	CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

	CREATE TABLE IF NOT EXISTS messages (
		id BIGSERIAL PRIMARY KEY,
		msg_id TEXT,
		type TEXT NOT NULL,
		room TEXT NOT NULL,
		sender TEXT NOT NULL,
		content TEXT,
		data JSONB,
		timestamp BIGINT NOT NULL
	);

	ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_id TEXT;
	ALTER TABLE messages ADD COLUMN IF NOT EXISTS data JSONB;

	CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp ON messages(room, timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id);

	CREATE TABLE IF NOT EXISTS channels (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		type TEXT NOT NULL,
		topic TEXT NOT NULL DEFAULT '',
		created_by TEXT NOT NULL DEFAULT 'system',
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_channels_created_at ON channels(created_at ASC);
	`

	if _, err := p.pool.Exec(ctx, schema); err != nil {
		return err
	}

	// Clean up legacy system-seeded channels while leaving user-created channels intact
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM channels WHERE LOWER(created_by) = 'system' AND id IN ('general', 'dev-chat', 'gaming')`,
	); err != nil {
		return err
	}

	// Ensure default channels (random, voice-lounge) exist and have up-to-date metadata
	for _, ch := range defaultChannels() {
		_, err := p.pool.Exec(ctx,
			`INSERT INTO channels (id, name, type, topic, created_by, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (id) DO NOTHING`,
			ch.ID, ch.Name, ch.Type, ch.Topic, ch.CreatedBy, ch.CreatedAt,
		)
		if err != nil {
			return err
		}
		_, err = p.pool.Exec(ctx,
			`UPDATE channels SET name = $2, topic = $3 WHERE id = $1 AND LOWER(created_by) = 'system'`,
			ch.ID, ch.Name, ch.Topic,
		)
		if err != nil {
			return err
		}
	}

	return nil
}

func (p *PostgresStore) Register(username, password string) (*User, string, error) {
	normUser := normalizeUsername(username)
	if len(normUser) < 3 {
		return nil, "", errors.New("Username must be at least 3 characters")
	}
	if len(password) < 6 {
		return nil, "", errors.New("Password must be at least 6 characters")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pwHash, err := hashPassword(password)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash password: %w", err)
	}

	user := &User{
		ID:           normUser,
		Username:     normUser,
		PasswordHash: pwHash,
		CreatedAt:    time.Now().UTC(),
	}

	// Insert user
	_, err = p.pool.Exec(ctx,
		`INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)`,
		user.ID, user.Username, user.PasswordHash, user.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			return nil, "", errors.New("Username is already taken")
		}
		return nil, "", fmt.Errorf("failed to insert user: %w", err)
	}

	token, err := generateToken()
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate token: %w", err)
	}

	_, err = p.pool.Exec(ctx,
		`INSERT INTO sessions (token, username, created_at) VALUES ($1, $2, $3)`,
		token, user.Username, time.Now().UTC(),
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to store session: %w", err)
	}

	return user, token, nil
}

func (p *PostgresStore) Login(username, password string) (*User, string, error) {
	normUser := normalizeUsername(username)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	user := &User{}
	err := p.pool.QueryRow(ctx,
		`SELECT id, username, password_hash, created_at FROM users WHERE username = $1`,
		normUser,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt)
	if err != nil {
		return nil, "", errors.New("Invalid username or password")
	}

	if !checkPassword(user.PasswordHash, password) {
		return nil, "", errors.New("Invalid username or password")
	}

	token, err := generateToken()
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate token: %w", err)
	}

	_, err = p.pool.Exec(ctx,
		`INSERT INTO sessions (token, username, created_at) VALUES ($1, $2, $3)`,
		token, user.Username, time.Now().UTC(),
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to store session: %w", err)
	}

	return user, token, nil
}

func (p *PostgresStore) AuthenticateToken(token string) (*User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	user := &User{}
	err := p.pool.QueryRow(ctx,
		`SELECT u.id, u.username, u.password_hash, u.created_at
		 FROM sessions s
		 JOIN users u ON s.username = u.username
		 WHERE s.token = $1`,
		token,
	).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("Invalid or expired session token")
		}
		return nil, fmt.Errorf("auth query failed: %w", err)
	}

	return user, nil
}

func (p *PostgresStore) UserExists(username string) bool {
	normUser := normalizeUsername(username)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var exists bool
	_ = p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)`, normUser).Scan(&exists)
	return exists
}

func (p *PostgresStore) SendFriendRequest(requester, receiver string) error {
	normReq := normalizeUsername(requester)
	normRec := normalizeUsername(receiver)

	if normReq == normRec {
		return errors.New("Cannot send friend request to yourself")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if !p.UserExists(normRec) {
		return errors.New("Target user does not exist")
	}

	key := friendshipKey(normReq, normRec)

	var existingRequester, existingStatus string
	err := p.pool.QueryRow(ctx,
		`SELECT requester, status FROM friendships WHERE id = $1`,
		key,
	).Scan(&existingRequester, &existingStatus)

	if err == nil {
		if existingStatus == "accepted" {
			return errors.New("Already friends with this user")
		}
		if existingRequester == normReq {
			return errors.New("Friend request already sent")
		}
		// If opposite user sent it, auto-accept
		_, err := p.pool.Exec(ctx,
			`UPDATE friendships SET status = 'accepted' WHERE id = $1`,
			key,
		)
		return err
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	_, err = p.pool.Exec(ctx,
		`INSERT INTO friendships (id, requester, receiver, status, created_at) VALUES ($1, $2, $3, 'pending', $4)`,
		key, normReq, normRec, time.Now().UTC(),
	)
	return err
}

func (p *PostgresStore) AcceptFriendRequest(receiver, requester string) error {
	normRec := normalizeUsername(receiver)
	normReq := normalizeUsername(requester)
	key := friendshipKey(normRec, normReq)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := p.pool.Exec(ctx,
		`UPDATE friendships SET status = 'accepted' WHERE id = $1 AND receiver = $2 AND requester = $3 AND status = 'pending'`,
		key, normRec, normReq,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("No pending friend request found from this user")
	}
	return nil
}

func (p *PostgresStore) RejectFriendRequest(currentUser, otherUser string) error {
	normCur := normalizeUsername(currentUser)
	normOth := normalizeUsername(otherUser)
	key := friendshipKey(normCur, normOth)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := p.pool.Exec(ctx,
		`DELETE FROM friendships WHERE id = $1 AND status = 'pending' AND (requester = $2 OR receiver = $2)`,
		key, normCur,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("Pending friend request not found")
	}
	return nil
}

func (p *PostgresStore) RemoveFriend(currentUser, friendUser string) error {
	normCur := normalizeUsername(currentUser)
	normFri := normalizeUsername(friendUser)
	key := friendshipKey(normCur, normFri)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := p.pool.Exec(ctx,
		`DELETE FROM friendships WHERE id = $1 AND status = 'accepted' AND (requester = $2 OR receiver = $2)`,
		key, normCur,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("Friendship not found")
	}
	return nil
}

func (p *PostgresStore) GetFriends(username string, isOnline func(string) bool) FriendsData {
	normUser := normalizeUsername(username)

	res := FriendsData{
		Friends:  make([]FriendEntry, 0),
		Incoming: make([]RequestEntry, 0),
		Outgoing: make([]RequestEntry, 0),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := p.pool.Query(ctx,
		`SELECT requester, receiver, status, created_at FROM friendships WHERE requester = $1 OR receiver = $1`,
		normUser,
	)
	if err != nil {
		log.Printf("[PostgresStore] Failed to query friendships: %v", err)
		return res
	}
	defer rows.Close()

	for rows.Next() {
		var req, rec, status string
		var createdAt time.Time
		if err := rows.Scan(&req, &rec, &status, &createdAt); err != nil {
			continue
		}

		if status == "accepted" {
			friendName := rec
			if rec == normUser {
				friendName = req
			}
			res.Friends = append(res.Friends, FriendEntry{
				Username: friendName,
				Online:   isOnline(friendName),
			})
		} else if status == "pending" {
			if rec == normUser {
				res.Incoming = append(res.Incoming, RequestEntry{
					Username:  req,
					From:      req,
					CreatedAt: createdAt,
				})
			} else if req == normUser {
				res.Outgoing = append(res.Outgoing, RequestEntry{
					Username:  rec,
					To:        rec,
					CreatedAt: createdAt,
				})
			}
		}
	}

	return res
}

func (p *PostgresStore) SaveMessage(msg Message) error {
	if msg.ID == "" {
		msg.ID = generateMessageID()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var dataBytes []byte
	if msg.Data != nil {
		dataBytes, _ = json.Marshal(msg.Data)
	}

	_, err := p.pool.Exec(ctx,
		`INSERT INTO messages (msg_id, type, room, sender, content, data, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		msg.ID, msg.Type, msg.Room, msg.Sender, msg.Content, dataBytes, msg.Timestamp,
	)
	return err
}

func (p *PostgresStore) GetMessages(room string, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 50
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := p.pool.Query(ctx,
		`SELECT COALESCE(msg_id, ''), type, room, sender, COALESCE(content, ''), data, timestamp
		 FROM messages
		 WHERE room = $1
		 ORDER BY timestamp DESC, id DESC
		 LIMIT $2`,
		room, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var descMessages []Message
	for rows.Next() {
		var m Message
		var dataBytes []byte
		if err := rows.Scan(&m.ID, &m.Type, &m.Room, &m.Sender, &m.Content, &dataBytes, &m.Timestamp); err != nil {
			continue
		}
		if len(dataBytes) > 0 {
			_ = json.Unmarshal(dataBytes, &m.Data)
		}
		descMessages = append(descMessages, m)
	}

	// Reverse to chronological order
	res := make([]Message, len(descMessages))
	for i, m := range descMessages {
		res[len(descMessages)-1-i] = m
	}
	return res, nil
}

func (p *PostgresStore) EditMessage(msgID, room, requestingUser, newContent string) (*Message, error) {
	trimmed := strings.TrimSpace(newContent)
	if trimmed == "" {
		return nil, errors.New("Message content cannot be empty")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var m Message
	var dataBytes []byte
	err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(msg_id, ''), type, room, sender, COALESCE(content, ''), data, timestamp
		 FROM messages
		 WHERE msg_id = $1 AND room = $2
		 LIMIT 1`,
		msgID, room,
	).Scan(&m.ID, &m.Type, &m.Room, &m.Sender, &m.Content, &dataBytes, &m.Timestamp)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}

	if !strings.EqualFold(m.Sender, requestingUser) {
		return nil, fmt.Errorf("%w: Only the author can edit this message", ErrMessageForbidden)
	}

	if len(dataBytes) > 0 {
		_ = json.Unmarshal(dataBytes, &m.Data)
	}
	dataMap := ensureDataMap(m.Data)
	dataMap["edited"] = true
	m.Content = trimmed
	m.Data = dataMap

	updatedDataBytes, err := json.Marshal(dataMap)
	if err != nil {
		return nil, err
	}

	_, err = p.pool.Exec(ctx,
		`UPDATE messages SET content = $1, data = $2 WHERE msg_id = $3 AND room = $4`,
		m.Content, updatedDataBytes, msgID, room,
	)
	if err != nil {
		return nil, err
	}

	return &m, nil
}

func (p *PostgresStore) DeleteMessage(msgID, room, requestingUser string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var sender string
	err := p.pool.QueryRow(ctx,
		`SELECT sender FROM messages WHERE msg_id = $1 AND room = $2 LIMIT 1`,
		msgID, room,
	).Scan(&sender)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMessageNotFound
		}
		return err
	}

	if !strings.EqualFold(sender, requestingUser) {
		return fmt.Errorf("%w: Only the author can delete this message", ErrMessageForbidden)
	}

	tag, err := p.pool.Exec(ctx,
		`DELETE FROM messages WHERE msg_id = $1 AND room = $2`,
		msgID, room,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrMessageNotFound
	}
	return nil
}

func (p *PostgresStore) ToggleReaction(msgID, room, username, emoji string) (*Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var m Message
	var dataBytes []byte
	err := p.pool.QueryRow(ctx,
		`SELECT COALESCE(msg_id, ''), type, room, sender, COALESCE(content, ''), data, timestamp
		 FROM messages
		 WHERE msg_id = $1 AND room = $2
		 LIMIT 1`,
		msgID, room,
	).Scan(&m.ID, &m.Type, &m.Room, &m.Sender, &m.Content, &dataBytes, &m.Timestamp)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrMessageNotFound
		}
		return nil, err
	}

	if len(dataBytes) > 0 {
		_ = json.Unmarshal(dataBytes, &m.Data)
	}
	updatedMap := toggleReactionInData(m.Data, username, emoji)
	m.Data = updatedMap

	updatedDataBytes, err := json.Marshal(updatedMap)
	if err != nil {
		return nil, err
	}

	_, err = p.pool.Exec(ctx,
		`UPDATE messages SET data = $1 WHERE msg_id = $2 AND room = $3`,
		updatedDataBytes, msgID, room,
	)
	if err != nil {
		return nil, err
	}

	return &m, nil
}

func (p *PostgresStore) SearchMessages(room, query string, limit int) ([]Message, error) {
	q := strings.TrimSpace(query)
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}

	res := make([]Message, 0)
	if q == "" {
		return res, nil
	}

	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
	pattern := "%" + escaped + "%"

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := p.pool.Query(ctx,
		`SELECT COALESCE(msg_id, ''), type, room, sender, COALESCE(content, ''), data, timestamp
		 FROM messages
		 WHERE room = $1 AND content ILIKE $2 ESCAPE '\'
		 ORDER BY timestamp DESC, id DESC
		 LIMIT $3`,
		room, pattern, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var m Message
		var dataBytes []byte
		if err := rows.Scan(&m.ID, &m.Type, &m.Room, &m.Sender, &m.Content, &dataBytes, &m.Timestamp); err != nil {
			continue
		}
		if len(dataBytes) > 0 {
			_ = json.Unmarshal(dataBytes, &m.Data)
		}
		res = append(res, m)
	}
	return res, nil
}

func (p *PostgresStore) GetChannels() ([]Channel, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := p.pool.Query(ctx,
		`SELECT id, name, type, topic, created_by, created_at FROM channels ORDER BY created_at ASC, id ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make([]Channel, 0)
	for rows.Next() {
		var ch Channel
		if err := rows.Scan(&ch.ID, &ch.Name, &ch.Type, &ch.Topic, &ch.CreatedBy, &ch.CreatedAt); err != nil {
			continue
		}
		res = append(res, ch)
	}
	return res, nil
}

func (p *PostgresStore) CreateChannel(ch Channel) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if ch.CreatedAt.IsZero() {
		ch.CreatedAt = time.Now().UTC()
	}

	_, err := p.pool.Exec(ctx,
		`INSERT INTO channels (id, name, type, topic, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		ch.ID, ch.Name, ch.Type, ch.Topic, ch.CreatedBy, ch.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique constraint") {
			return ErrChannelExists
		}
		return err
	}
	return nil
}

func (p *PostgresStore) DeleteChannel(id, requestingUser string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var createdBy string
	err := p.pool.QueryRow(ctx, `SELECT created_by FROM channels WHERE id = $1`, id).Scan(&createdBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChannelNotFound
		}
		return err
	}

	if isDefaultProtectedChannel(id, createdBy) {
		return fmt.Errorf("%w: Default rooms cannot be deleted", ErrChannelForbidden)
	}
	if !strings.EqualFold(createdBy, requestingUser) {
		return fmt.Errorf("%w: Only the creator of this room can delete it", ErrChannelForbidden)
	}

	tag, err := p.pool.Exec(ctx, `DELETE FROM channels WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrChannelNotFound
	}
	return nil
}

func (p *PostgresStore) Close() error {
	p.pool.Close()
	return nil
}
