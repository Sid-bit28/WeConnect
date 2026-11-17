package main

import (
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
	handler := setupRoutes(hub)

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
	handler := setupRoutes(hub)

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
	server := httptest.NewServer(setupRoutes(hub))
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
