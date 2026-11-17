package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHealthEndpoint(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if res["status"] != "ok" {
		t.Fatalf("expected status 'ok', got %v", res["status"])
	}
}

func TestMissingQueryParams(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store)

	// Missing both
	req := httptest.NewRequest("GET", "/ws", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing params, got %d", w.Code)
	}

	// Missing user
	req = httptest.NewRequest("GET", "/ws?room=general", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing user, got %d", w.Code)
	}
}

func connectWS(t *testing.T, serverURL, room, user string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("failed to parse url: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/ws"
	q := u.Query()
	q.Set("room", room)
	q.Set("user", user)
	u.RawQuery = q.Encode()

	ws, resp, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		if resp != nil {
			t.Fatalf("dial failed with status %d: %v", resp.StatusCode, err)
		}
		t.Fatalf("dial failed: %v", err)
	}
	return ws
}

func readNextMessage(t *testing.T, ws *websocket.Conn, timeout time.Duration) Message {
	t.Helper()
	_ = ws.SetReadDeadline(time.Now().Add(timeout))
	_, p, err := ws.ReadMessage()
	if err != nil {
		t.Fatalf("read error: %v", err)
	}
	var msg Message
	if err := json.Unmarshal(p, &msg); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	return msg
}

func TestWebSocketWorkflow(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	server := httptest.NewServer(setupRoutes(hub, store))
	defer server.Close()

	// 1. Alice connects to "general"
	aliceConn := connectWS(t, server.URL, "general", "alice")
	defer aliceConn.Close()

	// Alice should receive join message and users message
	msg1 := readNextMessage(t, aliceConn, 2*time.Second)
	if msg1.Type != "join" || msg1.Sender != "alice" {
		t.Fatalf("expected alice join message, got %+v", msg1)
	}

	msg2 := readNextMessage(t, aliceConn, 2*time.Second)
	if msg2.Type != "users" {
		t.Fatalf("expected users message, got %+v", msg2)
	}

	// 2. Bob connects to "general"
	bobConn := connectWS(t, server.URL, "general", "bob")
	defer bobConn.Close()

	// Alice receives bob join
	aliceReceivedBobJoin := readNextMessage(t, aliceConn, 2*time.Second)
	if aliceReceivedBobJoin.Type != "join" || aliceReceivedBobJoin.Sender != "bob" {
		t.Fatalf("alice expected bob join, got %+v", aliceReceivedBobJoin)
	}

	// Alice receives updated users list
	aliceReceivedUsers := readNextMessage(t, aliceConn, 2*time.Second)
	if aliceReceivedUsers.Type != "users" {
		t.Fatalf("alice expected users update, got %+v", aliceReceivedUsers)
	}

	// Bob receives join & users
	bobJoin := readNextMessage(t, bobConn, 2*time.Second)
	if bobJoin.Type != "join" || bobJoin.Sender != "bob" {
		t.Fatalf("bob expected join message, got %+v", bobJoin)
	}
	bobUsers := readNextMessage(t, bobConn, 2*time.Second)
	if bobUsers.Type != "users" {
		t.Fatalf("bob expected users message, got %+v", bobUsers)
	}

	// 3. Alice sends a chat message
	chatMsg := Message{
		Type:    "chat",
		Content: "Hello world!",
	}
	if err := aliceConn.WriteJSON(chatMsg); err != nil {
		t.Fatalf("alice write chat failed: %v", err)
	}

	// Alice receives broadcast of her own message
	aliceChatRecv := readNextMessage(t, aliceConn, 2*time.Second)
	if aliceChatRecv.Type != "chat" || aliceChatRecv.Content != "Hello world!" || aliceChatRecv.Sender != "alice" {
		t.Fatalf("alice chat echo failed: %+v", aliceChatRecv)
	}

	// Bob receives chat message
	bobChatRecv := readNextMessage(t, bobConn, 2*time.Second)
	if bobChatRecv.Type != "chat" || bobChatRecv.Content != "Hello world!" || bobChatRecv.Sender != "alice" {
		t.Fatalf("bob chat receive failed: %+v", bobChatRecv)
	}

	// 4. Targeted WebRTC signal from Alice to Bob
	signalMsg := Message{
		Type: "signal",
		Data: map[string]any{
			"target":     "bob",
			"signalType": "offer",
			"payload":    "dummy-sdp",
		},
	}
	if err := aliceConn.WriteJSON(signalMsg); err != nil {
		t.Fatalf("alice write signal failed: %v", err)
	}

	// Bob should receive this signal
	bobSignalRecv := readNextMessage(t, bobConn, 2*time.Second)
	if bobSignalRecv.Type != "signal" || bobSignalRecv.Sender != "alice" {
		t.Fatalf("bob signal receive failed: %+v", bobSignalRecv)
	}

	// 5. Targeted signal to non-existent user should return error to Alice
	badSignal := Message{
		Type: "signal",
		Data: map[string]any{
			"target":     "charlie",
			"signalType": "offer",
		},
	}
	if err := aliceConn.WriteJSON(badSignal); err != nil {
		t.Fatalf("alice write bad signal failed: %v", err)
	}
	aliceErrRecv := readNextMessage(t, aliceConn, 2*time.Second)
	if aliceErrRecv.Type != "error" || !strings.Contains(aliceErrRecv.Content, "charlie") {
		t.Fatalf("alice expected error for nonexistent user, got %+v", aliceErrRecv)
	}

	// 6. Bob disconnects
	bobConn.Close()

	// Alice receives leave notification and updated users list
	aliceLeaveRecv := readNextMessage(t, aliceConn, 2*time.Second)
	if aliceLeaveRecv.Type != "leave" || aliceLeaveRecv.Sender != "bob" {
		t.Fatalf("alice expected bob leave, got %+v", aliceLeaveRecv)
	}
	aliceUsersAfterBobLeave := readNextMessage(t, aliceConn, 2*time.Second)
	if aliceUsersAfterBobLeave.Type != "users" {
		t.Fatalf("alice expected users update after leave, got %+v", aliceUsersAfterBobLeave)
	}

	// Check room count
	if hub.RoomCount() != 1 {
		t.Fatalf("expected 1 active room, got %d", hub.RoomCount())
	}

	// 7. Alice disconnects, room should be deleted
	aliceConn.Close()
	time.Sleep(100 * time.Millisecond)

	if hub.RoomCount() != 0 {
		t.Fatalf("expected 0 rooms after all users leave, got %d", hub.RoomCount())
	}
}

func doJSONRequest(handler http.Handler, method, path string, body any, token string) *httptest.ResponseRecorder {
	var bodyBytes []byte
	if body != nil {
		bodyBytes, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestAuthEndpoints(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store)

	// 1. Validation failure: short username
	w := doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "ab",
		"password": "password123",
	}, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short username, got %d", w.Code)
	}

	// 2. Validation failure: short password
	w = doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "alice",
		"password": "123",
	}, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short password, got %d", w.Code)
	}

	// 3. Successful registration
	w = doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "alice",
		"password": "password123",
	}, "")
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for registration, got %d (%s)", w.Code, w.Body.String())
	}
	var regRes map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &regRes)
	token, ok := regRes["token"].(string)
	if !ok || token == "" {
		t.Fatalf("expected token in register response")
	}

	// 4. Duplicate registration -> 409
	w = doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "Alice", // case insensitive
		"password": "password123",
	}, "")
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate username, got %d", w.Code)
	}

	// 5. Successful login
	w = doJSONRequest(handler, "POST", "/api/auth/login", map[string]string{
		"username": "alice",
		"password": "password123",
	}, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for login, got %d", w.Code)
	}
	var loginRes map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &loginRes)
	loginToken := loginRes["token"].(string)
	if loginToken == "" {
		t.Fatalf("expected token in login response")
	}

	// 6. Bad credentials -> 401
	w = doJSONRequest(handler, "POST", "/api/auth/login", map[string]string{
		"username": "alice",
		"password": "wrongpassword",
	}, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for bad password, got %d", w.Code)
	}

	// 7. GET /api/auth/me with valid token
	w = doJSONRequest(handler, "GET", "/api/auth/me", nil, loginToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/auth/me, got %d", w.Code)
	}
	var meRes map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &meRes)
	userData := meRes["user"].(map[string]any)
	if userData["username"] != "alice" {
		t.Fatalf("expected username 'alice', got %v", userData["username"])
	}

	// 8. GET /api/auth/me with invalid token -> 401
	w = doJSONRequest(handler, "GET", "/api/auth/me", nil, "invalid-token")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", w.Code)
	}
}

func TestFriendsWorkflow(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	server := httptest.NewServer(setupRoutes(hub, store))
	defer server.Close()

	handler := server.Config.Handler

	// Register alice & bob
	wAlice := doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "alice",
		"password": "password123",
	}, "")
	var aRes map[string]any
	_ = json.Unmarshal(wAlice.Body.Bytes(), &aRes)
	aliceToken := aRes["token"].(string)

	wBob := doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "bob",
		"password": "password123",
	}, "")
	var bRes map[string]any
	_ = json.Unmarshal(wBob.Body.Bytes(), &bRes)
	bobToken := bRes["token"].(string)

	// Connect Bob to WebSocket so we can test online status and friend_update notification
	bobWS := connectWS(t, server.URL, "general", "bob")
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 1*time.Second) // join
	_ = readNextMessage(t, bobWS, 1*time.Second) // users

	// 1. Cannot send friend request to self
	w := doJSONRequest(handler, "POST", "/api/friends/request", map[string]string{
		"targetUsername": "alice",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for self friend request, got %d", w.Code)
	}

	// 2. Cannot send friend request to nonexistent user
	w = doJSONRequest(handler, "POST", "/api/friends/request", map[string]string{
		"targetUsername": "charlie",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for nonexistent user, got %d", w.Code)
	}

	// 3. Alice sends friend request to Bob
	w = doJSONRequest(handler, "POST", "/api/friends/request", map[string]string{
		"targetUsername": "bob",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for friend request, got %d (%s)", w.Code, w.Body.String())
	}

	// Bob should have received a real-time friend_update over WebSocket
	friendUpdateMsg := readNextMessage(t, bobWS, 2*time.Second)
	if friendUpdateMsg.Type != "friend_update" {
		t.Fatalf("expected friend_update on websocket, got %+v", friendUpdateMsg)
	}

	// Check Alice's friends list (should have 1 outgoing pending)
	w = doJSONRequest(handler, "GET", "/api/friends", nil, aliceToken)
	var aFriends FriendsData
	_ = json.Unmarshal(w.Body.Bytes(), &aFriends)
	if len(aFriends.Outgoing) != 1 || aFriends.Outgoing[0].Username != "bob" {
		t.Fatalf("alice expected 1 outgoing pending request to bob, got %+v", aFriends)
	}
	if len(aFriends.Friends) != 0 {
		t.Fatalf("alice should have 0 accepted friends yet")
	}

	// Check Bob's friends list (should have 1 incoming pending from alice)
	w = doJSONRequest(handler, "GET", "/api/friends", nil, bobToken)
	var bFriends FriendsData
	_ = json.Unmarshal(w.Body.Bytes(), &bFriends)
	if len(bFriends.Incoming) != 1 || bFriends.Incoming[0].Username != "alice" {
		t.Fatalf("bob expected 1 incoming request from alice, got %+v", bFriends)
	}

	// 4. Bob accepts friend request from Alice
	w = doJSONRequest(handler, "POST", "/api/friends/accept", map[string]string{
		"fromUsername": "alice",
	}, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for accept request, got %d (%s)", w.Code, w.Body.String())
	}

	// Verify both now have each other in accepted friends list
	w = doJSONRequest(handler, "GET", "/api/friends", nil, aliceToken)
	_ = json.Unmarshal(w.Body.Bytes(), &aFriends)
	if len(aFriends.Friends) != 1 || aFriends.Friends[0].Username != "bob" {
		t.Fatalf("alice expected bob in friends, got %+v", aFriends.Friends)
	}
	// Bob is connected on WS, so online should be true!
	if !aFriends.Friends[0].Online {
		t.Fatalf("alice should see bob as online: true")
	}

	w = doJSONRequest(handler, "GET", "/api/friends", nil, bobToken)
	_ = json.Unmarshal(w.Body.Bytes(), &bFriends)
	if len(bFriends.Friends) != 1 || bFriends.Friends[0].Username != "alice" {
		t.Fatalf("bob expected alice in friends, got %+v", bFriends.Friends)
	}

	// 5. Alice removes Bob
	w = doJSONRequest(handler, "POST", "/api/friends/remove", map[string]string{
		"friendUsername": "bob",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for remove friend, got %d", w.Code)
	}

	// Bob should receive friend_update
	removeUpdateMsg := readNextMessage(t, bobWS, 2*time.Second)
	if removeUpdateMsg.Type != "friend_update" {
		t.Fatalf("expected friend_update on remove, got %+v", removeUpdateMsg)
	}

	// Verify friends list is now empty for both
	w = doJSONRequest(handler, "GET", "/api/friends", nil, aliceToken)
	_ = json.Unmarshal(w.Body.Bytes(), &aFriends)
	if len(aFriends.Friends) != 0 {
		t.Fatalf("expected 0 friends after remove, got %+v", aFriends.Friends)
	}
}
