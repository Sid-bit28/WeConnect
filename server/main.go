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

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

func requireAuth(store *Store, next func(w http.ResponseWriter, r *http.Request, user *User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			writeError(w, http.StatusUnauthorized, "Missing or invalid authorization token")
			return
		}
		user, err := store.AuthenticateToken(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, err.Error())
			return
		}
		next(w, r, user)
	}
}

// healthHandler returns a 200 OK JSON response indicating server health and stats.
func healthHandler(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
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

// --- Auth Handlers ---

type AuthRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func registerHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req AuthRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		user, token, err := store.Register(req.Username, req.Password)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "taken") {
				writeError(w, http.StatusConflict, err.Error())
			} else {
				writeError(w, http.StatusBadRequest, err.Error())
			}
			return
		}

		writeJSON(w, http.StatusCreated, map[string]any{
			"token": token,
			"user": map[string]any{
				"username": user.Username,
			},
		})
	}
}

func loginHandler(store *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req AuthRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		user, token, err := store.Login(req.Username, req.Password)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "Invalid username or password")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"token": token,
			"user": map[string]any{
				"username": user.Username,
			},
		})
	}
}

func meHandler(store *Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"user": map[string]any{
				"username": user.Username,
			},
		})
	})
}

// --- Friends Handlers ---

func getFriendsHandler(store *Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		friendsData := store.GetFriends(user.Username, hub.IsUserOnline)
		writeJSON(w, http.StatusOK, friendsData)
	})
}

type FriendActionRequest struct {
	TargetUsername string `json:"targetUsername"`
	FromUsername   string `json:"fromUsername"`
	FriendUsername string `json:"friendUsername"`
	Username       string `json:"username"`
}

func (f *FriendActionRequest) Target() string {
	if f.TargetUsername != "" {
		return f.TargetUsername
	}
	return f.Username
}

func (f *FriendActionRequest) From() string {
	if f.FromUsername != "" {
		return f.FromUsername
	}
	return f.Username
}

func (f *FriendActionRequest) Friend() string {
	if f.FriendUsername != "" {
		return f.FriendUsername
	}
	return f.Username
}

func friendRequestHandler(store *Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req FriendActionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		target := strings.TrimSpace(req.Target())
		if target == "" {
			writeError(w, http.StatusBadRequest, "targetUsername is required")
			return
		}

		if err := store.SendFriendRequest(user.Username, target); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Notify target user via Hub if connected
		hub.NotifyUser(target, Message{
			Type:      "friend_update",
			Sender:    "system",
			Content:   "New friend request",
			Data:      map[string]any{"action": "request", "from": user.Username},
			Timestamp: 0,
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"message": "Friend request sent",
		})
	})
}

func friendAcceptHandler(store *Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req FriendActionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		from := strings.TrimSpace(req.From())
		if from == "" {
			writeError(w, http.StatusBadRequest, "fromUsername is required")
			return
		}

		if err := store.AcceptFriendRequest(user.Username, from); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Notify requester via Hub if connected
		hub.NotifyUser(from, Message{
			Type:      "friend_update",
			Sender:    "system",
			Content:   "Friend request accepted",
			Data:      map[string]any{"action": "accept", "friend": user.Username},
			Timestamp: 0,
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"message": "Friend request accepted",
		})
	})
}

func friendRejectHandler(store *Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req FriendActionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		other := strings.TrimSpace(req.From())
		if other == "" {
			other = strings.TrimSpace(req.Target())
		}
		if other == "" {
			writeError(w, http.StatusBadRequest, "fromUsername is required")
			return
		}

		if err := store.RejectFriendRequest(user.Username, other); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Notify other user via Hub if connected
		hub.NotifyUser(other, Message{
			Type:      "friend_update",
			Sender:    "system",
			Content:   "Friend request declined or cancelled",
			Data:      map[string]any{"action": "reject", "user": user.Username},
			Timestamp: 0,
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"message": "Friend request rejected",
		})
	})
}

func friendRemoveHandler(store *Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req FriendActionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		friend := strings.TrimSpace(req.Friend())
		if friend == "" {
			writeError(w, http.StatusBadRequest, "friendUsername is required")
			return
		}

		if err := store.RemoveFriend(user.Username, friend); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Notify friend via Hub if connected
		hub.NotifyUser(friend, Message{
			Type:      "friend_update",
			Sender:    "system",
			Content:   "Friend removed",
			Data:      map[string]any{"action": "remove", "user": user.Username},
			Timestamp: 0,
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"message": "Friend removed",
		})
	})
}

// setupRoutes configures HTTP routes with Hub and Store.
func setupRoutes(hub *Hub, store *Store) http.Handler {
	mux := http.NewServeMux()

	// Base endpoints
	mux.HandleFunc("/health", healthHandler(hub))
	mux.HandleFunc("/ws", wsHandler(hub))

	// Auth endpoints
	mux.HandleFunc("/api/auth/register", registerHandler(store))
	mux.HandleFunc("/api/auth/login", loginHandler(store))
	mux.HandleFunc("/api/auth/me", meHandler(store))

	// Friends endpoints
	mux.HandleFunc("/api/friends", getFriendsHandler(store, hub))
	mux.HandleFunc("/api/friends/request", friendRequestHandler(store, hub))
	mux.HandleFunc("/api/friends/accept", friendAcceptHandler(store, hub))
	mux.HandleFunc("/api/friends/reject", friendRejectHandler(store, hub))
	mux.HandleFunc("/api/friends/remove", friendRemoveHandler(store, hub))

	return corsMiddleware(mux)
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port

	dataPath := os.Getenv("DATA_PATH")
	if dataPath == "" {
		dataPath = "data/store.json"
	}

	store, err := NewStore(dataPath)
	if err != nil {
		log.Fatalf("[Server] Failed to initialize store: %v", err)
	}

	hub := NewHub()
	handler := setupRoutes(hub, store)

	log.Printf("[Server] WeConnect WebSocket server starting on %s (store: %s)...", addr, dataPath)
	if err := http.ListenAndServe(addr, handler); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[Server] Server error: %v", err)
	}
}
