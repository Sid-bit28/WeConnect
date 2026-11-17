package main

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 512 * 1024

	// Maximum buffered messages per client.
	sendBufferSize = 256
)

// Client represents a connected WebSocket user.
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	room     string
	username string
	mu       sync.Mutex
	isClosed bool
}

// NewClient initializes a new Client instance.
func NewClient(hub *Hub, conn *websocket.Conn, room, username string) *Client {
	return &Client{
		hub:      hub,
		conn:     conn,
		send:     make(chan []byte, sendBufferSize),
		room:     room,
		username: username,
	}
}

// Close closes the send channel idempotently and marks the client as closed.
func (c *Client) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.isClosed {
		c.isClosed = true
		close(c.send)
	}
}

// Send non-blockingly enqueues a message into the client's send buffer.
// Returns false if client is closed or buffer is full.
func (c *Client) Send(data []byte) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.isClosed {
		return false
	}
	select {
	case c.send <- data:
		return true
	default:
		log.Printf("[Client] Send buffer full for user '%s' in room '%s', dropping frame", c.username, c.room)
		return false
	}
}

// SendMessage serializes and sends a protocol Message to this client.
func (c *Client) SendMessage(msg Message) bool {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[Client] Failed to marshal message: %v", err)
		return false
	}
	return c.Send(data)
}

// readPump pumps messages from the websocket connection to the hub.
func (c *Client) readPump() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Client] Panic recovered in readPump for user '%s': %v", c.username, r)
		}
		c.hub.Unregister(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))

	// Handle heartbeat pong responses from client
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	// Handle ping requests initiated by client
	c.conn.SetPingHandler(func(appData string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return c.conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(writeWait))
	})

	for {
		_, rawMsg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
				log.Printf("[Client] Read error for user '%s' in room '%s': %v", c.username, c.room, err)
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(rawMsg, &msg); err != nil {
			log.Printf("[Client] Invalid message JSON from user '%s': %v", c.username, err)
			c.SendMessage(Message{
				Type:      "error",
				Room:      c.room,
				Sender:    "system",
				Content:   "Invalid JSON message format",
				Timestamp: time.Now().UnixMilli(),
			})
			continue
		}

		// Enforce session authenticity
		msg.Room = c.room
		msg.Sender = c.username
		if msg.Timestamp == 0 {
			msg.Timestamp = time.Now().UnixMilli()
		}

		switch msg.Type {
		case "chat":
			if strings.TrimSpace(msg.Content) == "" {
				continue
			}
			if store := c.hub.getStore(); store != nil {
				if err := store.SaveMessage(msg); err != nil {
					log.Printf("[Client] Failed to save chat message in room '%s': %v", c.room, err)
				}
			}
			c.hub.BroadcastToRoom(c.room, msg)

		case "signal":
			targetUser := extractTarget(msg.Data)
			if targetUser == "" {
				c.SendMessage(Message{
					Type:      "error",
					Room:      c.room,
					Sender:    "system",
					Content:   "Signal message requires data.target",
					Timestamp: time.Now().UnixMilli(),
				})
				continue
			}

			sent := c.hub.SendToClient(c.room, targetUser, msg)
			if !sent {
				c.SendMessage(Message{
					Type:      "error",
					Room:      c.room,
					Sender:    "system",
					Content:   fmt.Sprintf("User '%s' not found in room '%s'", targetUser, c.room),
					Timestamp: time.Now().UnixMilli(),
				})
			}

		default:
			// Custom or extended message types are broadcast to the room
			c.hub.BroadcastToRoom(c.room, msg)
		}
	}
}

// writePump pumps messages from the send channel to the websocket connection.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Client] Panic recovered in writePump for user '%s': %v", c.username, r)
		}
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel, terminate connection cleanly
				_ = c.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "connection closed"))
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("[Client] Write error for user '%s': %v", c.username, err)
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
