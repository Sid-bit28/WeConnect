# WeConnect — Technical Project Context & Architecture Reference

> **Document Version:** 1.0.0  
> **Last Updated:** November 2026  
> **Repository:** `https://github.com/Sid-bit28/WeConnect`  
> **Live Production URL:** `https://weconnect-dgw2.onrender.com`  
> **Mobile Artifact:** `WeConnect.apk` (4.1 MB, Android 8.0+)  
> **Database:** Neon Serverless PostgreSQL (`pgxpool` with automated schema migrations)

---

## 1. Executive Summary & Design Vision

**WeConnect** is a modern, high-concurrency real-time collaboration ecosystem inspired by the speed and minimalism of **Linear** combined with the voice, video, and community structure of **Discord**.

### Key Architectural Pillars
1. **Zero External Bloat**:
   * Backend is written in idiomatic **Go 1.23** using native `net/http`, `gorilla/websocket` with non-blocking ring buffers, and `jackc/pgx/v5` with connection pooling.
   * Single-binary container packaging compiles to an ultra-lean **~28 MB Alpine Docker image** consuming **< 20 MB RAM** at idle.
2. **True Low-Latency Mesh Calling**:
   * Direct peer-to-peer WebRTC mesh routing for sub-millisecond audio/video latency without expensive SFU/MCU server middleboxes.
   * Simultaneous dual-stream engine: independent peer connections for webcam and screen share to avoid browser renegotiation bottlenecks.
   * Synchronized tab & system audio streaming over WebRTC with automatic hardware track re-acquisition.
3. **Bespoke Obsidian Aesthetic**:
   * Deep obsidian surfaces (`#090B10`, `#0F131C`, `#161B26`), electric indigo accents (`#6366F1`), cyber cyan highlights (`#06B6D4`), and emerald live indicators (`#10B981`).
   * Zero generic AI templates, micro-interactions, responsive `100dvh` slide-over drawers for mobile, and in-app floating Picture-in-Picture mini-player.
4. **Dual Storage Flexibility**:
   * Automatic runtime selection between **Neon Serverless PostgreSQL** (production) and a thread-safe, atomic **FileStore** (`data/store.json`), allowing offline local testing with zero database dependencies.

---

## 2. Repository Directory Structure

```
WeConnect/
├── .github/
│   └── workflows/
│       └── build-apk.yml          # GitHub Actions CI/CD to build & release Android APK
├── client/                        # React 19 + TypeScript + Vite Frontend
│   ├── android/                   # Capacitor 8 Native Android Project
│   │   ├── app/
│   │   │   ├── src/main/AndroidManifest.xml  # WebRTC permissions (Camera, Mic, Network)
│   │   │   └── src/main/java/com/weconnect/app/MainActivity.java # WebChromeClient WebRTC grant
│   │   └── build.gradle           # Android Gradle configuration
│   ├── public/
│   │   ├── favicon.svg            # Scalable SVG brand mark
│   │   ├── logo.svg               # High-DPI geometric W-Mesh brand logo
│   │   └── tour.html              # Self-playing interactive 5-stage product walkthrough
│   ├── scripts/
│   │   └── generate-icons.js      # Multi-density Android mipmap launcher icon generator
│   ├── src/
│   │   ├── components/            # Modular UI components
│   │   │   ├── AuthScreen.tsx     # Sign-in & Registration card with logo hero
│   │   │   ├── CallControls.tsx   # Mic, Camera, Screen share, Device switcher, End call
│   │   │   ├── ChannelSidebar.tsx # Text/Voice channels, DM list, Presence, User profile popover
│   │   │   ├── ChatArea.tsx       # Message list, Markdown, Reactions, File uploads, Giphy, Pinned
│   │   │   ├── CreateChannelModal.tsx # Public & Private invite-only room creator
│   │   │   ├── FloatingCallPiP.tsx    # Draggable floating mini-player with background audio sinks
│   │   │   ├── FriendsView.tsx    # Online, All, Pending friend requests, Add friend
│   │   │   ├── ImageLightbox.tsx  # Fullscreen zoom viewer for image attachments
│   │   │   ├── IncomingCallBanner.tsx # Ringing modal with accept/decline for incoming DM calls
│   │   │   ├── LinkPreviewCard.tsx    # OpenGraph preview card with SSRF-safe crawling
│   │   │   ├── NotificationToast.tsx  # Floating toast manager for call/chat alerts
│   │   │   ├── ProfilePopover.tsx     # Custom avatar upload, password change, status switcher
│   │   │   ├── UserAvatar.tsx     # Dynamic tone color fallbacks & presence badges
│   │   │   ├── UserList.tsx       # Right sidebar showing active room participants
│   │   │   ├── VideoGrid.tsx      # Discord stage layout, screen share stage, active speaker rings
│   │   │   └── WeConnectLogo.tsx  # Bespoke geometric W-Mesh SVG component
│   │   ├── hooks/
│   │   │   ├── useActiveSpeaker.ts# Web Audio API volume analysis & speaking detection
│   │   │   ├── useAuth.ts         # JWT storage, auto-login, logout, token refresh
│   │   │   ├── useSocket.ts       # Full-duplex WebSocket client with heartbeat & reconnect
│   │   │   └── useWebRTC.ts       # WebRTC Mesh manager, dual PC handling, track recovery
│   │   ├── types/
│   │   │   └── index.ts           # Shared TypeScript interfaces (Message, Signal, Channel, User)
│   │   ├── utils/
│   │   │   ├── api.ts             # API base URL resolver (dynamic host detection)
│   │   │   └── dm.ts              # DM room ID canonicalization (`dm:user1:user2`)
│   │   ├── App.tsx                # Master state container, layout orchestrator, drawer controller
│   │   ├── index.css              # Tailwind base imports & custom scrollbar utilities
│   │   └── main.tsx               # React 19 entry point
│   ├── capacitor.config.json      # Capacitor app configuration (appId: com.weconnect.app)
│   ├── tailwind.config.js         # Linear Obsidian theme tokens
│   └── vite.config.ts             # Vite bundler configuration
├── server/                        # Go 1.23 High-Performance Server
│   ├── client.go                  # WebSocket connection pump (read/write loops, 256-frame buffer)
│   ├── hub.go                     # Thread-safe room manager, targeted signal router, room GC
│   ├── main.go                    # HTTP mux, REST handlers, rate limiting, SPA static serving
│   ├── postgres_store.go          # Neon pgxpool storage engine with JSONB casting & auto-migrations
│   ├── store.go                   # Common Store interface & atomic FileStore fallback
│   ├── server_test.go             # 23 comprehensive integration test suites with race detector
│   └── go.mod / go.sum            # Go dependencies (pinned to Go 1.23.0)
├── Dockerfile                     # Multi-stage production container (Node 20 -> Go 1.23 -> Alpine)
├── docker-compose.yml             # Local Docker Compose with PostgreSQL 16 container
├── render.yaml                    # Infrastructure-as-Code Blueprint for Render deployment
├── start.sh                       # Local hot-reloading development runner
├── WeConnect.apk                  # Compiled Android APK (4.1 MB)
├── README.md                      # Portfolio-grade repository documentation
└── PROJECT_CONTEXT.md             # This document
```

---

## 3. Technology Stack & Dependencies

### Backend (`server/`)
* **Language**: Go `1.23.0`
* **WebSocket**: `github.com/gorilla/websocket v1.5.3` (ping/pong heartbeats, 256-frame buffered channels)
* **PostgreSQL Driver**: `github.com/jackc/pgx/v5 v5.7.1` (connection pooling with `pgxpool`, simple protocol support for PgBouncer)
* **Password Hashing**: `golang.org/x/crypto/argon2`
* **Concurrency**: `sync.RWMutex` protecting in-memory rooms, atomic operations, panic-safe goroutines.

### Frontend (`client/`)
* **Core Framework**: React `19.0.0`
* **Language**: TypeScript `5.7.2`
* **Build Tool**: Vite `6.0.1` (HMR, tree-shaking, production bundle `~390 KB` raw / `~110 KB` gzip)
* **Styling**: Tailwind CSS `v3.4.16` + `clsx`
* **Icons**: `lucide-react`
* **Mobile Runtime**: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` `v8.0.0`

### Cloud Infrastructure
* **Hosting**: Render (Web Service Docker Blueprint, auto-scaling, HTTPS/WSS terminate)
* **Database**: Neon Serverless PostgreSQL (`pgxpool`, `MinConns = 0` for serverless sleep cycles)
* **WebRTC STUN**: `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302` (plus optional TURN credentials via `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`).

---

## 4. Database Schema & Storage Engines

WeConnect features a **Dual Storage Engine** governed by the `Store` interface (`server/store.go`):

```go
type Store interface {
    Register(username, password string) (*User, string, error)
    Login(username, password string) (*User, string, error)
    ChangePassword(username, currentPassword, newPassword string) error
    AuthenticateToken(token string) (*User, error)
    UserExists(username string) bool
    GetUserProfile(username string) (*UserProfile, error)
    UpdateUserProfile(username, avatarUrl, status string) error
    GetAllUserProfiles() (map[string]UserProfile, error)
    SendFriendRequest(requester, receiver string) error
    AcceptFriendRequest(receiver, requester string) error
    RejectFriendRequest(currentUser, otherUser string) error
    RemoveFriend(currentUser, friendUser string) error
    GetFriends(username string, isOnline func(string) bool) FriendsData
    SaveMessage(msg Message) error
    GetMessages(room string, limit int) ([]Message, error)
    EditMessage(msgID, room, requestingUser, newContent string) (*Message, error)
    DeleteMessage(msgID, room, requestingUser string) error
    ToggleReaction(msgID, room, username, emoji string) (*Message, error)
    TogglePinMessage(msgID, room, requestingUser string) (*Message, error)
    GetPinnedMessages(room string) ([]Message, error)
    SearchMessages(room, query string, limit int) ([]Message, error)
    GetChannels() ([]Channel, error)
    GetChannel(id string) (*Channel, error)
    GetChannelsForUser(username string) ([]Channel, error)
    CreateChannel(ch Channel) error
    DeleteChannel(id, requestingUser string) error
    InviteToChannel(channelID, requestingUser, targetUser string) (*Channel, error)
    Close() error
}
```

### PostgreSQL Schema (`server/postgres_store.go`)

```sql
-- 1. Users
CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'online',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 2. Sessions
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- 3. Friendships
CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    requester TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    receiver TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    status TEXT NOT NULL, -- 'pending' | 'accepted'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester);
CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships(receiver);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

-- 4. Messages (with JSONB rich metadata)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    msg_id TEXT,
    type TEXT NOT NULL,
    room TEXT NOT NULL,
    sender TEXT NOT NULL,
    content TEXT,
    data JSONB,
    timestamp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_room_timestamp ON messages(room, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id);

-- 5. Channels
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'text' | 'voice'
    topic TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT 'system',
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    members JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_channels_created_at ON channels(created_at ASC);
```

> [!IMPORTANT]
> **PostgreSQL `JSONB` Rule:**  
> When writing JSON into `data JSONB` or `members JSONB`, always pass JSON as a Go `string` with explicit SQL cast: `data = $1::jsonb`. Passing raw Go `[]byte` causes PostgreSQL to treat it as `bytea`, triggering SQLSTATE 42804 type errors.

---

## 5. WebSocket & Real-Time Protocol

### Connection Handshake
Clients connect to:  
`wss://<domain>/ws?room=<room_id>&token=<bearer_token>`

* **Authentication**: Handshake validates the session token before upgrading the connection to WebSocket.
* **Heartbeats**: Ping/Pong every 54 seconds (`pingPeriod = 54s`, `pongWait = 60s`, `writeWait = 10s`).
* **Send Buffer**: Non-blocking 256-frame buffered channel per client to prevent slow clients from stalling the room hub.

### Message Envelope Specification
```json
{
  "id": "msg-1700000000-abc1234",
  "type": "chat | signal | join | leave | users | typing | read_receipt | unread | message_update | message_delete | channel_update | friend_update | error",
  "room": "random",
  "sender": "siddarth",
  "content": "Meeting in Voice Lounge!",
  "data": { ... },
  "timestamp": 1700000000000
}
```

### Signal Types (1-to-1 WebRTC Signaling)
Sent within `type: "signal"`:
```json
{
  "type": "signal",
  "data": {
    "target": "alice",
    "signalType": "offer | answer | candidate | screen-offer | screen-answer | screen-candidate | screen-leave | media-state | join-call | leave-call",
    "payload": { ... }
  }
}
```

| Signal Type | Direction | Payload | Description |
| :--- | :--- | :--- | :--- |
| `join-call` | Client → Room Peers | `null` | Broadcasts intent to enter call, triggering callers to send offers. |
| `offer` / `answer` | Caller ↔ Callee | `RTCSessionDescriptionInit` | WebRTC negotiation for 1080p camera & microphone. |
| `candidate` | Caller ↔ Callee | `RTCIceCandidateInit` | Trickle ICE candidates for webcam peer connection. |
| `screen-offer` / `screen-answer` | Presenter ↔ Viewer | `RTCSessionDescriptionInit` | Independent peer connection for 1080p screen + tab audio. |
| `screen-candidate` | Presenter ↔ Viewer | `RTCIceCandidateInit` | Trickle ICE candidates for screen peer connection. |
| `screen-leave` | Presenter → Viewers | `null` | Tears down screen stream and resets stage view to camera grid. |
| `media-state` | Client → Peers | `{ isAudioMuted, isVideoOff }` | Real-time broadcast of mic mute / camera toggles. |
| `leave-call` | Client → Peers | `null` | Tears down all peer connections for this participant. |

---

## 6. WebRTC Mesh Calling Engine

### Dual PeerConnection Architecture
To prevent browser renegotiation bugs where sharing a screen replaces or breaks the webcam feed, WeConnect maintains **two distinct `RTCPeerConnection` instances per remote peer**:
1. `peerConnections.current.get(peerId)`: Transmits/receives local webcam and microphone audio.
2. `screenPeerConnections.current.get(peerId)`: Transmits/receives 1080p 60fps screen video and synchronized tab/system audio.

### Video Rendering & Callback Ref Pattern
* **Problem**: In React, toggling `isVideoOff` previously caused `<video>` to unmount. On re-enabling, React mounted a new `<video>` DOM node, but `useEffect` with `[stream]` didn't re-run because the `MediaStream` object reference hadn't changed, leaving `srcObject = null` (black screen).
* **Solution**:
  1. `<video>` elements remain permanently mounted in the DOM and toggle visibility via CSS (`hidden`).
  2. Attachment uses a **callback ref** (`bindVideoRef`):
     ```tsx
     const bindVideoRef = useCallback((node: HTMLVideoElement | null) => {
       videoRef.current = node;
       if (node) {
         node.muted = shouldMuteVideo;
         if (stream && node.srcObject !== stream) node.srcObject = stream;
         if (hasVideoTrack) node.play().catch(() => {});
       }
     }, [stream, shouldMuteVideo, hasVideoTrack]);
     ```
  3. Ended tracks (`track.readyState === 'ended'`) are automatically re-acquired via `getUserMedia` and swapped onto active senders via `sender.replaceTrack(freshTrack)`.

### Screen Audio Constraints & OS Behaviors
* **Browser Tab ("Brave Tab" / "Chrome Tab")**: Full stereo audio capture is supported on Linux, Windows, macOS when `"Share with tab audio"` is checked.
* **Single Window**: Chromium permanently disables audio on Linux/macOS (*"To share audio, share a tab instead"*) due to OS sandbox limitations.
* **Entire Screen**: Supports system audio on Linux when PipeWire desktop portal is active (`brave://flags/#enable-webrtc-pipewire-capturer`).
* **Dolby EAC3 / DTS**: Web browsers cannot decode proprietary Dolby Digital (`E-AC-3`) or DTS audio in local MKV files due to patent licensing. Videos played in tabs must use AAC or Opus audio (convertible in seconds via `ffmpeg -i input.mkv -c:v copy -c:a aac output.mp4`).

---

## 7. REST API Endpoints

All protected endpoints require header: `Authorization: Bearer <token>`.

### Authentication & Profiles
* `POST /api/auth/register`: `{ username, password }` → `201 Created` with `{ token, user }`
* `POST /api/auth/login`: `{ username, password }` → `200 OK` with `{ token, user }`
* `GET /api/auth/me`: Validates session → returns `{ user }`
* `POST /api/auth/change-password`: `{ currentPassword, newPassword }` → `200 OK`
* `GET /api/users/profiles`: Returns map of all user avatars and custom status indicators
* `POST /api/users/profile`: `{ avatarUrl, status }` → updates user profile

### Messaging & Reactions
* `GET /api/messages?room=<name>&limit=50`: Retrieves chronological chat history
* `POST /api/messages/upload`: Multipart upload for images/files up to 2GB → returns `{ attachment: { id, name, size, url, mimeType } }`
* `POST /api/messages/edit`: `{ id, room, content }` → edits message (author-only)
* `POST /api/messages/delete`: `{ id, room }` → deletes message (author-only)
* `POST /api/messages/react`: `{ id, room, emoji }` → toggles reaction count
* `POST /api/messages/pin`: `{ id, room }` → pins or unpins message in room
* `GET /api/messages/pinned?room=<name>`: Retrieves all pinned messages in room
* `GET /api/messages/search?room=<name>&q=<term>`: Full-text message search
* `GET /api/link-preview?url=<target>`: SSRF-safe OpenGraph scraper (rejects RFC1918 private IPs)
* `GET /api/gifs/search?q=<term>`: Giphy API integration for GIF picker

### Channels & Friends
* `GET /api/channels`: Returns all public channels and private channels the user belongs to
* `POST /api/channels`: `{ name, type, topic, isPrivate, members }` → creates channel
* `DELETE /api/channels/<id>`: Creator-only channel deletion
* `POST /api/channels/invite`: `{ channelId, targetUser }` → adds member to private room
* `GET /api/friends`: Returns accepted friends, incoming requests, and outgoing requests
* `POST /api/friends/request`: `{ targetUsername }` → sends friend request
* `POST /api/friends/accept`: `{ fromUsername }` → accepts friend request
* `POST /api/friends/reject`: `{ fromUsername }` → declines/cancels request
* `POST /api/friends/remove`: `{ friendUsername }` → unfriends user

---

## 8. Android APK Packaging (Capacitor)

### Mobile Architecture
* **Package Identifier**: `com.weconnect.app`
* **Configuration**: `client/capacitor.config.json` pointing to `https://weconnect-dgw2.onrender.com`
* **WebRTC Permission Bridge**:
  In `client/android/app/src/main/java/com/weconnect/app/MainActivity.java`:
  ```java
  bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
      @Override
      public void onPermissionRequest(final PermissionRequest request) {
          runOnUiThread(() -> {
              request.grant(request.getResources());
          });
      }
  });
  ```
* **Compiled APK**: Staged at `/media/D/projects/WeConnect/WeConnect.apk` (4.1 MB).
* **CI/CD Pipeline**: `.github/workflows/build-apk.yml` runs on push/tag to compile debug and release APKs via Gradle on Ubuntu runners.

---

## 9. Historical Bugs & Engineering Fixes

| Bug / Problem | Root Cause | Implemented Resolution | Commit |
| :--- | :--- | :--- | :--- |
| **Go 1.25 Module Failure** | Go toolchain pinned to 1.25 on a machine with Go 1.23. | Pinned `server/go.mod` to `go 1.23.0` and `Dockerfile` to `golang:1.23-alpine`. | `04485e1` |
| **Screen Share Replacing Webcam** | Single `replaceTrack` swapped the camera video track. | Split into dual peer connections (`screenPeerConnections`) with Discord Stage UI. | `5438b89` |
| **Random Guest Usernames** | App auto-generated `UserXXXX` without authentication. | Removed guest flow, introduced strict `AuthScreen` gating with JWT storage. | `4ed854d` |
| **Screen Video Toggle Freeze** | React unmounted `<video>`; remount didn't re-run `useEffect([stream])`. | Used callback ref `bindVideoRef` and kept `<video>` mounted with CSS `hidden`. | `6d9382f` |
| **Ended Hardware Camera Track** | Laptop lid close or camera idle transitioned track to `'ended'`. | Added track inspection and auto-reacquisition via `getUserMedia` + `replaceTrack`. | `6d9382f` |
| **PostgreSQL 500 on Emoji Reactions** | `pgx/v5` sent Go `[]byte` to `data JSONB` column without cast (SQLSTATE 42804). | Updated queries to pass string JSON with explicit `$1::jsonb` casting. | `3494f57` |
| **Grouped Message Timestamp Wrap** | Fixed `w-8` container forced `"12:09 AM"` to wrap onto 2 lines; `pl-[44px]` was misaligned. | Unified flex container `space-x-3 px-2` with `formatCompactTime` (`12:09`). | `3494f57` |

---

## 10. Development & Testing Commands

### Local Backend Development
```bash
cd server
export PATH=/usr/local/go/bin:$PATH

# Run full integration test suite with Go race detection
go test -count=1 -v -race ./...

# Build server binary
go build -buildvcs=false -o server .

# Run locally with FileStore (no DB setup required)
./server
```

### Local Frontend Development
```bash
cd client
npm install
npm run dev      # Vite HMR at http://localhost:5173
npm run build    # TypeScript + Vite production build
```

### Automated Start Script
```bash
./start.sh       # Launches Go backend (8080) and Vite frontend (5173) with graceful teardown
```

### All-in-One Docker Compose
```bash
docker compose up --build
```

---

## 11. Environment Variables Reference

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `8080` | Port for HTTP, WebSocket, and static SPA serving. |
| `DATABASE_URL` | `""` | PostgreSQL connection string. If omitted, server falls back to `FileStore`. |
| `STATIC_DIR` | `"../client/dist"` | Path to compiled React production assets. |
| `DATA_DIR` | `"data"` | Path for `store.json` and uploaded files in FileStore mode. |
| `RATE_LIMIT_PER_SEC` | `100.0` | Token bucket refill rate per IP. |
| `RATE_LIMIT_BURST` | `200` | Token bucket maximum burst capacity. |
| `TURN_URL` | `""` | Optional TURN relay server URL for strict symmetric NATs. |
| `TURN_USERNAME` | `""` | TURN authentication username. |
| `TURN_CREDENTIAL` | `""` | TURN authentication credential/password. |

---

## 12. Future Feature Roadmap

1. **Interactive In-App Games**:
   * Wordle, Mini India Map Puzzle, Canvas multiplayer trivia directly embedded into channel tabs.
2. **Push Notifications**:
   * WebPush and Firebase Cloud Messaging (FCM) integration for Android background call alerts.
3. **SFU Scaling for Large Calls**:
   * For rooms exceeding 6 simultaneous video callers, transition from full mesh to a selective forwarding unit (e.g., LiveKit or Ion-SFU).
4. **End-to-End Encryption (E2EE)**:
   * WebRTC `Insertable Streams` for zero-knowledge end-to-end encrypted voice and video channels.
