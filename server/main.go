package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

func requireAuth(store Store, next func(w http.ResponseWriter, r *http.Request, user *User)) http.HandlerFunc {
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

// wsHandler upgrades HTTP to WebSocket after strictly authenticating the session token
// and enforcing room authorization.
func wsHandler(hub *Hub, store Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimSpace(r.URL.Query().Get("token"))
		if token == "" || store == nil {
			http.Error(w, "Unauthorized: valid session token is required", http.StatusUnauthorized)
			return
		}

		authUser, err := store.AuthenticateToken(token)
		if err != nil {
			http.Error(w, "Unauthorized: invalid or expired session token", http.StatusUnauthorized)
			return
		}

		room := strings.TrimSpace(r.URL.Query().Get("room"))
		if room == "" {
			http.Error(w, "Query parameter 'room' is required", http.StatusBadRequest)
			return
		}

		if !isAuthorizedForRoom(room, authUser.Username, store) {
			http.Error(w, "Forbidden: not authorized to access this room", http.StatusForbidden)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[Server] WebSocket upgrade failed: %v", err)
			return
		}

		client := NewClient(hub, conn, room, authUser.Username)
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

func userToPublicMap(user *User) map[string]any {
	return map[string]any{
		"username":  user.Username,
		"avatarUrl": user.AvatarURL,
		"status":    normalizeUserStatus(user.Status),
	}
}

func registerHandler(store Store) http.HandlerFunc {
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
			"user":  userToPublicMap(user),
		})
	}
}

func loginHandler(store Store) http.HandlerFunc {
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
			"user":  userToPublicMap(user),
		})
	}
}

func meHandler(store Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"user": userToPublicMap(user),
		})
	})
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func changePasswordHandler(store Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req ChangePasswordRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		if req.CurrentPassword == "" || len(req.NewPassword) < 6 {
			writeError(w, http.StatusBadRequest, "Current password and new password (min 6 characters) are required")
			return
		}

		if err := store.ChangePassword(user.Username, req.CurrentPassword, req.NewPassword); err != nil {
			if errors.Is(err, ErrInvalidCredentials) {
				writeError(w, http.StatusUnauthorized, "Current password is incorrect")
			} else if errors.Is(err, ErrUserNotFound) {
				writeError(w, http.StatusNotFound, "User not found")
			} else {
				writeError(w, http.StatusBadRequest, err.Error())
			}
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"status": "ok",
		})
	})
}

// --- Friends Handlers ---

func getFriendsHandler(store Store, hub *Hub) http.HandlerFunc {
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

func friendRequestHandler(store Store, hub *Hub) http.HandlerFunc {
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

func friendAcceptHandler(store Store, hub *Hub) http.HandlerFunc {
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

func friendRejectHandler(store Store, hub *Hub) http.HandlerFunc {
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

func friendRemoveHandler(store Store, hub *Hub) http.HandlerFunc {
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

// --- ICE Configuration Handler ---

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type ICEConfigResponse struct {
	ICEServers []ICEServer `json:"iceServers"`
}

func iceConfigHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		servers := []ICEServer{
			{
				URLs: []string{
					"stun:stun.l.google.com:19302",
					"stun:stun1.l.google.com:19302",
				},
			},
		}

		turnURL := os.Getenv("TURN_URL")
		if turnURL != "" {
			servers = append(servers, ICEServer{
				URLs:       []string{turnURL},
				Username:   os.Getenv("TURN_USERNAME"),
				Credential: os.Getenv("TURN_CREDENTIAL"),
			})
		}

		writeJSON(w, http.StatusOK, ICEConfigResponse{
			ICEServers: servers,
		})
	}
}

// --- Custom & Private Channels Handlers ---

type CreateChannelRequest struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Topic     string   `json:"topic"`
	IsPrivate bool     `json:"isPrivate"`
	Members   []string `json:"members"`
}

type InviteChannelRequest struct {
	ChannelID string `json:"channelId"`
	Username  string `json:"username"`
}

func notifyChannelMembers(hub *Hub, members []string, msg Message) {
	seen := make(map[string]bool)
	for _, m := range members {
		nm := normalizeUsername(m)
		if nm == "" || seen[nm] {
			continue
		}
		seen[nm] = true
		hub.NotifyUser(nm, msg)
	}
}

func channelsHandler(store Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		switch r.Method {
		case http.MethodGet:
			channels, err := store.GetChannelsForUser(user.Username)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to retrieve channels")
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"channels": channels,
			})

		case http.MethodPost:
			var req CreateChannelRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "Invalid JSON request body")
				return
			}

			name := strings.TrimSpace(req.Name)
			if len(name) < 2 || len(name) > 32 {
				writeError(w, http.StatusBadRequest, "Channel name must be between 2 and 32 characters")
				return
			}

			chType := strings.ToLower(strings.TrimSpace(req.Type))
			if chType != "text" && chType != "voice" {
				writeError(w, http.StatusBadRequest, "Channel type must be 'text' or 'voice'")
				return
			}

			id := slugifyChannelID(name)
			if len(id) < 2 {
				writeError(w, http.StatusBadRequest, "Channel name must contain at least 2 alphanumeric characters")
				return
			}

			topic := strings.TrimSpace(req.Topic)
			if len(topic) > 200 {
				topic = topic[:200]
			}

			var members []string
			if req.IsPrivate {
				validRequested := make([]string, 0, len(req.Members))
				for _, m := range req.Members {
					nm := normalizeUsername(m)
					if nm != "" && store.UserExists(nm) {
						validRequested = append(validRequested, nm)
					}
				}
				members = normalizeMembers(user.Username, validRequested)
			}

			ch := Channel{
				ID:        id,
				Name:      name,
				Type:      chType,
				Topic:     topic,
				CreatedBy: user.Username,
				IsPrivate: req.IsPrivate,
				Members:   members,
				CreatedAt: time.Now().UTC(),
			}

			if err := store.CreateChannel(ch); err != nil {
				if errors.Is(err, ErrChannelExists) {
					writeError(w, http.StatusConflict, "A channel with that name already exists")
				} else {
					writeError(w, http.StatusInternalServerError, "Failed to create channel")
				}
				return
			}

			updateMsg := Message{
				Type:      "channel_update",
				Sender:    user.Username,
				Content:   "Channel created",
				Data:      ch,
				Timestamp: time.Now().UnixMilli(),
			}
			if ch.IsPrivate {
				notifyChannelMembers(hub, ch.Members, updateMsg)
			} else {
				hub.BroadcastAll(updateMsg)
			}

			writeJSON(w, http.StatusCreated, map[string]any{
				"channel": ch,
			})

		case http.MethodDelete:
			id := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("id")))
			if id == "" {
				writeError(w, http.StatusBadRequest, "Channel id query parameter is required")
				return
			}

			existingCh, _ := store.GetChannel(id)

			if err := store.DeleteChannel(id, user.Username); err != nil {
				switch {
				case errors.Is(err, ErrChannelNotFound):
					writeError(w, http.StatusNotFound, "Channel not found")
				case errors.Is(err, ErrChannelForbidden):
					msg := strings.TrimPrefix(err.Error(), ErrChannelForbidden.Error()+": ")
					writeError(w, http.StatusForbidden, msg)
				default:
					writeError(w, http.StatusInternalServerError, "Failed to delete channel")
				}
				return
			}

			delMsg := Message{
				Type:      "channel_update",
				Sender:    user.Username,
				Content:   "Channel deleted",
				Data:      map[string]string{"id": id},
				Timestamp: time.Now().UnixMilli(),
			}
			if existingCh != nil && existingCh.IsPrivate {
				notifyChannelMembers(hub, existingCh.Members, delMsg)
			} else {
				hub.BroadcastAll(delMsg)
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"status": "ok",
				"id":     id,
			})

		default:
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		}
	})
}

func inviteChannelHandler(store Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req InviteChannelRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		channelID := strings.ToLower(strings.TrimSpace(req.ChannelID))
		targetUser := normalizeUsername(req.Username)
		if channelID == "" || targetUser == "" {
			writeError(w, http.StatusBadRequest, "channelId and username are required")
			return
		}

		updatedCh, err := store.InviteToChannel(channelID, user.Username, targetUser)
		if err != nil {
			switch {
			case errors.Is(err, ErrChannelNotFound):
				writeError(w, http.StatusNotFound, "Channel not found")
			case errors.Is(err, ErrUserNotFound):
				writeError(w, http.StatusNotFound, "Target user not found")
			case errors.Is(err, ErrChannelNotPrivate):
				writeError(w, http.StatusBadRequest, "Channel is not private")
			case errors.Is(err, ErrChannelForbidden):
				msg := strings.TrimPrefix(err.Error(), ErrChannelForbidden.Error()+": ")
				writeError(w, http.StatusForbidden, msg)
			default:
				writeError(w, http.StatusInternalServerError, "Failed to invite user to channel")
			}
			return
		}

		updateMsg := Message{
			Type:      "channel_update",
			Sender:    user.Username,
			Content:   "Member invited",
			Data:      updatedCh,
			Timestamp: time.Now().UnixMilli(),
		}
		notifyChannelMembers(hub, updatedCh.Members, updateMsg)

		writeJSON(w, http.StatusOK, map[string]any{
			"channel": updatedCh,
		})
	})
}

// --- User Profile & Presence Status Handlers ---

type UpdateProfileRequest struct {
	AvatarURL *string `json:"avatarUrl"`
	Status    *string `json:"status"`
}

func profileHandler(store Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req UpdateProfileRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		var statusPtr *string
		if req.Status != nil {
			s := strings.ToLower(strings.TrimSpace(*req.Status))
			if !isValidUserStatus(s) {
				writeError(w, http.StatusBadRequest, "Status must be 'online', 'away', or 'dnd'")
				return
			}
			statusPtr = &s
		}

		var avatarPtr *string
		if req.AvatarURL != nil {
			a := strings.TrimSpace(*req.AvatarURL)
			if a != "" {
				if !strings.HasPrefix(a, "/api/uploads/") || !isSafeUploadFilename(strings.TrimPrefix(a, "/api/uploads/")) {
					writeError(w, http.StatusBadRequest, "avatarUrl must be empty or a valid /api/uploads/ path")
					return
				}
			}
			avatarPtr = &a
		}

		profile, err := store.UpdateProfile(user.Username, avatarPtr, statusPtr)
		if err != nil {
			if errors.Is(err, ErrUserNotFound) {
				writeError(w, http.StatusNotFound, "User not found")
			} else {
				writeError(w, http.StatusInternalServerError, "Failed to update profile")
			}
			return
		}

		hub.BroadcastAll(Message{
			Type:      "profile_update",
			Sender:    user.Username,
			Data:      profile,
			Timestamp: time.Now().UnixMilli(),
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"profile": profile,
			"user":    profile,
		})
	})
}

func profilesHandler(store Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		profiles, err := store.GetAllProfiles()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to retrieve profiles")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"profiles": profiles,
		})
	})
}

// --- Chat Messages History, Edit, Delete, Reactions & Search Handlers ---

type EditMessageRequest struct {
	ID      string `json:"id"`
	Room    string `json:"room"`
	Content string `json:"content"`
}

type ReactMessageRequest struct {
	ID    string `json:"id"`
	Room  string `json:"room"`
	Emoji string `json:"emoji"`
}

func messagesHandler(store Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		switch r.Method {
		case http.MethodGet:
			room := strings.TrimSpace(r.URL.Query().Get("room"))
			if room == "" {
				writeError(w, http.StatusBadRequest, "room query parameter is required")
				return
			}

			if !isAuthorizedForRoom(room, user.Username, store) {
				writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
				return
			}

			limit := 50
			if lStr := r.URL.Query().Get("limit"); lStr != "" {
				if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
					limit = l
				}
			}

			msgs, err := store.GetMessages(room, limit)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to retrieve messages")
				return
			}

			writeJSON(w, http.StatusOK, map[string]any{
				"messages": msgs,
			})

		case http.MethodPut:
			var req EditMessageRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeError(w, http.StatusBadRequest, "Invalid JSON request body")
				return
			}

			id := strings.TrimSpace(req.ID)
			room := strings.TrimSpace(req.Room)
			content := strings.TrimSpace(req.Content)
			if id == "" || room == "" || content == "" {
				writeError(w, http.StatusBadRequest, "id, room, and non-empty content are required")
				return
			}

			if !isAuthorizedForRoom(room, user.Username, store) {
				writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
				return
			}

			updated, err := store.EditMessage(id, room, user.Username, content)
			if err != nil {
				switch {
				case errors.Is(err, ErrMessageNotFound):
					writeError(w, http.StatusNotFound, "Message not found")
				case errors.Is(err, ErrMessageForbidden):
					msg := strings.TrimPrefix(err.Error(), ErrMessageForbidden.Error()+": ")
					writeError(w, http.StatusForbidden, msg)
				default:
					writeError(w, http.StatusBadRequest, err.Error())
				}
				return
			}

			hub.BroadcastToRoom(updated.Room, Message{
				ID:        updated.ID,
				Type:      "message_update",
				Room:      updated.Room,
				Sender:    updated.Sender,
				Content:   updated.Content,
				Data:      updated.Data,
				Timestamp: updated.Timestamp,
			})

			writeJSON(w, http.StatusOK, map[string]any{
				"message": updated,
			})

		case http.MethodDelete:
			id := strings.TrimSpace(r.URL.Query().Get("id"))
			room := strings.TrimSpace(r.URL.Query().Get("room"))
			if id == "" || room == "" {
				writeError(w, http.StatusBadRequest, "id and room query parameters are required")
				return
			}

			if !isAuthorizedForRoom(room, user.Username, store) {
				writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
				return
			}

			if err := store.DeleteMessage(id, room, user.Username); err != nil {
				switch {
				case errors.Is(err, ErrMessageNotFound):
					writeError(w, http.StatusNotFound, "Message not found")
				case errors.Is(err, ErrMessageForbidden):
					msg := strings.TrimPrefix(err.Error(), ErrMessageForbidden.Error()+": ")
					writeError(w, http.StatusForbidden, msg)
				default:
					writeError(w, http.StatusInternalServerError, "Failed to delete message")
				}
				return
			}

			hub.BroadcastToRoom(room, Message{
				ID:        id,
				Type:      "message_delete",
				Room:      room,
				Sender:    user.Username,
				Timestamp: time.Now().UnixMilli(),
			})

			writeJSON(w, http.StatusOK, map[string]any{
				"status": "ok",
				"id":     id,
				"room":   room,
			})

		default:
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		}
	})
}

func reactMessageHandler(store Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req ReactMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		id := strings.TrimSpace(req.ID)
		room := strings.TrimSpace(req.Room)
		emoji := strings.TrimSpace(req.Emoji)
		if id == "" || room == "" || emoji == "" || len([]rune(emoji)) > 16 {
			writeError(w, http.StatusBadRequest, "id, room, and a valid emoji (<= 16 chars) are required")
			return
		}

		if !isAuthorizedForRoom(room, user.Username, store) {
			writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
			return
		}

		updated, err := store.ToggleReaction(id, room, user.Username, emoji)
		if err != nil {
			if errors.Is(err, ErrMessageNotFound) {
				writeError(w, http.StatusNotFound, "Message not found")
			} else {
				writeError(w, http.StatusInternalServerError, "Failed to toggle reaction")
			}
			return
		}

		hub.BroadcastToRoom(updated.Room, Message{
			ID:        updated.ID,
			Type:      "message_update",
			Room:      updated.Room,
			Sender:    updated.Sender,
			Content:   updated.Content,
			Data:      updated.Data,
			Timestamp: updated.Timestamp,
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"message": updated,
		})
	})
}

func searchMessagesHandler(store Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		room := strings.TrimSpace(r.URL.Query().Get("room"))
		if room == "" {
			writeError(w, http.StatusBadRequest, "room query parameter is required")
			return
		}

		if !isAuthorizedForRoom(room, user.Username, store) {
			writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
			return
		}

		q := strings.TrimSpace(r.URL.Query().Get("q"))
		limit := 30
		if lStr := r.URL.Query().Get("limit"); lStr != "" {
			if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 100 {
				limit = l
			}
		}

		msgs, err := store.SearchMessages(room, q, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to search messages")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"messages": msgs,
		})
	})
}

// --- Single-Port Static SPA Handler ---

func spaHandler(staticDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Clean URL path
		path := filepath.Clean(r.URL.Path)

		// Don't serve directories or files if staticDir doesn't exist
		if staticDir != "" {
			targetPath := filepath.Join(staticDir, path)
			if info, err := os.Stat(targetPath); err == nil && !info.IsDir() {
				http.ServeFile(w, r, targetPath)
				return
			}

			// SPA fallback: index.html
			indexPath := filepath.Join(staticDir, "index.html")
			if _, err := os.Stat(indexPath); err == nil {
				http.ServeFile(w, r, indexPath)
				return
			}
		}

		// Friendly default page if static directory or index.html is missing
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`<!DOCTYPE html>
<html>
<head><title>WeConnect</title></head>
<body style="font-family:sans-serif;background:#1e1f22;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;">
    <h1>WeConnect Backend Server</h1>
    <p>API &amp; WebSocket active on port 8080.</p>
  </div>
</body>
</html>`))
	}
}

type PinMessageRequest struct {
	ID   string `json:"id"`
	Room string `json:"room"`
}

func pinMessageHandler(store Store, hub *Hub) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req PinMessageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON request body")
			return
		}

		id := strings.TrimSpace(req.ID)
		room := strings.TrimSpace(req.Room)
		if id == "" || room == "" {
			writeError(w, http.StatusBadRequest, "id and room are required")
			return
		}

		if !isAuthorizedForRoom(room, user.Username, store) {
			writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
			return
		}

		updated, err := store.TogglePinMessage(id, room, user.Username)
		if err != nil {
			if errors.Is(err, ErrMessageNotFound) {
				writeError(w, http.StatusNotFound, "Message not found")
			} else {
				writeError(w, http.StatusInternalServerError, "Failed to toggle pin")
			}
			return
		}

		hub.BroadcastToRoom(updated.Room, Message{
			ID:        updated.ID,
			Type:      "message_update",
			Room:      updated.Room,
			Sender:    updated.Sender,
			Content:   updated.Content,
			Data:      updated.Data,
			Timestamp: updated.Timestamp,
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"message": updated,
		})
	})
}

func pinnedMessagesHandler(store Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		room := strings.TrimSpace(r.URL.Query().Get("room"))
		if room == "" {
			writeError(w, http.StatusBadRequest, "room query parameter is required")
			return
		}

		if !isAuthorizedForRoom(room, user.Username, store) {
			writeError(w, http.StatusForbidden, "Forbidden: not authorized to access this room")
			return
		}

		msgs, err := store.GetPinnedMessages(room)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to retrieve pinned messages")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"messages": msgs,
		})
	})
}

// setupRoutes configures HTTP routes with Hub, Store, and SPA serving.
func setupRoutes(hub *Hub, store Store, staticDir string) http.Handler {
	if hub.getStore() == nil && store != nil {
		hub.SetStore(store)
	}

	authLimiter := NewRateLimiter(25, time.Minute)
	uploadLimiter := NewRateLimiter(30, time.Minute)
	previewLimiter := NewRateLimiter(40, time.Minute)

	mux := http.NewServeMux()

	// Base endpoints
	mux.HandleFunc("/health", healthHandler(hub))
	mux.HandleFunc("/ws", wsHandler(hub, store))

	// Config endpoints
	mux.HandleFunc("/api/config/ice", iceConfigHandler())

	// Auth endpoints (rate-limited)
	mux.HandleFunc("/api/auth/register", authLimiter.Middleware(registerHandler(store)))
	mux.HandleFunc("/api/auth/login", authLimiter.Middleware(loginHandler(store)))
	mux.HandleFunc("/api/auth/password", authLimiter.Middleware(changePasswordHandler(store)))
	mux.HandleFunc("/api/auth/me", meHandler(store))

	// Friends endpoints
	mux.HandleFunc("/api/friends", getFriendsHandler(store, hub))
	mux.HandleFunc("/api/friends/request", friendRequestHandler(store, hub))
	mux.HandleFunc("/api/friends/accept", friendAcceptHandler(store, hub))
	mux.HandleFunc("/api/friends/reject", friendRejectHandler(store, hub))
	mux.HandleFunc("/api/friends/remove", friendRemoveHandler(store, hub))

	// Profile endpoints
	mux.HandleFunc("/api/profile", profileHandler(store, hub))
	mux.HandleFunc("/api/profiles", profilesHandler(store))

	// Channels & Messages endpoints
	mux.HandleFunc("/api/channels", channelsHandler(store, hub))
	mux.HandleFunc("/api/channels/invite", inviteChannelHandler(store, hub))
	mux.HandleFunc("/api/messages", messagesHandler(store, hub))
	mux.HandleFunc("/api/messages/react", reactMessageHandler(store, hub))
	mux.HandleFunc("/api/messages/pin", pinMessageHandler(store, hub))
	mux.HandleFunc("/api/messages/pinned", pinnedMessagesHandler(store))
	mux.HandleFunc("/api/messages/search", searchMessagesHandler(store))

	// Uploads, GIFs & Link Previews endpoints
	uploadDir := strings.TrimSpace(os.Getenv("UPLOAD_DIR"))
	if uploadDir == "" {
		uploadDir = "./data/uploads"
	}
	mux.HandleFunc("/api/upload", uploadLimiter.Middleware(uploadHandler(store, uploadDir)))
	mux.HandleFunc("/api/uploads/", serveUploadHandler(uploadDir))
	mux.HandleFunc("/api/gifs", gifSearchHandler(store))
	mux.HandleFunc("/api/link-preview", previewLimiter.Middleware(linkPreviewHandler(store)))

	// Single-Port SPA serving
	mux.HandleFunc("/", spaHandler(staticDir))

	return corsMiddleware(mux)
}

func maskDBURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "postgresql://***"
	}
	return u.Redacted()
}

func main() {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	addr := ":" + port

	var store Store
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL != "" {
		log.Printf("[Server] Initializing PostgreSQL connection: %s...", maskDBURL(dbURL))
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		pgStore, err := NewPostgresStore(ctx, dbURL)
		if err != nil {
			log.Fatalf("[Server] Failed to connect to PostgreSQL: %v", err)
		}
		store = pgStore
		log.Printf("[Server] PostgreSQL storage connected with auto-migration.")
	} else {
		dataPath := os.Getenv("DATA_PATH")
		if dataPath == "" {
			dataPath = "data/store.json"
		}

		fileStore, err := NewFileStore(dataPath)
		if err != nil {
			log.Fatalf("[Server] Failed to initialize file store: %v", err)
		}
		store = fileStore
		log.Printf("[Server] File storage initialized (store: %s).", dataPath)
	}
	defer store.Close()

	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		// Look for client/dist relative to project root or cwd
		candidates := []string{
			"static",
			"../client/dist",
			"client/dist",
			"/app/static",
		}
		for _, cand := range candidates {
			if info, err := os.Stat(cand); err == nil && info.IsDir() {
				staticDir = cand
				break
			}
		}
	}
	if staticDir != "" {
		log.Printf("[Server] Single-port SPA static file serving enabled from %s", staticDir)
	}

	uploadDir := strings.TrimSpace(os.Getenv("UPLOAD_DIR"))
	if uploadDir == "" {
		uploadDir = "./data/uploads"
	}
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		log.Fatalf("[Server] Failed to create upload directory %s: %v", uploadDir, err)
	}
	log.Printf("[Server] Upload storage ready at %s", uploadDir)

	hub := NewHub()
	hub.SetStore(store)
	handler := setupRoutes(hub, store, staticDir)

	log.Printf("[Server] WeConnect full-stack server listening on %s...", addr)
	if err := http.ListenAndServe(addr, handler); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[Server] Server error: %v", err)
	}
}
