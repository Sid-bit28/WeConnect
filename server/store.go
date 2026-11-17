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
	CreatedAt    time.Time `json:"createdAt"`
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
	ErrChannelExists   = errors.New("Channel already exists")
	ErrChannelNotFound = errors.New("Channel not found")
)

// Channel represents a text or voice channel in the workspace.
type Channel struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"` // "text" | "voice"
	Topic     string    `json:"topic,omitempty"`
	CreatedBy string    `json:"createdBy,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

func defaultChannels() []Channel {
	now := time.Now().UTC()
	return []Channel{
		{ID: "general", Name: "general", Type: "text", Topic: "General workspace discussion", CreatedBy: "system", CreatedAt: now},
		{ID: "random", Name: "random", Type: "text", Topic: "Casual talk and off-topic", CreatedBy: "system", CreatedAt: now.Add(time.Millisecond)},
		{ID: "dev-chat", Name: "dev-chat", Type: "text", Topic: "Engineering, architecture, and releases", CreatedBy: "system", CreatedAt: now.Add(2 * time.Millisecond)},
		{ID: "voice-lounge", Name: "Voice Lounge", Type: "voice", Topic: "Drop-in voice and video room", CreatedBy: "system", CreatedAt: now.Add(3 * time.Millisecond)},
		{ID: "gaming", Name: "Gaming Room", Type: "voice", Topic: "Low-latency voice room", CreatedBy: "system", CreatedAt: now.Add(4 * time.Millisecond)},
	}
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
	GetChannels() ([]Channel, error)
	CreateChannel(ch Channel) error
	DeleteChannel(id string) error
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

	if len(s.data.Channels) == 0 {
		s.data.Channels = defaultChannels()
		if filePath != "" {
			_ = s.saveLocked()
		}
	}

	return s, nil
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
	Username string `json:"username"`
	Online   bool   `json:"online"`
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

	for _, f := range s.data.Friendships {
		if f.Status == "accepted" {
			if f.Requester == normUser {
				res.Friends = append(res.Friends, FriendEntry{
					Username: f.Receiver,
					Online:   isOnline(f.Receiver),
				})
			} else if f.Receiver == normUser {
				res.Friends = append(res.Friends, FriendEntry{
					Username: f.Requester,
					Online:   isOnline(f.Requester),
				})
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

// GetChannels returns all configured channels.
func (s *FileStore) GetChannels() ([]Channel, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	res := make([]Channel, len(s.data.Channels))
	copy(res, s.data.Channels)
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
	if ch.CreatedAt.IsZero() {
		ch.CreatedAt = time.Now().UTC()
	}
	s.data.Channels = append(s.data.Channels, ch)
	return s.saveLocked()
}

// DeleteChannel deletes a channel by ID. Deleting "general" is rejected.
func (s *FileStore) DeleteChannel(id string) error {
	if id == "general" {
		return errors.New("Cannot delete the default #general channel")
	}
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
	s.data.Channels = append(s.data.Channels[:idx], s.data.Channels[idx+1:]...)
	return s.saveLocked()
}

// Close is a no-op for FileStore.
func (s *FileStore) Close() error {
	return nil
}
