package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development and CORS
	},
}

// corsMiddleware sets permissive CORS headers for HTTP requests and handles OPTIONS preflight.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// healthHandler returns a 200 OK JSON response indicating server health and stats.
func healthHandler(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":  "ok",
			"rooms":   hub.RoomCount(),
			"clients": hub.ClientCount(),
		})
	}
}

// wsHandler upgrades HTTP to WebSocket and registers the client into the requested room.
func wsHandler(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		room := strings.TrimSpace(r.URL.Query().Get("room"))
		user := strings.TrimSpace(r.URL.Query().Get("user"))

		if room == "" || user == "" {
			http.Error(w, "Query parameters 'room' and 'user' are required", http.StatusBadRequest)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[Server] WebSocket upgrade failed: %v", err)
			return
		}

		client := NewClient(hub, conn, room, user)
		hub.Register(client)

		go client.writePump()
		go client.readPump()
	}
}

// setupRoutes configures the HTTP routes and returns the top-level handler.
func setupRoutes(hub *Hub) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler(hub))
	mux.HandleFunc("/ws", wsHandler(hub))
	return corsMiddleware(mux)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port

	hub := NewHub()
	handler := setupRoutes(hub)

	log.Printf("[Server] WeConnect WebSocket server starting on %s...", addr)
	if err := http.ListenAndServe(addr, handler); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[Server] Server error: %v", err)
	}
}
