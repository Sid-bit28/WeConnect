package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"
)

// Message defines the WebSocket JSON protocol payload.
type Message struct {
	Type      string `json:"type"` // "chat" | "join" | "leave" | "users" | "signal" | "error" | "friend_update"
	Room      string `json:"room,omitempty"`
	Sender    string `json:"sender"`
	Content   string `json:"content,omitempty"`
	Data      any    `json:"data,omitempty"`      // WebRTC signaling payload, user list, or friend update details
	Timestamp int64  `json:"timestamp,omitempty"` // Milliseconds Unix timestamp
}

// Room represents a chat and signaling room containing connected clients.
type Room struct {
	Name    string
	Clients map[*Client]bool
}

// Hub manages rooms, client registration/unregistration, and message dispatching.
type Hub struct {
	mu    sync.RWMutex
	rooms map[string]*Room
	store Store
}

// NewHub constructs a new Hub instance.
func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
}

// SetStore attaches a Store implementation to the Hub for message persistence.
func (h *Hub) SetStore(store Store) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.store = store
}

// isAuthorizedForRoom checks whether username is allowed to access the room.
// Deterministic DM rooms ("dm:<u1>:<u2>") are restricted strictly to u1 and u2.
func isAuthorizedForRoom(room, username string) bool {
	if !strings.HasPrefix(room, "dm:") {
		return true
	}
	parts := strings.Split(room, ":")
	if len(parts) != 3 || parts[1] == "" || parts[2] == "" {
		return false
	}
	normUser := strings.ToLower(strings.TrimSpace(username))
	if normUser == "" {
		return false
	}
	return normUser == strings.ToLower(parts[1]) || normUser == strings.ToLower(parts[2])
}

// Register adds a client to their room, announces their join, and broadcasts the current user list.
func (h *Hub) Register(client *Client) {
	if client == nil {
		return
	}

	h.mu.Lock()
	room, exists := h.rooms[client.room]
	if !exists {
		room = &Room{
			Name:    client.room,
			Clients: make(map[*Client]bool),
		}
		h.rooms[client.room] = room
	}
	room.Clients[client] = true
	users := h.getRoomUsersLocked(room)
	h.mu.Unlock()

	log.Printf("[Hub] User '%s' joined room '%s' (active in room: %d)", client.username, client.room, len(users))

	// Broadcast join notification to the room
	joinMsg := Message{
		Type:      "join",
		Room:      client.room,
		Sender:    client.username,
		Content:   fmt.Sprintf("%s joined the room", client.username),
		Timestamp: time.Now().UnixMilli(),
	}
	h.BroadcastToRoom(client.room, joinMsg)

	// Broadcast updated user list to all clients in the room
	usersMsg := Message{
		Type:      "users",
		Room:      client.room,
		Sender:    "system",
		Content:   "Online users updated",
		Data:      users,
		Timestamp: time.Now().UnixMilli(),
	}
	h.BroadcastToRoom(client.room, usersMsg)
}

// Unregister safely removes a client from their room, broadcasts a leave event and user list update,
// and deletes the room if empty.
func (h *Hub) Unregister(client *Client) {
	if client == nil {
		return
	}

	h.mu.Lock()
	room, exists := h.rooms[client.room]
	if !exists {
		h.mu.Unlock()
		client.Close()
		return
	}

	if _, inRoom := room.Clients[client]; !inRoom {
		h.mu.Unlock()
		client.Close()
		return
	}

	delete(room.Clients, client)
	roomEmpty := len(room.Clients) == 0
	var users []string

	if roomEmpty {
		delete(h.rooms, client.room)
		log.Printf("[Hub] Room '%s' is now empty and was removed", client.room)
	} else {
		users = h.getRoomUsersLocked(room)
		log.Printf("[Hub] User '%s' left room '%s' (remaining in room: %d)", client.username, client.room, len(users))
	}
	h.mu.Unlock()

	// Ensure the client send channel and resources are closed
	client.Close()

	if !roomEmpty {
		// Broadcast leave notification to remaining clients
		leaveMsg := Message{
			Type:      "leave",
			Room:      client.room,
			Sender:    client.username,
			Content:   fmt.Sprintf("%s left the room", client.username),
			Timestamp: time.Now().UnixMilli(),
		}
		h.BroadcastToRoom(client.room, leaveMsg)

		// Broadcast updated user list
		usersMsg := Message{
			Type:      "users",
			Room:      client.room,
			Sender:    "system",
			Content:   "Online users updated",
			Data:      users,
			Timestamp: time.Now().UnixMilli(),
		}
		h.BroadcastToRoom(client.room, usersMsg)
	}
}

// getStore returns the attached Store safely under read lock.
func (h *Hub) getStore() Store {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.store
}

// BroadcastToRoom sends a message to all connected clients in the designated room.
func (h *Hub) BroadcastToRoom(roomName string, msg Message) {
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixMilli()
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal broadcast message: %v", err)
		return
	}

	h.mu.RLock()
	room, exists := h.rooms[roomName]
	if !exists {
		h.mu.RUnlock()
		return
	}

	// Snapshot clients under read lock
	clients := make([]*Client, 0, len(room.Clients))
	for c := range room.Clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		c.Send(data)
	}
}

// SendToClient routes a message to a specific targeted user within the room (WebRTC signaling 1-to-1).
// Returns true if at least one client for that username received the message.
func (h *Hub) SendToClient(roomName, targetUser string, msg Message) bool {
	if targetUser == "" {
		return false
	}
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixMilli()
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal targeted message: %v", err)
		return false
	}

	targetNorm := strings.ToLower(strings.TrimSpace(targetUser))
	h.mu.RLock()
	room, exists := h.rooms[roomName]
	if !exists {
		h.mu.RUnlock()
		return false
	}

	targets := make([]*Client, 0)
	for c := range room.Clients {
		if strings.ToLower(c.username) == targetNorm {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	if len(targets) == 0 {
		return false
	}

	sent := false
	for _, c := range targets {
		if c.Send(data) {
			sent = true
		}
	}
	return sent
}

// IsUserOnline returns true if any connected client has the specified username.
func (h *Hub) IsUserOnline(username string) bool {
	norm := strings.ToLower(strings.TrimSpace(username))
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, room := range h.rooms {
		for client := range room.Clients {
			if strings.ToLower(client.username) == norm {
				return true
			}
		}
	}
	return false
}

// NotifyUser sends a protocol message to all active connections belonging to a specific user across all rooms.
func (h *Hub) NotifyUser(username string, msg Message) bool {
	if username == "" {
		return false
	}
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixMilli()
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal notification: %v", err)
		return false
	}

	norm := strings.ToLower(strings.TrimSpace(username))
	h.mu.RLock()
	var targets []*Client
	for _, room := range h.rooms {
		for client := range room.Clients {
			if strings.ToLower(client.username) == norm {
				targets = append(targets, client)
			}
		}
	}
	h.mu.RUnlock()

	sent := false
	for _, client := range targets {
		if client.Send(data) {
			sent = true
		}
	}
	return sent
}

// BroadcastAll sends a protocol message to every connected client across all active rooms.
func (h *Hub) BroadcastAll(msg Message) {
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixMilli()
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal BroadcastAll message: %v", err)
		return
	}

	h.mu.RLock()
	var clients []*Client
	for _, room := range h.rooms {
		for c := range room.Clients {
			clients = append(clients, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range clients {
		c.Send(data)
	}
}

// NotifyUserIfNotInRoom sends a message to all connections of username that are not currently in roomName.
func (h *Hub) NotifyUserIfNotInRoom(username, roomName string, msg Message) bool {
	if username == "" {
		return false
	}
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixMilli()
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal unread notification: %v", err)
		return false
	}

	norm := strings.ToLower(strings.TrimSpace(username))
	h.mu.RLock()
	var targets []*Client
	for rName, room := range h.rooms {
		if rName == roomName {
			continue
		}
		for c := range room.Clients {
			if strings.ToLower(c.username) == norm {
				targets = append(targets, c)
			}
		}
	}
	h.mu.RUnlock()

	sent := false
	for _, c := range targets {
		if c.Send(data) {
			sent = true
		}
	}
	return sent
}

// NotifyOtherRooms sends a message to all clients currently viewing rooms other than roomName,
// excluding connections belonging to excludeSender.
func (h *Hub) NotifyOtherRooms(roomName, excludeSender string, msg Message) {
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixMilli()
	}

	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Hub] Failed to marshal other-rooms notification: %v", err)
		return
	}

	normExclude := strings.ToLower(strings.TrimSpace(excludeSender))
	h.mu.RLock()
	var targets []*Client
	for rName, room := range h.rooms {
		if rName == roomName {
			continue
		}
		for c := range room.Clients {
			if normExclude != "" && strings.ToLower(c.username) == normExclude {
				continue
			}
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		c.Send(data)
	}
}

// getDmOtherPeer extracts the other participant's username from a "dm:<u1>:<u2>" room ID.
func getDmOtherPeer(room, username string) string {
	if !strings.HasPrefix(room, "dm:") {
		return ""
	}
	parts := strings.Split(room, ":")
	if len(parts) != 3 {
		return ""
	}
	norm := strings.ToLower(strings.TrimSpace(username))
	if strings.ToLower(parts[1]) == norm {
		return parts[2]
	}
	if strings.ToLower(parts[2]) == norm {
		return parts[1]
	}
	return ""
}

// RoomCount returns the total number of active rooms.
func (h *Hub) RoomCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms)
}

// ClientCount returns the total number of connected clients across all rooms.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for _, room := range h.rooms {
		count += len(room.Clients)
	}
	return count
}

// getRoomUsersLocked collects and deduplicates usernames in a room. Caller must hold h.mu.
func (h *Hub) getRoomUsersLocked(room *Room) []string {
	userSet := make(map[string]bool)
	var users []string
	for c := range room.Clients {
		if !userSet[c.username] {
			userSet[c.username] = true
			users = append(users, c.username)
		}
	}
	sort.Strings(users)
	return users
}

// extractTarget safely retrieves the target username from signal payload data.
func extractTarget(data any) string {
	if data == nil {
		return ""
	}
	if m, ok := data.(map[string]any); ok {
		if target, ok := m["target"].(string); ok {
			return strings.TrimSpace(target)
		}
	}
	return ""
}
