package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// User represents a registered user account.
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"passwordHash"`
	AvatarURL    string    `json:"avatarUrl,omitempty"`
	Status       string    `json:"status,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

// UserProfile represents public user profile & presence metadata.
type UserProfile struct {
	Username  string `json:"username"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	Status    string `json:"status"` // "online" | "away" | "dnd"
}

func isValidUserStatus(s string) bool {
	return s == "online" || s == "away" || s == "dnd"
}

func normalizeUserStatus(s string) string {
	lower := strings.ToLower(strings.TrimSpace(s))
	if isValidUserStatus(lower) {
		return lower
	}
	return "online"
}

// Friendship represents a relationship between two users.
type Friendship struct {
	ID        string    `json:"id"`
	Requester string    `json:"requester"` // username who sent the request
	Receiver  string    `json:"receiver"`  // username who received the request
	Status    string    `json:"status"`    // "pending" | "accepted"
	CreatedAt time.Time `json:"createdAt"`
}

var (
	ErrChannelExists     = errors.New("Channel already exists")
	ErrChannelNotFound   = errors.New("Channel not found")
	ErrChannelForbidden  = errors.New("Forbidden")
	ErrChannelNotPrivate = errors.New("Channel is not private")
	ErrUserNotFound      = errors.New("User not found")
	ErrMessageNotFound   = errors.New("Message not found")
	ErrMessageForbidden  = errors.New("Forbidden")
)

// Channel represents a text or voice channel in the workspace.
type Channel struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"` // "text" | "voice"
	Topic     string    `json:"topic,omitempty"`
	CreatedBy string    `json:"createdBy,omitempty"`
	IsPrivate bool      `json:"isPrivate,omitempty"`
	Members   []string  `json:"members,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

func normalizeMembers(creator string, rawMembers []string) []string {
	seen := make(map[string]bool)
	res := make([]string, 0, len(rawMembers)+1)
	if c := normalizeUsername(creator); c != "" {
		seen[c] = true
		res = append(res, c)
	}
	for _, m := range rawMembers {
		nm := normalizeUsername(m)
		if nm != "" && !seen[nm] {
			seen[nm] = true
			res = append(res, nm)
		}
	}
	return res
}

func isChannelMember(ch *Channel, username string) bool {
	if ch == nil || !ch.IsPrivate {
		return true
	}
	norm := normalizeUsername(username)
	if norm == "" {
		return false
	}
	if strings.EqualFold(ch.CreatedBy, norm) {
		return true
	}
	for _, m := range ch.Members {
		if strings.EqualFold(m, norm) {
			return true
		}
	}
	return false
}

func defaultChannels() []Channel {
	now := time.Now().UTC()
	return []Channel{
		{ID: "random", Name: "Random", Type: "text", Topic: "Open group chat", CreatedBy: "system", CreatedAt: now},
		{ID: "voice-lounge", Name: "Voice Lounge", Type: "voice", Topic: "Drop-in voice and video group", CreatedBy: "system", CreatedAt: now.Add(time.Millisecond)},
	}
}

func isLegacySystemChannel(id string) bool {
	return id == "general" || id == "dev-chat" || id == "gaming"
}

func isDefaultProtectedChannel(id, createdBy string) bool {
	return strings.EqualFold(createdBy, "system") || id == "random" || id == "voice-lounge"
}

func slugifyChannelID(name string) string {
	lower := strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastDash := false
	for _, r := range lower {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
		} else if !lastDash && b.Len() > 0 {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

// StoreData represents the persisted JSON structure for FileStore.
type StoreData struct {
	Users       map[string]*User       `json:"users"`              // normalized username -> User
	Friendships map[string]*Friendship `json:"friendships"`        // canonical key -> Friendship
	Tokens      map[string]string      `json:"tokens"`             // token -> normalized username
	Messages    []Message              `json:"messages,omitempty"` // chat message history
	Channels    []Channel              `json:"channels,omitempty"` // custom & default channels
}

// Store is the common interface implemented by FileStore and PostgresStore.
type Store interface {
	Register(username, password string) (*User, string, error)
	Login(username, password string) (*User, string, error)
	AuthenticateToken(token string) (*User, error)
	UserExists(username string) bool
	SendFriendRequest(requester, receiver string) error
	AcceptFriendRequest(receiver, requester string) error
	RejectFriendRequest(currentUser, otherUser string) error
	RemoveFriend(currentUser, friendUser string) error
	GetFriends(username string, isOnline func(string) bool) FriendsData
	SaveMessage(msg Message) error
	GetMessages(room string, limit int) ([]Message, error)
	EditMessage(msgID, room, requestingUser, newContent string) (*Message, error)
	DeleteMessage(msgID, room, requestingUser string) error
	ToggleReaction(msgID, room, username, emoji string) (*Message, error)
	SearchMessages(room, query string, limit int) ([]Message, error)
	GetChannels() ([]Channel, error)
	GetChannel(id string) (*Channel, error)
	GetChannelsForUser(username string) ([]Channel, error)
	CreateChannel(ch Channel) error
	InviteToChannel(channelID, requestingUser, targetUser string) (*Channel, error)
	DeleteChannel(id, requestingUser string) error
	GetProfile(username string) (UserProfile, error)
	UpdateProfile(username string, avatarURL *string, status *string) (UserProfile, error)
	GetAllProfiles() (map[string]UserProfile, error)
	Close() error
}

// FileStore handles thread-safe data persistence using an atomic JSON file or in-memory.
type FileStore struct {
	mu       sync.RWMutex
	filePath string
	data     StoreData
}

// NewFileStore creates or loads a file-backed store. If filePath is empty, runs purely in-memory.
func NewFileStore(filePath string) (*FileStore, error) {
	s := &FileStore{
		filePath: filePath,
		data: StoreData{
			Users:       make(map[string]*User),
			Friendships: make(map[string]*Friendship),
			Tokens:      make(map[string]string),
			Messages:    make([]Message, 0),
		},
	}

	if filePath != "" {
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			return nil, fmt.Errorf("failed to create data directory: %w", err)
		}

		if _, err := os.Stat(filePath); err == nil {
			bytes, err := os.ReadFile(filePath)
			if err != nil {
				return nil, fmt.Errorf("failed to read store file: %w", err)
			}
			if len(bytes) > 0 {
				if err := json.Unmarshal(bytes, &s.data); err != nil {
					return nil, fmt.Errorf("failed to parse store file: %w", err)
				}
			}
		}
		// Ensure non-nil maps
		if s.data.Users == nil {
			s.data.Users = make(map[string]*User)
		}
		if s.data.Friendships == nil {
			s.data.Friendships = make(map[string]*Friendship)
		}
		if s.data.Tokens == nil {
			s.data.Tokens = make(map[string]string)
		}
		if s.data.Messages == nil {
			s.data.Messages = make([]Message, 0)
		}
	}

	if s.reconcileDefaultChannelsLocked() && filePath != "" {
		_ = s.saveLocked()
	}

	return s, nil
}

// reconcileDefaultChannelsLocked cleans up legacy system-seeded channels (general, dev-chat, gaming)
// while preserving any user-created channels, and guarantees random and voice-lounge exist.
func (s *FileStore) reconcileDefaultChannelsLocked() bool {
	changed := false
	cleaned := make([]Channel, 0, len(s.data.Channels)+2)
	present := make(map[string]bool)

	for _, ch := range s.data.Channels {
		if strings.EqualFold(ch.CreatedBy, "system") && isLegacySystemChannel(ch.ID) {
			changed = true
			continue
		}
		if ch.ID == "random" && strings.EqualFold(ch.CreatedBy, "system") {
			if ch.Name != "Random" || ch.Topic != "Open group chat" {
				ch.Name = "Random"
				ch.Topic = "Open group chat"
				changed = true
			}
		}
		if ch.ID == "voice-lounge" && strings.EqualFold(ch.CreatedBy, "system") {
			if ch.Name != "Voice Lounge" || ch.Topic != "Drop-in voice and video group" {
				ch.Name = "Voice Lounge"
				ch.Topic = "Drop-in voice and video group"
				changed = true
			}
		}
		cleaned = append(cleaned, ch)
		present[ch.ID] = true
	}

	var missingDefaults []Channel
	for _, def := range defaultChannels() {
		if !present[def.ID] {
			missingDefaults = append(missingDefaults, def)
			changed = true
		}
	}

	if len(missingDefaults) > 0 {
		cleaned = append(missingDefaults, cleaned...)
	}

	s.data.Channels = cleaned
	return changed
}

// NewStore creates a Store (FileStore) for backwards compatibility.
func NewStore(filePath string) (Store, error) {
	return NewFileStore(filePath)
}

func (s *FileStore) saveLocked() error {
	if s.filePath == "" {
		return nil
	}
	bytes, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmpFile := s.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, bytes, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, s.filePath)
}

func normalizeUsername(u string) string {
	return strings.ToLower(strings.TrimSpace(u))
}

func friendshipKey(u1, u2 string) string {
	u1 = normalizeUsername(u1)
	u2 = normalizeUsername(u2)
	if u1 < u2 {
		return u1 + ":" + u2
	}
	return u2 + ":" + u1
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt)
	hash := sha256.Sum256([]byte(saltHex + ":" + password))
	return saltHex + "$" + hex.EncodeToString(hash[:]), nil
}

func checkPassword(storedHash, password string) bool {
	parts := strings.Split(storedHash, "$")
	if len(parts) != 2 {
		return false
	}
	saltHex := parts[0]
	expectedHashHex := parts[1]

	expectedHash, err := hex.DecodeString(expectedHashHex)
	if err != nil {
		return false
	}

	actualHash := sha256.Sum256([]byte(saltHex + ":" + password))
	return subtle.ConstantTimeCompare(actualHash[:], expectedHash) == 1
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Register creates a new user account with a hashed password and returns an auth session token.
func (s *FileStore) Register(username, password string) (*User, string, error) {
	normUser := normalizeUsername(username)
	if len(normUser) < 3 {
		return nil, "", errors.New("Username must be at least 3 characters")
	}
	if len(password) < 6 {
		return nil, "", errors.New("Password must be at least 6 characters")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.data.Users[normUser]; exists {
		return nil, "", errors.New("Username is already taken")
	}

	pwHash, err := hashPassword(password)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash password: %w", err)
	}

	user := &User{
		ID:           normUser,
		Username:     normUser,
		PasswordHash: pwHash,
		Status:       "online",
		CreatedAt:    time.Now().UTC(),
	}
	s.data.Users[normUser] = user

	token, err := generateToken()
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate auth token: %w", err)
	}
	s.data.Tokens[token] = normUser

	if err := s.saveLocked(); err != nil {
		return nil, "", fmt.Errorf("failed to persist user: %w", err)
	}

	return user, token, nil
}

// Login verifies user credentials and returns a new session token.
func (s *FileStore) Login(username, password string) (*User, string, error) {
	normUser := normalizeUsername(username)

	s.mu.Lock()
	defer s.mu.Unlock()

	user, exists := s.data.Users[normUser]
	if !exists || !checkPassword(user.PasswordHash, password) {
		return nil, "", errors.New("Invalid username or password")
	}

	token, err := generateToken()
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate token: %w", err)
	}
	s.data.Tokens[token] = normUser

	if err := s.saveLocked(); err != nil {
		return nil, "", fmt.Errorf("failed to persist token: %w", err)
	}

	return user, token, nil
}

// AuthenticateToken resolves a bearer token to a User.
func (s *FileStore) AuthenticateToken(token string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	username, exists := s.data.Tokens[token]
	if !exists {
		return nil, errors.New("Invalid or expired session token")
	}

	user, exists := s.data.Users[username]
	if !exists {
		return nil, errors.New("User not found")
	}

	return user, nil
}

// UserExists checks if a username is registered.
func (s *FileStore) UserExists(username string) bool {
	normUser := normalizeUsername(username)
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, exists := s.data.Users[normUser]
	return exists
}

// SendFriendRequest creates a pending friend request from requester to receiver.
func (s *FileStore) SendFriendRequest(requester, receiver string) error {
	normReq := normalizeUsername(requester)
	normRec := normalizeUsername(receiver)

	if normReq == normRec {
		return errors.New("Cannot send friend request to yourself")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.data.Users[normRec]; !exists {
		return errors.New("Target user does not exist")
	}

	key := friendshipKey(normReq, normRec)
	if existing, exists := s.data.Friendships[key]; exists {
		if existing.Status == "accepted" {
			return errors.New("Already friends with this user")
		}
		if existing.Requester == normReq {
			return errors.New("Friend request already sent")
		}
		// If the receiver had previously sent a request, auto-accept
		existing.Status = "accepted"
		return s.saveLocked()
	}

	f := &Friendship{
		ID:        key,
		Requester: normReq,
		Receiver:  normRec,
		Status:    "pending",
		CreatedAt: time.Now().UTC(),
	}
	s.data.Friendships[key] = f
	return s.saveLocked()
}

// AcceptFriendRequest accepts an incoming pending friend request.
func (s *FileStore) AcceptFriendRequest(receiver, requester string) error {
	normRec := normalizeUsername(receiver)
	normReq := normalizeUsername(requester)

	s.mu.Lock()
	defer s.mu.Unlock()

	key := friendshipKey(normRec, normReq)
	f, exists := s.data.Friendships[key]
	if !exists || f.Status != "pending" || f.Receiver != normRec || f.Requester != normReq {
		return errors.New("No pending friend request found from this user")
	}

	f.Status = "accepted"
	return s.saveLocked()
}

// RejectFriendRequest declines or cancels a pending friend request.
func (s *FileStore) RejectFriendRequest(currentUser, otherUser string) error {
	normCur := normalizeUsername(currentUser)
	normOth := normalizeUsername(otherUser)

	s.mu.Lock()
	defer s.mu.Unlock()

	key := friendshipKey(normCur, normOth)
	f, exists := s.data.Friendships[key]
	if !exists || f.Status != "pending" {
		return errors.New("Pending friend request not found")
	}

	if f.Requester != normCur && f.Receiver != normCur {
		return errors.New("Unauthorized to reject this request")
	}

	delete(s.data.Friendships, key)
	return s.saveLocked()
}

// RemoveFriend deletes an accepted friendship between two users.
func (s *FileStore) RemoveFriend(currentUser, friendUser string) error {
	normCur := normalizeUsername(currentUser)
	normFri := normalizeUsername(friendUser)

	s.mu.Lock()
	defer s.mu.Unlock()

	key := friendshipKey(normCur, normFri)
	f, exists := s.data.Friendships[key]
	if !exists || f.Status != "accepted" {
		return errors.New("Friendship not found")
	}

	if f.Requester != normCur && f.Receiver != normCur {
		return errors.New("Unauthorized to remove this friendship")
	}

	delete(s.data.Friendships, key)
	return s.saveLocked()
}

// FriendEntry represents a friend in the friends list response.
type FriendEntry struct {
	Username  string `json:"username"`
	Online    bool   `json:"online"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	Status    string `json:"status,omitempty"`
}

// RequestEntry represents an incoming or outgoing pending request.
type RequestEntry struct {
	Username  string    `json:"username"`
	From      string    `json:"from,omitempty"`
	To        string    `json:"to,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// FriendsData contains all friend lists for a user.
type FriendsData struct {
	Friends  []FriendEntry  `json:"friends"`
	Incoming []RequestEntry `json:"incoming"`
	Outgoing []RequestEntry `json:"outgoing"`
}

// GetFriends returns accepted friends, incoming pending requests, and outgoing pending requests.
func (s *FileStore) GetFriends(username string, isOnline func(string) bool) FriendsData {
	normUser := normalizeUsername(username)

	s.mu.RLock()
	defer s.mu.RUnlock()

	res := FriendsData{
		Friends:  make([]FriendEntry, 0),
		Incoming: make([]RequestEntry, 0),
		Outgoing: make([]RequestEntry, 0),
	}

	buildFriendEntry := func(friendName string) FriendEntry {
		entry := FriendEntry{
			Username: friendName,
			Online:   isOnline(friendName),
			Status:   "online",
		}
		if u, ok := s.data.Users[friendName]; ok && u != nil {
			entry.AvatarURL = u.AvatarURL
			entry.Status = normalizeUserStatus(u.Status)
		}
		return entry
	}

	for _, f := range s.data.Friendships {
		if f.Status == "accepted" {
			if f.Requester == normUser {
				res.Friends = append(res.Friends, buildFriendEntry(f.Receiver))
			} else if f.Receiver == normUser {
				res.Friends = append(res.Friends, buildFriendEntry(f.Requester))
			}
		} else if f.Status == "pending" {
			if f.Receiver == normUser {
				res.Incoming = append(res.Incoming, RequestEntry{
					Username:  f.Requester,
					From:      f.Requester,
					CreatedAt: f.CreatedAt,
				})
			} else if f.Requester == normUser {
				res.Outgoing = append(res.Outgoing, RequestEntry{
					Username:  f.Receiver,
					To:        f.Receiver,
					CreatedAt: f.CreatedAt,
				})
			}
		}
	}

	return res
}

// SaveMessage appends a chat message to history.
func (s *FileStore) SaveMessage(msg Message) error {
	if msg.ID == "" {
		msg.ID = generateMessageID()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Messages = append(s.data.Messages, msg)
	return s.saveLocked()
}

// GetMessages returns the latest messages for a room in chronological order.
func (s *FileStore) GetMessages(room string, limit int) ([]Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if limit <= 0 {
		limit = 50
	}
	res := make([]Message, 0)
	for i := len(s.data.Messages) - 1; i >= 0 && len(res) < limit; i-- {
		if s.data.Messages[i].Room == room {
			res = append([]Message{s.data.Messages[i]}, res...)
		}
	}
	return res, nil
}

// ensureDataMap clones or converts Message.Data into a mutable map[string]any.
func ensureDataMap(data any) map[string]any {
	out := make(map[string]any)
	if data == nil {
		return out
	}
	if m, ok := data.(map[string]any); ok {
		for k, v := range m {
			out[k] = v
		}
		return out
	}
	if raw, err := json.Marshal(data); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

// toggleReactionInData toggles username in data["reactions"][emoji] and prunes empty entries.
func toggleReactionInData(data any, username, emoji string) map[string]any {
	m := ensureDataMap(data)
	reactions := make(map[string][]string)

	if rawReacts, exists := m["reactions"]; exists && rawReacts != nil {
		switch rm := rawReacts.(type) {
		case map[string][]string:
			for k, users := range rm {
				cp := make([]string, len(users))
				copy(cp, users)
				reactions[k] = cp
			}
		case map[string]any:
			for k, v := range rm {
				switch arr := v.(type) {
				case []string:
					cp := make([]string, len(arr))
					copy(cp, arr)
					reactions[k] = cp
				case []any:
					list := make([]string, 0, len(arr))
					for _, item := range arr {
						if u, ok := item.(string); ok && u != "" {
							list = append(list, u)
						}
					}
					if len(list) > 0 {
						reactions[k] = list
					}
				}
			}
		}
	}

	users := reactions[emoji]
	foundIdx := -1
	for i, u := range users {
		if strings.EqualFold(u, username) {
			foundIdx = i
			break
		}
	}

	if foundIdx >= 0 {
		users = append(users[:foundIdx], users[foundIdx+1:]...)
	} else {
		users = append(users, username)
	}

	if len(users) == 0 {
		delete(reactions, emoji)
	} else {
		reactions[emoji] = users
	}

	if len(reactions) == 0 {
		delete(m, "reactions")
	} else {
		m["reactions"] = reactions
	}
	return m
}

// EditMessage updates a message's content if requestingUser is its author and sets data.edited = true.
func (s *FileStore) EditMessage(msgID, room, requestingUser, newContent string) (*Message, error) {
	trimmed := strings.TrimSpace(newContent)
	if trimmed == "" {
		return nil, errors.New("Message content cannot be empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Messages {
		m := &s.data.Messages[i]
		if m.ID == msgID && m.Room == room {
			if !strings.EqualFold(m.Sender, requestingUser) {
				return nil, fmt.Errorf("%w: Only the author can edit this message", ErrMessageForbidden)
			}
			m.Content = trimmed
			dataMap := ensureDataMap(m.Data)
			dataMap["edited"] = true
			m.Data = dataMap
			if err := s.saveLocked(); err != nil {
				return nil, err
			}
			cp := *m
			return &cp, nil
		}
	}
	return nil, ErrMessageNotFound
}

// DeleteMessage deletes a message if requestingUser is its author.
func (s *FileStore) DeleteMessage(msgID, room, requestingUser string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Messages {
		m := s.data.Messages[i]
		if m.ID == msgID && m.Room == room {
			if !strings.EqualFold(m.Sender, requestingUser) {
				return fmt.Errorf("%w: Only the author can delete this message", ErrMessageForbidden)
			}
			s.data.Messages = append(s.data.Messages[:i], s.data.Messages[i+1:]...)
			return s.saveLocked()
		}
	}
	return ErrMessageNotFound
}

// ToggleReaction adds or removes username's emoji reaction on a message.
func (s *FileStore) ToggleReaction(msgID, room, username, emoji string) (*Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.data.Messages {
		m := &s.data.Messages[i]
		if m.ID == msgID && m.Room == room {
			m.Data = toggleReactionInData(m.Data, username, emoji)
			if err := s.saveLocked(); err != nil {
				return nil, err
			}
			cp := *m
			return &cp, nil
		}
	}
	return nil, ErrMessageNotFound
}

// SearchMessages performs a case-insensitive substring search in room messages.
func (s *FileStore) SearchMessages(room, query string, limit int) ([]Message, error) {
	q := strings.ToLower(strings.TrimSpace(query))
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

	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := len(s.data.Messages) - 1; i >= 0 && len(res) < limit; i-- {
		m := s.data.Messages[i]
		if m.Room == room && strings.Contains(strings.ToLower(m.Content), q) {
			res = append(res, m)
		}
	}
	return res, nil
}

func cloneChannel(ch Channel) Channel {
	cp := ch
	if len(ch.Members) > 0 {
		cp.Members = make([]string, len(ch.Members))
		copy(cp.Members, ch.Members)
	}
	return cp
}

// GetChannels returns all configured channels.
func (s *FileStore) GetChannels() ([]Channel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]Channel, len(s.data.Channels))
	for i, ch := range s.data.Channels {
		res[i] = cloneChannel(ch)
	}
	return res, nil
}

// GetChannel retrieves a single channel by ID.
func (s *FileStore) GetChannel(id string) (*Channel, error) {
	normID := strings.ToLower(strings.TrimSpace(id))
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, ch := range s.data.Channels {
		if ch.ID == normID {
			cp := cloneChannel(ch)
			return &cp, nil
		}
	}
	return nil, ErrChannelNotFound
}

// GetChannelsForUser returns all public channels plus private channels the user belongs to.
func (s *FileStore) GetChannelsForUser(username string) ([]Channel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]Channel, 0, len(s.data.Channels))
	for _, ch := range s.data.Channels {
		if !ch.IsPrivate || isChannelMember(&ch, username) {
			res = append(res, cloneChannel(ch))
		}
	}
	return res, nil
}

// CreateChannel adds a new channel if its ID does not already exist.
func (s *FileStore) CreateChannel(ch Channel) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, existing := range s.data.Channels {
		if existing.ID == ch.ID {
			return ErrChannelExists
		}
	}
	if ch.IsPrivate {
		ch.Members = normalizeMembers(ch.CreatedBy, ch.Members)
	} else {
		ch.Members = nil
	}
	if ch.CreatedAt.IsZero() {
		ch.CreatedAt = time.Now().UTC()
	}
	s.data.Channels = append(s.data.Channels, cloneChannel(ch))
	return s.saveLocked()
}

// InviteToChannel adds targetUser to a private channel if requestingUser is its creator.
func (s *FileStore) InviteToChannel(channelID, requestingUser, targetUser string) (*Channel, error) {
	normID := strings.ToLower(strings.TrimSpace(channelID))
	normTarget := normalizeUsername(targetUser)

	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	for i, ch := range s.data.Channels {
		if ch.ID == normID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil, ErrChannelNotFound
	}
	ch := &s.data.Channels[idx]
	if !ch.IsPrivate {
		return nil, ErrChannelNotPrivate
	}
	if !strings.EqualFold(ch.CreatedBy, requestingUser) {
		return nil, fmt.Errorf("%w: Only the creator of this room can invite members", ErrChannelForbidden)
	}
	if _, exists := s.data.Users[normTarget]; !exists {
		return nil, ErrUserNotFound
	}

	ch.Members = normalizeMembers(ch.CreatedBy, append(ch.Members, normTarget))
	if err := s.saveLocked(); err != nil {
		return nil, err
	}
	cp := cloneChannel(*ch)
	return &cp, nil
}

// DeleteChannel deletes a channel by ID only if requestingUser is its creator.
// Default system rooms (random, voice-lounge, or createdBy=system) cannot be deleted.
func (s *FileStore) DeleteChannel(id, requestingUser string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i, ch := range s.data.Channels {
		if ch.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ErrChannelNotFound
	}
	ch := s.data.Channels[idx]
	if isDefaultProtectedChannel(ch.ID, ch.CreatedBy) {
		return fmt.Errorf("%w: Default rooms cannot be deleted", ErrChannelForbidden)
	}
	if !strings.EqualFold(ch.CreatedBy, requestingUser) {
		return fmt.Errorf("%w: Only the creator of this room can delete it", ErrChannelForbidden)
	}
	s.data.Channels = append(s.data.Channels[:idx], s.data.Channels[idx+1:]...)
	return s.saveLocked()
}

// GetProfile retrieves a user's public profile.
func (s *FileStore) GetProfile(username string) (UserProfile, error) {
	normUser := normalizeUsername(username)
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, exists := s.data.Users[normUser]
	if !exists {
		return UserProfile{}, ErrUserNotFound
	}
	return UserProfile{
		Username:  u.Username,
		AvatarURL: u.AvatarURL,
		Status:    normalizeUserStatus(u.Status),
	}, nil
}

// UpdateProfile updates a user's avatarUrl and/or presence status.
func (s *FileStore) UpdateProfile(username string, avatarURL *string, status *string) (UserProfile, error) {
	normUser := normalizeUsername(username)
	s.mu.Lock()
	defer s.mu.Unlock()
	u, exists := s.data.Users[normUser]
	if !exists {
		return UserProfile{}, ErrUserNotFound
	}
	if avatarURL != nil {
		u.AvatarURL = strings.TrimSpace(*avatarURL)
	}
	if status != nil {
		u.Status = normalizeUserStatus(*status)
	}
	if err := s.saveLocked(); err != nil {
		return UserProfile{}, err
	}
	return UserProfile{
		Username:  u.Username,
		AvatarURL: u.AvatarURL,
		Status:    normalizeUserStatus(u.Status),
	}, nil
}

// GetAllProfiles returns a map of username -> UserProfile for all registered users.
func (s *FileStore) GetAllProfiles() (map[string]UserProfile, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make(map[string]UserProfile, len(s.data.Users))
	for _, u := range s.data.Users {
		if u == nil {
			continue
		}
		res[u.Username] = UserProfile{
			Username:  u.Username,
			AvatarURL: u.AvatarURL,
			Status:    normalizeUserStatus(u.Status),
		}
	}
	return res, nil
}

// Close is a no-op for FileStore.
func (s *FileStore) Close() error {
	return nil
}
