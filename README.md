# WeConnect

A minimal, high-performance Discord-style real-time collaboration application featuring text channels, live presence indicators, and WebRTC mesh audio/video calling with screen sharing.

---

## Architecture Overview

```
WeConnect/
├── server/               # Go WebSocket, WebRTC Signaling & REST Server
│   ├── main.go          # HTTP server, /health, /ws, /api routes, SPA static serving
│   ├── hub.go           # Thread-safe Room management (sync.RWMutex), WebRTC signaling routing
│   ├── client.go        # WebSocket connection wrapper with heartbeats & panic safety
│   ├── store.go         # Common Store interface & atomic FileStore implementation
│   ├── postgres_store.go# PostgreSQL store with pgxpool & automated schema migrations
│   └── server_test.go   # Integration test suite with race detector coverage
├── client/               # React 19 + TypeScript + Vite + Tailwind CSS Frontend
│   └── src/
│       ├── types/       # Shared message protocol definitions
│       ├── hooks/       # useSocket (WebSocket manager), useWebRTC (Mesh call manager), useAuth
│       └── components/  # Discord UI: ChannelSidebar, ChatArea, UserList, VideoGrid, CallControls, FriendsView, AuthModal
├── Dockerfile            # Multi-stage production build (Node -> Go -> Alpine)
├── docker-compose.yml    # All-in-One containerized deployment with PostgreSQL
├── start.sh              # Local development runner with health checks and graceful teardown
└── README.md
```

### Backend (`server/`)
- **Technology**: Go (`go1.23+`), `github.com/gorilla/websocket`, `github.com/jackc/pgx/v5`.
- **Dual Storage Engine (Dynamic Selection)**:
  - **PostgreSQL**: Enabled when `DATABASE_URL` is set. Uses `pgxpool` with automatic schema migrations (`users`, `sessions`, `friendships`, `messages`).
  - **FileStore**: Enabled when `DATABASE_URL` is empty. Thread-safe atomic JSON file storage (`data/store.json`) or in-memory, requiring zero external database setup for local testing.
- **Signaling Hub**:
  - Broadcasts room chat and user join/leave presence notifications.
  - Targeted 1-to-1 WebRTC signaling router (`data.target`) for SDP Offers, Answers, and ICE Candidates.
  - Automatically garbage-collects empty rooms.
- **Single-Port Production Serving**:
  - Serves static assets from `STATIC_DIR` (`client/dist`).
  - Client-side routing fallback to `index.html` for single-port deployments.
- **Resilience**:
  - Buffered client send queues (256 frames) with non-blocking dispatch to prevent backpressure blocking.
  - Gorilla WebSocket ping/pong heartbeats (`pongWait: 60s`, `pingPeriod: 54s`, `writeWait: 10s`).
  - Full panic recovery across read and write pumps.

### Frontend (`client/`)
- **Technology**: React 19, TypeScript, Vite, Tailwind CSS v3, Lucide Icons.
- **Theme**: Discord-style dark aesthetic (`#1e1f22`, `#2b2d31`, `#313338`).
- **Real-Time Features**:
  - Text Channels: `#general`, `#random`, `#dev-chat` with instant switching and message history.
  - Online Presence: Active participant counter and real-time user list with status indicators.
  - Voice Channels: `🔊 Voice Lounge`, `🔊 Gaming` with integrated WebRTC mesh audio/video calling.
  - Mesh WebRTC: Dynamic ICE server configuration from `GET /api/config/ice`, candidate buffering, mic mute toggle, camera toggle, screen sharing toggle via `getDisplayMedia`, and responsive video grid.
  - Friends System: Discord-style sub-tabs (Online, All, Pending, Add Friend) with live status updates.
  - Authentication: User registration, login modal, and persistent sessions.

---

## WebSocket & Signaling Protocol

Messages are exchanged over `ws://localhost:8080/ws?room=<room_name>&user=<username>` in JSON:

```json
{
  "type": "chat | join | leave | users | signal | friend_update | error",
  "room": "general",
  "sender": "alice",
  "content": "Hello everyone!",
  "data": { ... },
  "timestamp": 1700000000000
}
```

### Message Types
| Type | Direction | Description |
|---|---|---|
| `join` | Server → Room | Broadcast when a new participant connects. |
| `leave` | Server → Room | Broadcast when a participant disconnects. |
| `users` | Server → Room | Broadcast containing `data: string[]` of active usernames. |
| `chat` | Client ↔ Room | Broadcast text messages with sender and timestamp. |
| `signal` | Client ↔ Target Client | 1-to-1 WebRTC signaling (`data: { target, signalType, payload }`). |
| `friend_update` | Server → Client | Real-time notification for friend requests, acceptances, and removals. |
| `error` | Server → Client | Unicast error message for invalid formats or unknown targets. |

---

## REST API Endpoints

### Authentication
- `POST /api/auth/register`: `{ username, password }` -> `201 Created` with `{ token, user: { username } }`
- `POST /api/auth/login`: `{ username, password }` -> `200 OK` with `{ token, user: { username } }`
- `GET /api/auth/me`: `Authorization: Bearer <token>` -> `200 OK` with `{ user: { username } }`

### Friends Management
*Requires `Authorization: Bearer <token>`.*
- `GET /api/friends`: Returns `{ friends: [{ username, online }], incoming: [...], outgoing: [...] }`
- `POST /api/friends/request`: `{ targetUsername }` -> sends a pending friend request
- `POST /api/friends/accept`: `{ fromUsername }` -> accepts an incoming friend request
- `POST /api/friends/reject`: `{ fromUsername }` -> declines/cancels a friend request
- `POST /api/friends/remove`: `{ friendUsername }` -> removes an accepted friendship

### System & Configuration
- `GET /health`: Health status, active room and client counts.
- `GET /api/config/ice`: Returns dynamic ICE servers (Google STUN + optional TURN).
- `GET /api/messages?room=<name>&limit=50`: Retrieves chat history for a channel.

---

## Deployment & Running

### Option 1: Docker Compose (All-in-One + PostgreSQL)
Run the full production stack with a single command:

```bash
docker compose up --build
```

- **App**: Available at `http://localhost:8080` (serves both API/WebSocket and built SPA).
- **Database**: PostgreSQL 16 on port 5432 with health check and persistent volume `pgdata`.

### Option 2: Local Development Script
Run the local dev script for hot reloading:

```bash
./start.sh
```

- Launches the Go backend on `http://localhost:8080`.
- Launches the Vite dev server on `http://localhost:5173`.
- Press `Ctrl+C` to terminate both services cleanly.

---

## Manual Running & Testing

### Backend
```bash
cd server
export PATH=/usr/local/go/bin:$PATH

# Run tests with race detection
go test -v -race ./...

# Build server binary
go build -buildvcs=false -o server .

# Run server (defaults to local file store)
./server
```

### Frontend
```bash
cd client

# Install dependencies
npm install

# Run dev server
npm run dev

# Run production build
npm run build
```
