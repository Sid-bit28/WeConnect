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
	Type      string `json:"type"` // "chat" | "join" | "leave" | "users" | "signal" | "error"
	Room      string `json:"room"`
	Sender    string `json:"sender"`
	Content   string `json:"content,omitempty"`
	Data      any    `json:"data,omitempty"`      // WebRTC signaling payload or user list
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
}

// NewHub constructs a new Hub instance.
func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
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

	h.mu.RLock()
	room, exists := h.rooms[roomName]
	if !exists {
		h.mu.RUnlock()
		return false
	}

	targets := make([]*Client, 0)
	for c := range room.Clients {
		if c.username == targetUser {
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
