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
		type TEXT NOT NULL,
		room TEXT NOT NULL,
		sender TEXT NOT NULL,
		content TEXT,
		data JSONB,
		timestamp BIGINT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp ON messages(room, timestamp DESC);

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

	var count int
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM channels`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var dataBytes []byte
	if msg.Data != nil {
		dataBytes, _ = json.Marshal(msg.Data)
	}

	_, err := p.pool.Exec(ctx,
		`INSERT INTO messages (type, room, sender, content, data, timestamp) VALUES ($1, $2, $3, $4, $5, $6)`,
		msg.Type, msg.Room, msg.Sender, msg.Content, dataBytes, msg.Timestamp,
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
		`SELECT type, room, sender, content, data, timestamp FROM messages WHERE room = $1 ORDER BY timestamp DESC LIMIT $2`,
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
		if err := rows.Scan(&m.Type, &m.Room, &m.Sender, &m.Content, &dataBytes, &m.Timestamp); err != nil {
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

func (p *PostgresStore) DeleteChannel(id string) error {
	if id == "general" {
		return errors.New("Cannot delete the default #general channel")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

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
