package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestHealthEndpoint(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store, "")

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
	handler := setupRoutes(hub, store, "")

	// Missing token -> 401 Unauthorized
	req := httptest.NewRequest("GET", "/ws", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing token, got %d", w.Code)
	}

	// Arbitrary ?user= without token -> 401 Unauthorized
	req = httptest.NewRequest("GET", "/ws?room=general&user=spoofed", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated ?user= param, got %d", w.Code)
	}

	// Invalid token -> 401 Unauthorized
	req = httptest.NewRequest("GET", "/ws?room=general&token=invalid-token", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid token, got %d", w.Code)
	}

	// Valid token + missing room -> 400 Bad Request
	_, token, err := store.Register("alice", "password123")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}
	req = httptest.NewRequest("GET", "/ws?token="+token, nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing room with valid token, got %d", w.Code)
	}
}

func connectWS(t *testing.T, serverURL, room, token string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("failed to parse url: %v", err)
	}
	u.Scheme = "ws"
	u.Path = "/ws"
	q := u.Query()
	q.Set("room", room)
	q.Set("token", token)
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
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	_, aliceToken, err := store.Register("alice", "password123")
	if err != nil {
		t.Fatalf("register alice failed: %v", err)
	}
	_, bobToken, err := store.Register("bob", "password123")
	if err != nil {
		t.Fatalf("register bob failed: %v", err)
	}

	// 1. Alice connects to "general"
	aliceConn := connectWS(t, server.URL, "general", aliceToken)
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
	bobConn := connectWS(t, server.URL, "general", bobToken)
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
	handler := setupRoutes(hub, store, "")

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
	server := httptest.NewServer(setupRoutes(hub, store, ""))
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
	bobWS := connectWS(t, server.URL, "general", bobToken)
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

func TestICEConfigAndSPA(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store, "")

	// 1. GET /api/config/ice without TURN
	w := doJSONRequest(handler, "GET", "/api/config/ice", nil, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/config/ice, got %d", w.Code)
	}
	var iceRes ICEConfigResponse
	if err := json.Unmarshal(w.Body.Bytes(), &iceRes); err != nil {
		t.Fatalf("failed to decode ICE config: %v", err)
	}
	if len(iceRes.ICEServers) == 0 || len(iceRes.ICEServers[0].URLs) == 0 {
		t.Fatalf("expected default STUN servers, got %+v", iceRes)
	}

	// 2. GET /api/config/ice with TURN env
	os.Setenv("TURN_URL", "turn:turn.example.com:3478")
	os.Setenv("TURN_USERNAME", "weconnect")
	os.Setenv("TURN_CREDENTIAL", "secret")
	defer func() {
		os.Unsetenv("TURN_URL")
		os.Unsetenv("TURN_USERNAME")
		os.Unsetenv("TURN_CREDENTIAL")
	}()

	w = doJSONRequest(handler, "GET", "/api/config/ice", nil, "")
	var turnRes ICEConfigResponse
	_ = json.Unmarshal(w.Body.Bytes(), &turnRes)
	if len(turnRes.ICEServers) != 2 {
		t.Fatalf("expected 2 ICE servers (STUN + TURN), got %d", len(turnRes.ICEServers))
	}
	if turnRes.ICEServers[1].URLs[0] != "turn:turn.example.com:3478" {
		t.Fatalf("expected TURN url, got %v", turnRes.ICEServers[1].URLs)
	}

	// 3. SPA fallback serving: GET /channels/general
	w = doJSONRequest(handler, "GET", "/channels/general", nil, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for SPA fallback, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "WeConnect") {
		t.Fatalf("expected WeConnect HTML page, got %s", w.Body.String())
	}
}

func dialWSRaw(serverURL, room, user, token string) (*websocket.Conn, *http.Response, error) {
	u, _ := url.Parse(serverURL)
	u.Scheme = "ws"
	u.Path = "/ws"
	q := u.Query()
	if room != "" {
		q.Set("room", room)
	}
	if user != "" {
		q.Set("user", user)
	}
	if token != "" {
		q.Set("token", token)
	}
	u.RawQuery = q.Encode()
	return websocket.DefaultDialer.Dial(u.String(), nil)
}

func TestChatPersistenceAndHistory(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler

	// Register alice
	wAlice := doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
		"username": "alice",
		"password": "password123",
	}, "")
	var aRes map[string]any
	_ = json.Unmarshal(wAlice.Body.Bytes(), &aRes)
	aliceToken := aRes["token"].(string)

	// Invalid token on WS should fail with 401
	_, resp, err := dialWSRaw(server.URL, "general", "", "invalid-token")
	if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for invalid ws token, got err=%v resp=%v", err, resp)
	}

	// Missing token on GET /api/messages should return 401
	w := doJSONRequest(handler, "GET", "/api/messages?room=general", nil, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated /api/messages, got %d", w.Code)
	}

	// Connect alice using token
	aliceWS, _, err := dialWSRaw(server.URL, "general", "", aliceToken)
	if err != nil {
		t.Fatalf("alice ws connect with token failed: %v", err)
	}
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// Send 3 messages in order
	sentContents := []string{"First message", "Second message", "Third message"}
	for _, content := range sentContents {
		if err := aliceWS.WriteJSON(Message{Type: "chat", Content: content}); err != nil {
			t.Fatalf("failed to write chat message: %v", err)
		}
		echo := readNextMessage(t, aliceWS, 2*time.Second)
		if echo.Content != content || echo.Sender != "alice" {
			t.Fatalf("unexpected echo: %+v", echo)
		}
	}

	// Fetch persisted history via GET /api/messages
	w = doJSONRequest(handler, "GET", "/api/messages?room=general&limit=50", nil, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/messages, got %d (%s)", w.Code, w.Body.String())
	}

	var histRes struct {
		Messages []Message `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &histRes); err != nil {
		t.Fatalf("failed to decode messages response: %v", err)
	}

	if len(histRes.Messages) != 3 {
		t.Fatalf("expected 3 persisted messages, got %d: %+v", len(histRes.Messages), histRes.Messages)
	}
	for i, want := range sentContents {
		if histRes.Messages[i].Content != want || histRes.Messages[i].Sender != "alice" || histRes.Messages[i].Room != "general" {
			t.Fatalf("message %d mismatch: want %q from alice, got %+v", i, want, histRes.Messages[i])
		}
	}
}

func TestDMAccessControl(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler

	registerUser := func(username string) string {
		w := doJSONRequest(handler, "POST", "/api/auth/register", map[string]string{
			"username": username,
			"password": "password123",
		}, "")
		var res map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		return res["token"].(string)
	}

	aliceToken := registerUser("alice")
	bobToken := registerUser("bob")
	charlieToken := registerUser("charlie")

	dmRoom := "dm:alice:bob"

	// 1. Alice connects to dm:alice:bob -> allowed
	aliceWS, _, err := dialWSRaw(server.URL, dmRoom, "", aliceToken)
	if err != nil {
		t.Fatalf("alice should be allowed to join %s: %v", dmRoom, err)
	}
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// 2. Bob connects to dm:alice:bob -> allowed
	bobWS, _, err := dialWSRaw(server.URL, dmRoom, "", bobToken)
	if err != nil {
		t.Fatalf("bob should be allowed to join %s: %v", dmRoom, err)
	}
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second)   // join
	_ = readNextMessage(t, bobWS, 2*time.Second)   // users
	_ = readNextMessage(t, aliceWS, 2*time.Second) // bob join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// Alice sends private DM
	if err := aliceWS.WriteJSON(Message{Type: "chat", Content: "Secret hello Bob"}); err != nil {
		t.Fatalf("alice dm send failed: %v", err)
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second)
	bobMsg := readNextMessage(t, bobWS, 2*time.Second)
	if bobMsg.Content != "Secret hello Bob" || bobMsg.Sender != "alice" {
		t.Fatalf("bob expected DM from alice, got %+v", bobMsg)
	}

	// 3. Charlie connects to dm:alice:bob with token -> 403 Forbidden
	_, resp, err := dialWSRaw(server.URL, dmRoom, "", charlieToken)
	if err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for charlie WS in %s, got err=%v resp=%v", dmRoom, err, resp)
	}

	// 4. Unauthenticated connection attempt (even with user=alice) -> 401 Unauthorized
	_, resp, err = dialWSRaw(server.URL, dmRoom, "alice", "")
	if err == nil || resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated WS in %s, got err=%v resp=%v", dmRoom, err, resp)
	}

	// 5. Alice & Bob can fetch DM history via GET /api/messages
	for name, tok := range map[string]string{"alice": aliceToken, "bob": bobToken} {
		w := doJSONRequest(handler, "GET", "/api/messages?room="+dmRoom, nil, tok)
		if w.Code != http.StatusOK {
			t.Fatalf("%s expected 200 for DM history, got %d (%s)", name, w.Code, w.Body.String())
		}
		var hist struct {
			Messages []Message `json:"messages"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &hist)
		if len(hist.Messages) != 1 || hist.Messages[0].Content != "Secret hello Bob" {
			t.Fatalf("%s expected 1 DM message, got %+v", name, hist.Messages)
		}
	}

	// 6. Charlie gets 403 Forbidden on GET /api/messages for dm:alice:bob
	w := doJSONRequest(handler, "GET", "/api/messages?room="+dmRoom, nil, charlieToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for charlie on DM history, got %d (%s)", w.Code, w.Body.String())
	}
}

func TestCustomChannels(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler

	// 1. Unauthenticated GET /api/channels -> 401
	w := doJSONRequest(handler, "GET", "/api/channels", nil, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated /api/channels, got %d", w.Code)
	}

	// Register alice & bob
	_, aliceToken, err := store.Register("alice", "password123")
	if err != nil {
		t.Fatalf("register alice failed: %v", err)
	}
	_, bobToken, err := store.Register("bob", "password123")
	if err != nil {
		t.Fatalf("register bob failed: %v", err)
	}

	// 2. GET /api/channels -> auto-seeded ONLY random and voice-lounge
	w = doJSONRequest(handler, "GET", "/api/channels", nil, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for GET /api/channels, got %d", w.Code)
	}
	var listRes struct {
		Channels []Channel `json:"channels"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listRes); err != nil {
		t.Fatalf("decode channels failed: %v", err)
	}
	if len(listRes.Channels) != 2 {
		t.Fatalf("expected 2 default seeded channels (random, voice-lounge), got %d: %+v", len(listRes.Channels), listRes.Channels)
	}
	if listRes.Channels[0].ID != "random" || listRes.Channels[0].Name != "Random" || listRes.Channels[0].Type != "text" {
		t.Fatalf("unexpected first default channel: %+v", listRes.Channels[0])
	}
	if listRes.Channels[1].ID != "voice-lounge" || listRes.Channels[1].Name != "Voice Lounge" || listRes.Channels[1].Type != "voice" {
		t.Fatalf("unexpected second default channel: %+v", listRes.Channels[1])
	}

	// Connect alice to WS to verify live channel_update broadcasts
	aliceWS := connectWS(t, server.URL, "random", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// 3. Invalid name/type validation -> 400
	w = doJSONRequest(handler, "POST", "/api/channels", map[string]string{
		"name": "a",
		"type": "text",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short channel name, got %d", w.Code)
	}
	w = doJSONRequest(handler, "POST", "/api/channels", map[string]string{
		"name": "design",
		"type": "invalid",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid channel type, got %d", w.Code)
	}

	// 4. Alice creates a text room & a voice room -> 201 + channel_update broadcast
	w = doJSONRequest(handler, "POST", "/api/channels", map[string]string{
		"name":  "Design Sync",
		"type":  "text",
		"topic": "Weekly design reviews",
	}, aliceToken)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for create text channel, got %d (%s)", w.Code, w.Body.String())
	}
	var createRes struct {
		Channel Channel `json:"channel"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &createRes)
	if createRes.Channel.ID != "design-sync" || createRes.Channel.CreatedBy != "alice" {
		t.Fatalf("unexpected created channel: %+v", createRes.Channel)
	}
	updateMsg := readNextMessage(t, aliceWS, 2*time.Second)
	if updateMsg.Type != "channel_update" {
		t.Fatalf("expected channel_update WS broadcast on create, got %+v", updateMsg)
	}

	w = doJSONRequest(handler, "POST", "/api/channels", map[string]string{
		"name":  "Standup Room",
		"type":  "voice",
		"topic": "Daily standup voice group",
	}, aliceToken)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for create voice channel, got %d (%s)", w.Code, w.Body.String())
	}
	updateMsg = readNextMessage(t, aliceWS, 2*time.Second)
	if updateMsg.Type != "channel_update" {
		t.Fatalf("expected channel_update WS broadcast on voice create, got %+v", updateMsg)
	}

	// 5. Duplicate channel -> 409 Conflict
	w = doJSONRequest(handler, "POST", "/api/channels", map[string]string{
		"name": "Design Sync",
		"type": "text",
	}, aliceToken)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate channel, got %d", w.Code)
	}

	// 6. Creator-only deletion: Bob cannot delete Alice's text or voice rooms -> 403 Forbidden
	w = doJSONRequest(handler, "DELETE", "/api/channels?id=design-sync", nil, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Bob tries to delete Alice's text room, got %d (%s)", w.Code, w.Body.String())
	}
	w = doJSONRequest(handler, "DELETE", "/api/channels?id=standup-room", nil, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Bob tries to delete Alice's voice room, got %d (%s)", w.Code, w.Body.String())
	}

	// 7. Default system rooms cannot be deleted -> 403 Forbidden
	w = doJSONRequest(handler, "DELETE", "/api/channels?id=random", nil, aliceToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for deleting default random channel, got %d (%s)", w.Code, w.Body.String())
	}
	w = doJSONRequest(handler, "DELETE", "/api/channels?id=voice-lounge", nil, aliceToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for deleting default voice-lounge channel, got %d (%s)", w.Code, w.Body.String())
	}

	// 8. Delete non-existent channel -> 404 Not Found
	w = doJSONRequest(handler, "DELETE", "/api/channels?id=does-not-exist", nil, aliceToken)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for deleting unknown channel, got %d", w.Code)
	}

	// 9. Alice deletes her own text and voice rooms -> 200 OK + channel_update broadcast
	for _, id := range []string{"design-sync", "standup-room"} {
		w = doJSONRequest(handler, "DELETE", "/api/channels?id="+id, nil, aliceToken)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 for creator deleting %s, got %d (%s)", id, w.Code, w.Body.String())
		}
		delUpdateMsg := readNextMessage(t, aliceWS, 2*time.Second)
		if delUpdateMsg.Type != "channel_update" {
			t.Fatalf("expected channel_update WS broadcast on delete %s, got %+v", id, delUpdateMsg)
		}
	}

	// Verify channel count returned to 2 defaults
	w = doJSONRequest(handler, "GET", "/api/channels", nil, aliceToken)
	_ = json.Unmarshal(w.Body.Bytes(), &listRes)
	if len(listRes.Channels) != 2 {
		t.Fatalf("expected 2 channels after delete, got %d", len(listRes.Channels))
	}
}

func TestLegacySystemChannelCleanup(t *testing.T) {
	tmpFile := t.TempDir() + "/store.json"
	legacyJSON := `{
		"users": {},
		"friendships": {},
		"tokens": {},
		"channels": [
			{"id": "general", "name": "general", "type": "text", "createdBy": "system"},
			{"id": "random", "name": "random", "type": "text", "createdBy": "system"},
			{"id": "dev-chat", "name": "dev-chat", "type": "text", "createdBy": "system"},
			{"id": "voice-lounge", "name": "Voice Lounge", "type": "voice", "createdBy": "system"},
			{"id": "gaming", "name": "Gaming Room", "type": "voice", "createdBy": "system"},
			{"id": "my-room", "name": "My Room", "type": "text", "createdBy": "alice"}
		]
	}`
	if err := os.WriteFile(tmpFile, []byte(legacyJSON), 0644); err != nil {
		t.Fatalf("write legacy store failed: %v", err)
	}

	store, err := NewFileStore(tmpFile)
	if err != nil {
		t.Fatalf("NewFileStore failed: %v", err)
	}
	channels, err := store.GetChannels()
	if err != nil {
		t.Fatalf("GetChannels failed: %v", err)
	}
	if len(channels) != 3 {
		t.Fatalf("expected 3 channels (random, voice-lounge, my-room), got %d: %+v", len(channels), channels)
	}
	for _, ch := range channels {
		if ch.ID == "general" || ch.ID == "dev-chat" || ch.ID == "gaming" {
			t.Fatalf("legacy system channel %s should have been removed", ch.ID)
		}
	}
}

func TestTypingAndUnreadNotifications(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler

	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")
	_, charlieToken, _ := store.Register("charlie", "password123")

	// 1. Alice and Bob both connect to "random"
	aliceWS := connectWS(t, server.URL, "random", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	bobRandomInitialWS := connectWS(t, server.URL, "random", bobToken)
	_ = readNextMessage(t, bobRandomInitialWS, 2*time.Second) // join
	_ = readNextMessage(t, bobRandomInitialWS, 2*time.Second) // users
	_ = readNextMessage(t, aliceWS, 2*time.Second)            // bob join
	_ = readNextMessage(t, aliceWS, 2*time.Second)            // users

	// Alice sends typing event
	if err := aliceWS.WriteJSON(Message{
		Type: "typing",
		Data: map[string]any{"isTyping": true},
	}); err != nil {
		t.Fatalf("write typing failed: %v", err)
	}

	// Bob receives typing event
	_ = readNextMessage(t, aliceWS, 2*time.Second) // echo
	bobTyping := readNextMessage(t, bobRandomInitialWS, 2*time.Second)
	if bobTyping.Type != "typing" || bobTyping.Sender != "alice" {
		t.Fatalf("bob expected typing from alice, got %+v", bobTyping)
	}

	// Verify typing event was NOT persisted to message history
	w := doJSONRequest(handler, "GET", "/api/messages?room=random", nil, aliceToken)
	var hist struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &hist)
	if len(hist.Messages) != 0 {
		t.Fatalf("typing indicator must not be persisted, got %d messages", len(hist.Messages))
	}

	// 2. Bob switches to "voice-lounge" room; Charlie also in "voice-lounge"
	bobRandomInitialWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // bob leave
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	bobOtherWS := connectWS(t, server.URL, "voice-lounge", bobToken)
	defer bobOtherWS.Close()
	_ = readNextMessage(t, bobOtherWS, 2*time.Second) // join
	_ = readNextMessage(t, bobOtherWS, 2*time.Second) // users

	charlieOtherWS := connectWS(t, server.URL, "voice-lounge", charlieToken)
	defer charlieOtherWS.Close()
	_ = readNextMessage(t, charlieOtherWS, 2*time.Second) // join
	_ = readNextMessage(t, charlieOtherWS, 2*time.Second) // users
	_ = readNextMessage(t, bobOtherWS, 2*time.Second)     // charlie join
	_ = readNextMessage(t, bobOtherWS, 2*time.Second)     // users

	// Alice sends public chat in "random" -> Bob and Charlie (in "voice-lounge") get unread notification
	if err := aliceWS.WriteJSON(Message{Type: "chat", Content: "Public ping"}); err != nil {
		t.Fatalf("write chat failed: %v", err)
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second)

	bobUnread := readNextMessage(t, bobOtherWS, 2*time.Second)
	if bobUnread.Type != "unread" || bobUnread.Room != "random" || bobUnread.Sender != "alice" {
		t.Fatalf("bob expected unread for random, got %+v", bobUnread)
	}
	charlieUnread := readNextMessage(t, charlieOtherWS, 2*time.Second)
	if charlieUnread.Type != "unread" || charlieUnread.Room != "random" || charlieUnread.Sender != "alice" {
		t.Fatalf("charlie expected unread for random, got %+v", charlieUnread)
	}

	// 3. Alice sends DM in "dm:alice:bob" while Bob & Charlie are in "voice-lounge"
	// Only Bob should receive unread for dm:alice:bob WITH Content preview; Charlie must NOT receive it
	aliceDMWS := connectWS(t, server.URL, "dm:alice:bob", aliceToken)
	defer aliceDMWS.Close()
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // users

	if err := aliceDMWS.WriteJSON(Message{Type: "chat", Content: "Private DM ping"}); err != nil {
		t.Fatalf("write dm failed: %v", err)
	}
	_ = readNextMessage(t, aliceDMWS, 2*time.Second)

	bobDMUnread := readNextMessage(t, bobOtherWS, 2*time.Second)
	if bobDMUnread.Type != "unread" || bobDMUnread.Room != "dm:alice:bob" || bobDMUnread.Sender != "alice" || bobDMUnread.Content != "Private DM ping" {
		t.Fatalf("bob expected unread for dm:alice:bob with content preview, got %+v", bobDMUnread)
	}

	// Also verify long DM message preview is truncated safely to <= 100 runes
	longMsg := strings.Repeat("a", 150)
	if err := aliceDMWS.WriteJSON(Message{Type: "chat", Content: longMsg}); err != nil {
		t.Fatalf("write long dm failed: %v", err)
	}
	_ = readNextMessage(t, aliceDMWS, 2*time.Second)
	bobLongUnread := readNextMessage(t, bobOtherWS, 2*time.Second)
	if len([]rune(bobLongUnread.Content)) > 100 || !strings.HasSuffix(bobLongUnread.Content, "…") {
		t.Fatalf("expected truncated preview <= 100 runes ending with ellipsis, got len=%d content=%q", len([]rune(bobLongUnread.Content)), bobLongUnread.Content)
	}

	// Verify Charlie does NOT receive DM unread
	_ = charlieOtherWS.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, raw, err := charlieOtherWS.ReadMessage(); err == nil {
		t.Fatalf("charlie should NOT receive unread for dm:alice:bob, got %s", string(raw))
	}
}

func doMultipartUpload(t *testing.T, handler http.Handler, fieldName, filename string, content []byte, token string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		t.Fatalf("create form file failed: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file failed: %v", err)
	}
	_ = writer.Close()

	req := httptest.NewRequest("POST", "/api/upload", &buf)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func TestFileUploads(t *testing.T) {
	t.Setenv("UPLOAD_DIR", t.TempDir())

	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store, "")

	_, token, err := store.Register("alice", "password123")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	// Minimal valid PNG header + bytes
	pngBytes := []byte{
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	}

	// 1. Unauthenticated upload -> 401
	w := doMultipartUpload(t, handler, "file", "pic.png", pngBytes, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated upload, got %d", w.Code)
	}

	// 2. Valid PNG image upload -> 201 + serves exact bytes + nosniff
	w = doMultipartUpload(t, handler, "file", "screenshot.png", pngBytes, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for PNG upload, got %d (%s)", w.Code, w.Body.String())
	}
	var imgRes struct {
		URL      string `json:"url"`
		Name     string `json:"name"`
		Size     int64  `json:"size"`
		MimeType string `json:"mimeType"`
		IsImage  bool   `json:"isImage"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &imgRes); err != nil {
		t.Fatalf("decode upload response failed: %v", err)
	}
	if !imgRes.IsImage || imgRes.MimeType != "image/png" || imgRes.Name != "screenshot.png" || imgRes.Size != int64(len(pngBytes)) {
		t.Fatalf("unexpected image upload response: %+v", imgRes)
	}

	getReq := httptest.NewRequest("GET", imgRes.URL, nil)
	getW := httptest.NewRecorder()
	handler.ServeHTTP(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 serving uploaded image, got %d", getW.Code)
	}
	if getW.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("expected X-Content-Type-Options: nosniff")
	}
	if !bytes.Equal(getW.Body.Bytes(), pngBytes) {
		t.Fatalf("served image bytes did not match uploaded bytes")
	}

	// 3. Valid PDF document upload -> 201 + Content-Disposition: attachment + nosniff
	pdfBytes := []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n")
	w = doMultipartUpload(t, handler, "file", "spec.pdf", pdfBytes, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for PDF upload, got %d (%s)", w.Code, w.Body.String())
	}
	var docRes struct {
		URL      string `json:"url"`
		Name     string `json:"name"`
		MimeType string `json:"mimeType"`
		IsImage  bool   `json:"isImage"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &docRes)
	if docRes.IsImage || docRes.MimeType != "application/pdf" {
		t.Fatalf("unexpected doc upload response: %+v", docRes)
	}

	getDocReq := httptest.NewRequest("GET", docRes.URL, nil)
	getDocW := httptest.NewRecorder()
	handler.ServeHTTP(getDocW, getDocReq)
	if getDocW.Code != http.StatusOK {
		t.Fatalf("expected 200 serving uploaded PDF, got %d", getDocW.Code)
	}
	if getDocW.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("expected nosniff header on document")
	}
	if !strings.Contains(getDocW.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("expected Content-Disposition attachment for non-image, got %q", getDocW.Header().Get("Content-Disposition"))
	}
	if !bytes.Equal(getDocW.Body.Bytes(), pdfBytes) {
		t.Fatalf("served PDF bytes did not match uploaded bytes")
	}

	// 4. Dangerous extension rejected -> 400
	for _, badFile := range []string{"evil.sh", "payload.exe", "xss.html", "script.js"} {
		w = doMultipartUpload(t, handler, "file", badFile, []byte("hello"), token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for blocked file %s, got %d", badFile, w.Code)
		}
	}

	// 5. Oversized file (>10MB) rejected -> 413
	oversized := bytes.Repeat([]byte("A"), maxUploadSize+1024)
	w = doMultipartUpload(t, handler, "file", "huge.txt", oversized, token)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for oversized file, got %d (%s)", w.Code, w.Body.String())
	}

	// 6. Path traversal attempts rejected -> 400
	for _, badPath := range []string{
		"/api/uploads/..%2F..%2Fetc%2Fpasswd",
		"/api/uploads/foo..bar.txt",
		"/api/uploads/sub/file.txt",
	} {
		req := httptest.NewRequest("GET", badPath, nil)
		rw := httptest.NewRecorder()
		handler.ServeHTTP(rw, req)
		if rw.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for traversal path %s, got %d", badPath, rw.Code)
		}
	}

	// 7. Missing file -> 404
	missingReq := httptest.NewRequest("GET", "/api/uploads/nonexistent12345.png", nil)
	missingW := httptest.NewRecorder()
	handler.ServeHTTP(missingW, missingReq)
	if missingW.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing upload, got %d", missingW.Code)
	}
}

func TestGifSearchEndpoint(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store, "")

	_, token, _ := store.Register("alice", "password123")

	// Unauthenticated -> 401
	w := doJSONRequest(handler, "GET", "/api/gifs?q=wave", nil, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated /api/gifs, got %d", w.Code)
	}

	// Authenticated default list -> 200 curated
	w = doJSONRequest(handler, "GET", "/api/gifs", nil, token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/gifs, got %d", w.Code)
	}
	var gifRes struct {
		Gifs   []GifItem `json:"gifs"`
		Source string    `json:"source"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &gifRes); err != nil {
		t.Fatalf("decode gifs failed: %v", err)
	}
	if len(gifRes.Gifs) == 0 || gifRes.Source != "curated" {
		t.Fatalf("expected curated gifs, got %+v", gifRes)
	}

	// Filtered query
	w = doJSONRequest(handler, "GET", "/api/gifs?q=coffee", nil, token)
	_ = json.Unmarshal(w.Body.Bytes(), &gifRes)
	if len(gifRes.Gifs) == 0 || !strings.Contains(strings.ToLower(gifRes.Gifs[0].Title), "coffee") {
		t.Fatalf("expected coffee gif match, got %+v", gifRes.Gifs)
	}
}

func TestRichMessagePersistence(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler
	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")

	aliceWS := connectWS(t, server.URL, "random", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// 1. Attachment-only chat message (empty Content, non-nil Data)
	attData := map[string]any{
		"attachment": map[string]any{
			"url":      "/api/uploads/abc123.png",
			"name":     "diagram.png",
			"size":     float64(2048),
			"mimeType": "image/png",
			"isImage":  true,
		},
	}
	if err := aliceWS.WriteJSON(Message{Type: "chat", Content: "", Data: attData}); err != nil {
		t.Fatalf("write attachment msg failed: %v", err)
	}
	attEcho := readNextMessage(t, aliceWS, 2*time.Second)
	if attEcho.ID == "" || attEcho.Type != "chat" || attEcho.Data == nil {
		t.Fatalf("expected chat echo with generated ID and data, got %+v", attEcho)
	}

	// 2. Sticker-only chat message
	stickerData := map[string]any{
		"sticker": map[string]any{
			"id":       "wave",
			"label":    "Wave",
			"category": "greetings",
		},
	}
	if err := aliceWS.WriteJSON(Message{Type: "chat", Content: "", Data: stickerData}); err != nil {
		t.Fatalf("write sticker msg failed: %v", err)
	}
	stickerEcho := readNextMessage(t, aliceWS, 2*time.Second)
	if stickerEcho.ID == "" || stickerEcho.ID == attEcho.ID {
		t.Fatalf("expected distinct generated ID for sticker message, got %+v", stickerEcho)
	}

	// 3. Verify GET /api/messages returns both rich messages with ID and Data intact
	w := doJSONRequest(handler, "GET", "/api/messages?room=random&limit=50", nil, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/messages, got %d", w.Code)
	}
	var hist struct {
		Messages []Message `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &hist); err != nil {
		t.Fatalf("decode messages failed: %v", err)
	}
	if len(hist.Messages) != 2 {
		t.Fatalf("expected 2 rich persisted messages, got %d", len(hist.Messages))
	}
	if hist.Messages[0].ID != attEcho.ID || hist.Messages[0].Data == nil {
		t.Fatalf("first message ID/Data mismatch: %+v", hist.Messages[0])
	}
	if hist.Messages[1].ID != stickerEcho.ID || hist.Messages[1].Data == nil {
		t.Fatalf("second message ID/Data mismatch: %+v", hist.Messages[1])
	}

	// 4. Verify DM sticker-only message sends clean rich preview on unread notification
	bobWS := connectWS(t, server.URL, "voice-lounge", bobToken)
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second) // join
	_ = readNextMessage(t, bobWS, 2*time.Second) // users

	aliceDMWS := connectWS(t, server.URL, "dm:alice:bob", aliceToken)
	defer aliceDMWS.Close()
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // users

	if err := aliceDMWS.WriteJSON(Message{Type: "chat", Content: "", Data: stickerData}); err != nil {
		t.Fatalf("write dm sticker failed: %v", err)
	}
	_ = readNextMessage(t, aliceDMWS, 2*time.Second)
	bobUnread := readNextMessage(t, bobWS, 2*time.Second)
	if bobUnread.Type != "unread" || bobUnread.Content != "Sent sticker: Wave" {
		t.Fatalf("expected rich DM unread preview 'Sent sticker: Wave', got %+v", bobUnread)
	}
}

func TestMessageEditDeleteReactAndSearch(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler
	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")
	_, charlieToken, _ := store.Register("charlie", "password123")

	aliceWS := connectWS(t, server.URL, "random", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	bobWS := connectWS(t, server.URL, "random", bobToken)
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second)   // join
	_ = readNextMessage(t, bobWS, 2*time.Second)   // users
	_ = readNextMessage(t, aliceWS, 2*time.Second) // bob join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// Alice sends a message with replyTo metadata
	if err := aliceWS.WriteJSON(Message{
		Type:    "chat",
		Content: "Initial draft message",
		Data: map[string]any{
			"replyTo": map[string]any{"id": "orig1", "sender": "bob", "content": "Hello"},
		},
	}); err != nil {
		t.Fatalf("write chat failed: %v", err)
	}
	aliceEcho := readNextMessage(t, aliceWS, 2*time.Second)
	_ = readNextMessage(t, bobWS, 2*time.Second)
	msgID := aliceEcho.ID
	if msgID == "" {
		t.Fatalf("expected generated message ID")
	}

	// 1. Edit permissions: Bob cannot edit Alice's message -> 403
	w := doJSONRequest(handler, "PUT", "/api/messages", map[string]string{
		"id":      msgID,
		"room":    "random",
		"content": "Hacked edit",
	}, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author edit, got %d (%s)", w.Code, w.Body.String())
	}

	// Empty content -> 400
	w = doJSONRequest(handler, "PUT", "/api/messages", map[string]string{
		"id":      msgID,
		"room":    "random",
		"content": "   ",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty edit content, got %d", w.Code)
	}

	// Alice edits her own message -> 200 + edited=true + preserves replyTo + message_update broadcast
	w = doJSONRequest(handler, "PUT", "/api/messages", map[string]string{
		"id":      msgID,
		"room":    "random",
		"content": "Updated polished message",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for author edit, got %d (%s)", w.Code, w.Body.String())
	}
	var editRes struct {
		Message Message `json:"message"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &editRes)
	editData, ok := editRes.Message.Data.(map[string]any)
	if !ok || editData["edited"] != true || editData["replyTo"] == nil {
		t.Fatalf("expected edited=true and preserved replyTo, got %+v", editRes.Message.Data)
	}

	aliceUpdate := readNextMessage(t, aliceWS, 2*time.Second)
	bobUpdate := readNextMessage(t, bobWS, 2*time.Second)
	if aliceUpdate.Type != "message_update" || bobUpdate.Type != "message_update" || bobUpdate.Content != "Updated polished message" {
		t.Fatalf("expected message_update broadcast, got alice=%+v bob=%+v", aliceUpdate, bobUpdate)
	}

	// 2. Reactions: toggle add & remove + broadcast
	w = doJSONRequest(handler, "POST", "/api/messages/react", map[string]string{
		"id":    msgID,
		"room":  "random",
		"emoji": "👍",
	}, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for react add, got %d (%s)", w.Code, w.Body.String())
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second)
	reactAddMsg := readNextMessage(t, bobWS, 2*time.Second)
	if reactAddMsg.Type != "message_update" {
		t.Fatalf("expected message_update on react add, got %+v", reactAddMsg)
	}
	rm, _ := reactAddMsg.Data.(map[string]any)["reactions"].(map[string]any)
	if rm == nil || len(rm["👍"].([]any)) != 1 {
		t.Fatalf("expected 1 👍 reaction, got %+v", reactAddMsg.Data)
	}

	// Toggle same emoji off by Bob -> pruned cleanly
	w = doJSONRequest(handler, "POST", "/api/messages/react", map[string]string{
		"id":    msgID,
		"room":  "random",
		"emoji": "👍",
	}, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for react remove, got %d", w.Code)
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second)
	reactRemMsg := readNextMessage(t, bobWS, 2*time.Second)
	if dataMap, ok := reactRemMsg.Data.(map[string]any); ok {
		if _, hasReactions := dataMap["reactions"]; hasReactions {
			t.Fatalf("expected empty reactions map to be pruned, got %+v", dataMap["reactions"])
		}
	}

	// Oversized emoji -> 400
	w = doJSONRequest(handler, "POST", "/api/messages/react", map[string]string{
		"id":    msgID,
		"room":  "random",
		"emoji": strings.Repeat("👍", 20),
	}, bobToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized emoji, got %d", w.Code)
	}

	// 3. SearchMessages (case-insensitive + DM 403 protection)
	w = doJSONRequest(handler, "GET", "/api/messages/search?room=random&q=POLISHED", nil, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for message search, got %d", w.Code)
	}
	var searchRes struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &searchRes)
	if len(searchRes.Messages) != 1 || searchRes.Messages[0].ID != msgID {
		t.Fatalf("expected 1 search match for 'POLISHED', got %+v", searchRes.Messages)
	}

	// Unauthorized DM search -> 403
	w = doJSONRequest(handler, "GET", "/api/messages/search?room=dm:alice:bob&q=secret", nil, charlieToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for charlie searching dm:alice:bob, got %d", w.Code)
	}

	// 4. Delete permissions: Bob cannot delete Alice's message -> 403
	w = doJSONRequest(handler, "DELETE", "/api/messages?id="+msgID+"&room=random", nil, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-author delete, got %d (%s)", w.Code, w.Body.String())
	}

	// Alice deletes her own message -> 200 + message_delete broadcast + removed from history
	w = doJSONRequest(handler, "DELETE", "/api/messages?id="+msgID+"&room=random", nil, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for author delete, got %d (%s)", w.Code, w.Body.String())
	}
	aliceDel := readNextMessage(t, aliceWS, 2*time.Second)
	bobDel := readNextMessage(t, bobWS, 2*time.Second)
	if aliceDel.Type != "message_delete" || bobDel.Type != "message_delete" || bobDel.ID != msgID {
		t.Fatalf("expected message_delete broadcast, got alice=%+v bob=%+v", aliceDel, bobDel)
	}

	w = doJSONRequest(handler, "GET", "/api/messages?room=random", nil, aliceToken)
	_ = json.Unmarshal(w.Body.Bytes(), &searchRes)
	if len(searchRes.Messages) != 0 {
		t.Fatalf("expected 0 messages in room after delete, got %d", len(searchRes.Messages))
	}

	// Deleting again -> 404
	w = doJSONRequest(handler, "DELETE", "/api/messages?id="+msgID+"&room=random", nil, aliceToken)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for deleting already-deleted message, got %d", w.Code)
	}
}

func TestIncomingDMCallNotifications(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")
	_, charlieToken, _ := store.Register("charlie", "password123")

	// Bob & Charlie are connected in "random"
	bobWS := connectWS(t, server.URL, "random", bobToken)
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second) // join
	_ = readNextMessage(t, bobWS, 2*time.Second) // users

	charlieWS := connectWS(t, server.URL, "random", charlieToken)
	defer charlieWS.Close()
	_ = readNextMessage(t, charlieWS, 2*time.Second) // join
	_ = readNextMessage(t, charlieWS, 2*time.Second) // users
	_ = readNextMessage(t, bobWS, 2*time.Second)     // charlie join
	_ = readNextMessage(t, bobWS, 2*time.Second)     // users

	// Alice connects to dm:alice:bob
	aliceDMWS := connectWS(t, server.URL, "dm:alice:bob", aliceToken)
	defer aliceDMWS.Close()
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // users

	// 1. Alice sends call-join -> Bob receives incoming_call
	if err := aliceDMWS.WriteJSON(Message{Type: "call-join"}); err != nil {
		t.Fatalf("alice call-join failed: %v", err)
	}
	aliceEcho := readNextMessage(t, aliceDMWS, 2*time.Second)
	if aliceEcho.Type != "call-join" {
		t.Fatalf("expected call-join room broadcast echo, got %+v", aliceEcho)
	}

	bobRing := readNextMessage(t, bobWS, 2*time.Second)
	if bobRing.Type != "incoming_call" || bobRing.Room != "dm:alice:bob" || bobRing.Sender != "alice" {
		t.Fatalf("bob expected incoming_call from alice for dm:alice:bob, got %+v", bobRing)
	}

	// Charlie should NOT receive incoming_call
	_ = charlieWS.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, raw, err := charlieWS.ReadMessage(); err == nil {
		t.Fatalf("charlie should NOT receive incoming_call, got %s", string(raw))
	}

	// 2. Bob declines from random (passing dm:alice:bob) -> Alice receives call_declined
	if err := bobWS.WriteJSON(Message{Type: "call-decline", Room: "dm:alice:bob"}); err != nil {
		t.Fatalf("bob call-decline failed: %v", err)
	}
	_ = readNextMessage(t, bobWS, 2*time.Second) // room broadcast echo in random
	aliceDeclined := readNextMessage(t, aliceDMWS, 2*time.Second)
	if aliceDeclined.Type != "call_declined" || aliceDeclined.Room != "dm:alice:bob" || aliceDeclined.Sender != "bob" {
		t.Fatalf("alice expected call_declined from bob, got %+v", aliceDeclined)
	}

	// 3. Alice sends call-leave -> Bob receives call_ended
	if err := aliceDMWS.WriteJSON(Message{Type: "call-leave"}); err != nil {
		t.Fatalf("alice call-leave failed: %v", err)
	}
	_ = readNextMessage(t, aliceDMWS, 2*time.Second) // room broadcast echo
	bobEnded := readNextMessage(t, bobWS, 2*time.Second)
	if bobEnded.Type != "call_ended" || bobEnded.Room != "dm:alice:bob" || bobEnded.Sender != "alice" {
		t.Fatalf("bob expected call_ended from alice, got %+v", bobEnded)
	}
}

func TestPrivateChannelsAndInvites(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler
	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")
	_, charlieToken, _ := store.Register("charlie", "password123")

	// Bob & Charlie connect to "random"
	bobWS := connectWS(t, server.URL, "random", bobToken)
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second) // join
	_ = readNextMessage(t, bobWS, 2*time.Second) // users

	charlieWS := connectWS(t, server.URL, "random", charlieToken)
	defer charlieWS.Close()
	_ = readNextMessage(t, charlieWS, 2*time.Second) // join
	_ = readNextMessage(t, charlieWS, 2*time.Second) // users
	_ = readNextMessage(t, bobWS, 2*time.Second)     // charlie join
	_ = readNextMessage(t, bobWS, 2*time.Second)     // users

	// 1. Alice creates a private group
	w := doJSONRequest(handler, "POST", "/api/channels", map[string]any{
		"name":      "Secret Club",
		"type":      "text",
		"topic":     "Invite-only room",
		"isPrivate": true,
	}, aliceToken)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 creating private channel, got %d (%s)", w.Code, w.Body.String())
	}
	var createRes struct {
		Channel Channel `json:"channel"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &createRes)
	if !createRes.Channel.IsPrivate || len(createRes.Channel.Members) != 1 || createRes.Channel.Members[0] != "alice" {
		t.Fatalf("unexpected private channel: %+v", createRes.Channel)
	}

	// Visibility isolation: Alice sees 3 channels, Bob & Charlie see only 2 defaults
	hasChannel := func(tok, id string) bool {
		resp := doJSONRequest(handler, "GET", "/api/channels", nil, tok)
		var res struct {
			Channels []Channel `json:"channels"`
		}
		_ = json.Unmarshal(resp.Body.Bytes(), &res)
		for _, ch := range res.Channels {
			if ch.ID == id {
				return true
			}
		}
		return false
	}
	if !hasChannel(aliceToken, "secret-club") {
		t.Fatalf("alice should see secret-club")
	}
	if hasChannel(bobToken, "secret-club") || hasChannel(charlieToken, "secret-club") {
		t.Fatalf("bob and charlie should NOT see secret-club before invite")
	}

	// 2. Non-member Bob gets 403 on /ws, /api/messages, and /api/messages/search
	_, wsResp, err := dialWSRaw(server.URL, "secret-club", "", bobToken)
	if err == nil || wsResp == nil || wsResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member bob on private /ws, got err=%v resp=%v", err, wsResp)
	}
	w = doJSONRequest(handler, "GET", "/api/messages?room=secret-club", nil, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member bob on /api/messages, got %d", w.Code)
	}
	w = doJSONRequest(handler, "GET", "/api/messages/search?room=secret-club&q=hi", nil, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-member bob on /api/messages/search, got %d", w.Code)
	}

	// 3. Alice joins secret-club and posts a message -> non-members must NOT receive unread notification
	aliceWS := connectWS(t, server.URL, "secret-club", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	if err := aliceWS.WriteJSON(Message{Type: "chat", Content: "Top secret note"}); err != nil {
		t.Fatalf("write private msg failed: %v", err)
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second) // echo

	// Verify non-member Charlie (in random) does NOT receive unread/update for private channel
	_ = charlieWS.SetReadDeadline(time.Now().Add(150 * time.Millisecond))
	if _, raw, err := charlieWS.ReadMessage(); err == nil {
		t.Fatalf("non-member charlie must NOT receive unread/update for private channel, got %s", string(raw))
	}

	// 4. Invite validation & permissions
	// Non-creator Bob tries to invite Charlie -> 403
	w = doJSONRequest(handler, "POST", "/api/channels/invite", map[string]string{
		"channelId": "secret-club",
		"username":  "charlie",
	}, bobToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-creator invite, got %d (%s)", w.Code, w.Body.String())
	}

	// Inviting to public channel -> 400
	w = doJSONRequest(handler, "POST", "/api/channels/invite", map[string]string{
		"channelId": "random",
		"username":  "bob",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for inviting to public channel, got %d", w.Code)
	}

	// Inviting non-existent user -> 404
	w = doJSONRequest(handler, "POST", "/api/channels/invite", map[string]string{
		"channelId": "secret-club",
		"username":  "nobody",
	}, aliceToken)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for inviting nonexistent user, got %d", w.Code)
	}

	// 5. Alice invites Bob -> 200 OK + Bob receives channel_update + gains full access
	w = doJSONRequest(handler, "POST", "/api/channels/invite", map[string]string{
		"channelId": "secret-club",
		"username":  "bob",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for creator inviting bob, got %d (%s)", w.Code, w.Body.String())
	}

	bobUpdate := readNextMessage(t, bobWS, 2*time.Second)
	if bobUpdate.Type != "channel_update" {
		t.Fatalf("bob expected channel_update after invite, got %+v", bobUpdate)
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second) // alice channel_update

	if !hasChannel(bobToken, "secret-club") {
		t.Fatalf("bob should now see secret-club in GET /api/channels")
	}

	w = doJSONRequest(handler, "GET", "/api/messages?room=secret-club", nil, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("invited bob expected 200 on /api/messages, got %d", w.Code)
	}

	bobPrivateWS := connectWS(t, server.URL, "secret-club", bobToken)
	defer bobPrivateWS.Close()
	_ = readNextMessage(t, bobPrivateWS, 2*time.Second) // join
	_ = readNextMessage(t, bobPrivateWS, 2*time.Second) // users

	// Charlie is still NOT invited -> still 403
	w = doJSONRequest(handler, "GET", "/api/messages?room=secret-club", nil, charlieToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("uninvited charlie should still get 403, got %d", w.Code)
	}
}

func TestUserProfileAndStatus(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler
	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")

	bobWS := connectWS(t, server.URL, "random", bobToken)
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second) // join
	_ = readNextMessage(t, bobWS, 2*time.Second) // users

	// 1. Validation failures
	w := doJSONRequest(handler, "PUT", "/api/profile", map[string]string{
		"status": "invisible",
	}, aliceToken)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid status, got %d", w.Code)
	}

	for _, badURL := range []string{"https://evil.com/x.png", "/api/uploads/../etc/passwd", "javascript:alert(1)"} {
		w = doJSONRequest(handler, "PUT", "/api/profile", map[string]string{
			"avatarUrl": badURL,
		}, aliceToken)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid avatarUrl %q, got %d", badURL, w.Code)
		}
	}

	// 2. Valid profile update -> 200 + profile_update broadcast
	w = doJSONRequest(handler, "PUT", "/api/profile", map[string]string{
		"avatarUrl": "/api/uploads/alice-avatar.png",
		"status":    "dnd",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid profile update, got %d (%s)", w.Code, w.Body.String())
	}

	profUpdate := readNextMessage(t, bobWS, 2*time.Second)
	if profUpdate.Type != "profile_update" || profUpdate.Sender != "alice" {
		t.Fatalf("bob expected profile_update from alice, got %+v", profUpdate)
	}

	// 3. Check /api/auth/me reflects updated avatarUrl and status
	w = doJSONRequest(handler, "GET", "/api/auth/me", nil, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/auth/me, got %d", w.Code)
	}
	var meRes struct {
		User UserProfile `json:"user"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &meRes)
	if meRes.User.AvatarURL != "/api/uploads/alice-avatar.png" || meRes.User.Status != "dnd" {
		t.Fatalf("unexpected /api/auth/me profile: %+v", meRes.User)
	}

	// 4. Check /api/profiles map
	w = doJSONRequest(handler, "GET", "/api/profiles", nil, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/profiles, got %d", w.Code)
	}
	var profilesRes struct {
		Profiles map[string]UserProfile `json:"profiles"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &profilesRes)
	if profilesRes.Profiles["alice"].AvatarURL != "/api/uploads/alice-avatar.png" || profilesRes.Profiles["alice"].Status != "dnd" {
		t.Fatalf("unexpected alice entry in /api/profiles: %+v", profilesRes.Profiles["alice"])
	}
	if profilesRes.Profiles["bob"].Status != "online" {
		t.Fatalf("expected default online status for bob, got %+v", profilesRes.Profiles["bob"])
	}

	// 5. Check /api/friends includes avatarUrl and status
	_ = store.SendFriendRequest("alice", "bob")
	_ = store.AcceptFriendRequest("bob", "alice")
	w = doJSONRequest(handler, "GET", "/api/friends", nil, bobToken)
	var fData FriendsData
	_ = json.Unmarshal(w.Body.Bytes(), &fData)
	if len(fData.Friends) != 1 || fData.Friends[0].AvatarURL != "/api/uploads/alice-avatar.png" || fData.Friends[0].Status != "dnd" {
		t.Fatalf("expected alice avatar & status in /api/friends, got %+v", fData.Friends)
	}

	// 6. Clearing avatarUrl and switching status to "away"
	w = doJSONRequest(handler, "PUT", "/api/profile", map[string]string{
		"avatarUrl": "",
		"status":    "away",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 clearing avatar and setting away, got %d", w.Code)
	}
	_ = readNextMessage(t, bobWS, 2*time.Second) // profile_update

	w = doJSONRequest(handler, "GET", "/api/auth/me", nil, aliceToken)
	_ = json.Unmarshal(w.Body.Bytes(), &meRes)
	if meRes.User.AvatarURL != "" || meRes.User.Status != "away" {
		t.Fatalf("expected cleared avatar and away status, got %+v", meRes.User)
	}
}

func TestPinnedMessages(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler
	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")
	_, charlieToken, _ := store.Register("charlie", "password123")

	aliceWS := connectWS(t, server.URL, "random", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	if err := aliceWS.WriteJSON(Message{Type: "chat", Content: "Important release notes"}); err != nil {
		t.Fatalf("write chat failed: %v", err)
	}
	echo := readNextMessage(t, aliceWS, 2*time.Second)
	msgID := echo.ID

	// 1. Pin message -> 200 + message_update broadcast
	w := doJSONRequest(handler, "POST", "/api/messages/pin", map[string]string{
		"id":   msgID,
		"room": "random",
	}, bobToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 pinning message, got %d (%s)", w.Code, w.Body.String())
	}

	pinBroadcast := readNextMessage(t, aliceWS, 2*time.Second)
	if pinBroadcast.Type != "message_update" || pinBroadcast.ID != msgID {
		t.Fatalf("expected message_update broadcast on pin, got %+v", pinBroadcast)
	}
	pinData, _ := pinBroadcast.Data.(map[string]any)
	if pinData["pinned"] != true || pinData["pinnedBy"] != "bob" {
		t.Fatalf("expected pinned=true pinnedBy=bob, got %+v", pinBroadcast.Data)
	}

	// 2. GET /api/messages/pinned returns the pinned message
	w = doJSONRequest(handler, "GET", "/api/messages/pinned?room=random", nil, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for /api/messages/pinned, got %d", w.Code)
	}
	var pinnedRes struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &pinnedRes)
	if len(pinnedRes.Messages) != 1 || pinnedRes.Messages[0].ID != msgID {
		t.Fatalf("expected 1 pinned message, got %+v", pinnedRes.Messages)
	}

	// 3. Unpin message -> GET /api/messages/pinned returns empty slice
	w = doJSONRequest(handler, "POST", "/api/messages/pin", map[string]string{
		"id":   msgID,
		"room": "random",
	}, aliceToken)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 unpinning message, got %d", w.Code)
	}
	_ = readNextMessage(t, aliceWS, 2*time.Second) // message_update

	w = doJSONRequest(handler, "GET", "/api/messages/pinned?room=random", nil, aliceToken)
	_ = json.Unmarshal(w.Body.Bytes(), &pinnedRes)
	if len(pinnedRes.Messages) != 0 {
		t.Fatalf("expected 0 pinned messages after unpin, got %d", len(pinnedRes.Messages))
	}

	// 4. Unauthorized DM pin access -> 403
	w = doJSONRequest(handler, "GET", "/api/messages/pinned?room=dm:alice:bob", nil, charlieToken)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for charlie on dm pinned messages, got %d", w.Code)
	}
}

func TestDMReadReceipts(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	hub.SetStore(store)
	server := httptest.NewServer(setupRoutes(hub, store, ""))
	defer server.Close()

	handler := server.Config.Handler
	_, aliceToken, _ := store.Register("alice", "password123")
	_, bobToken, _ := store.Register("bob", "password123")

	aliceWS := connectWS(t, server.URL, "dm:alice:bob", aliceToken)
	defer aliceWS.Close()
	_ = readNextMessage(t, aliceWS, 2*time.Second) // join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	bobWS := connectWS(t, server.URL, "dm:alice:bob", bobToken)
	defer bobWS.Close()
	_ = readNextMessage(t, bobWS, 2*time.Second)   // join
	_ = readNextMessage(t, bobWS, 2*time.Second)   // users
	_ = readNextMessage(t, aliceWS, 2*time.Second) // bob join
	_ = readNextMessage(t, aliceWS, 2*time.Second) // users

	// Bob sends read_receipt in DM -> Alice receives it
	if err := bobWS.WriteJSON(Message{
		Type: "read_receipt",
		Data: map[string]any{"lastReadId": "msg-42"},
	}); err != nil {
		t.Fatalf("write read_receipt failed: %v", err)
	}
	_ = readNextMessage(t, bobWS, 2*time.Second) // echo
	aliceReceipt := readNextMessage(t, aliceWS, 2*time.Second)
	if aliceReceipt.Type != "read_receipt" || aliceReceipt.Sender != "bob" || aliceReceipt.Room != "dm:alice:bob" {
		t.Fatalf("alice expected read_receipt from bob, got %+v", aliceReceipt)
	}

	// Verify read_receipt was NOT persisted to message history
	w := doJSONRequest(handler, "GET", "/api/messages?room=dm:alice:bob", nil, aliceToken)
	var hist struct {
		Messages []Message `json:"messages"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &hist)
	if len(hist.Messages) != 0 {
		t.Fatalf("read_receipt must not be persisted, got %d messages", len(hist.Messages))
	}
}

func TestLinkPreviewSSRFAndMetadata(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store, "")

	_, token, _ := store.Register("alice", "password123")

	// 1. Unauthenticated -> 401
	w := doJSONRequest(handler, "GET", "/api/link-preview?url=https://example.com", nil, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated link-preview, got %d", w.Code)
	}

	// 2. SSRF & invalid scheme blocking -> 400
	blockedURLs := []string{
		"http://127.0.0.1",
		"http://127.0.0.1:8080/health",
		"http://169.254.169.254/latest/meta-data/",
		"http://10.0.0.1/admin",
		"http://192.168.1.1/",
		"http://[::1]/",
		"http://localhost:8080/",
		"http://user:pass@example.com/",
		"file:///etc/passwd",
		"javascript:alert(1)",
	}
	for _, u := range blockedURLs {
		req := httptest.NewRequest("GET", "/api/link-preview?url="+url.QueryEscape(u), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rw := httptest.NewRecorder()
		handler.ServeHTTP(rw, req)
		if rw.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 SSRF block for %q, got %d (%s)", u, rw.Code, rw.Body.String())
		}
	}

	// 3. HTML Metadata extraction unit verification (relative og:image, entities, fallback)
	pageURL, _ := url.Parse("https://example.com/posts/hello")
	sampleHTML := `<!doctype html>
<html>
<head>
  <title>Fallback Title</title>
  <meta property="og:title" content="WeConnect &amp; Go &quot;Fast&quot;">
  <meta content="Real-time   chat &amp; video." property="og:description">
  <meta property="og:image" content="/assets/preview.png">
  <meta property="og:site_name" content="WeConnect">
</head>
<body>hello</body>
</html>`
	meta := extractHTMLMetadata(pageURL, sampleHTML)
	if meta.Title != `WeConnect & Go "Fast"` {
		t.Fatalf("unexpected extracted title: %q", meta.Title)
	}
	if meta.Description != "Real-time chat & video." {
		t.Fatalf("unexpected extracted description: %q", meta.Description)
	}
	if meta.Image != "https://example.com/assets/preview.png" {
		t.Fatalf("unexpected resolved og:image: %q", meta.Image)
	}
	if meta.SiteName != "WeConnect" {
		t.Fatalf("unexpected siteName: %q", meta.SiteName)
	}

	// Fallback to <title> and reject unsafe javascript: image
	fallbackHTML := `<html><head><title>  Simple   Page </title><meta property="og:image" content="javascript:alert(1)"></head></html>`
	fallbackMeta := extractHTMLMetadata(pageURL, fallbackHTML)
	if fallbackMeta.Title != "Simple Page" || fallbackMeta.Image != "" || fallbackMeta.SiteName != "example.com" {
		t.Fatalf("unexpected fallback metadata: %+v", fallbackMeta)
	}
}

func TestChangePassword(t *testing.T) {
	hub := NewHub()
	store, _ := NewStore("")
	handler := setupRoutes(hub, store, "")

	_, token, err := store.Register("alice", "oldpassword")
	if err != nil {
		t.Fatalf("register failed: %v", err)
	}

	// 1. Wrong current password -> 401
	w := doJSONRequest(handler, "PUT", "/api/auth/password", map[string]string{
		"currentPassword": "wrongpassword",
		"newPassword":     "newpassword123",
	}, token)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong current password, got %d (%s)", w.Code, w.Body.String())
	}

	// 2. Too short new password -> 400
	w = doJSONRequest(handler, "PUT", "/api/auth/password", map[string]string{
		"currentPassword": "oldpassword",
		"newPassword":     "123",
	}, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short new password, got %d", w.Code)
	}

	// 3. Valid change -> 200
	w = doJSONRequest(handler, "PUT", "/api/auth/password", map[string]string{
		"currentPassword": "oldpassword",
		"newPassword":     "newpassword123",
	}, token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid password change, got %d (%s)", w.Code, w.Body.String())
	}

	// 4. Old password login fails (401), new password login succeeds (200)
	w = doJSONRequest(handler, "POST", "/api/auth/login", map[string]string{
		"username": "alice",
		"password": "oldpassword",
	}, "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 logging in with old password, got %d", w.Code)
	}

	w = doJSONRequest(handler, "POST", "/api/auth/login", map[string]string{
		"username": "alice",
		"password": "newpassword123",
	}, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 logging in with new password, got %d", w.Code)
	}
}

func TestRateLimiterMiddleware(t *testing.T) {
	limiter := NewRateLimiter(3, time.Minute)
	wrapped := limiter.Middleware(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// First 3 requests from IP A succeed
	for i := 1; i <= 3; i++ {
		req := httptest.NewRequest("POST", "/api/auth/login", nil)
		req.RemoteAddr = "198.51.100.10:12345"
		w := httptest.NewRecorder()
		wrapped(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d expected 200, got %d", i, w.Code)
		}
	}

	// 4th request from IP A returns 429 + Retry-After header
	req4 := httptest.NewRequest("POST", "/api/auth/login", nil)
	req4.RemoteAddr = "198.51.100.10:12345"
	w4 := httptest.NewRecorder()
	wrapped(w4, req4)
	if w4.Code != http.StatusTooManyRequests {
		t.Fatalf("request 4 expected 429, got %d", w4.Code)
	}
	if w4.Header().Get("Retry-After") == "" {
		t.Fatalf("expected Retry-After header on 429 response")
	}

	// Request from different IP B still succeeds (200)
	reqOther := httptest.NewRequest("POST", "/api/auth/login", nil)
	reqOther.RemoteAddr = "198.51.100.11:54321"
	wOther := httptest.NewRecorder()
	wrapped(wOther, reqOther)
	if wOther.Code != http.StatusOK {
		t.Fatalf("different IP expected 200, got %d", wOther.Code)
	}
}
