# WeConnect

A minimal, high-performance Discord-style real-time collaboration application featuring text channels, live presence indicators, and WebRTC mesh audio/video calling with screen sharing.

---

## Architecture Overview

```
WeConnect/
├── server/               # Minimal Go WebSocket & Signaling Server
│   ├── main.go          # HTTP server, /health & /ws endpoints, CORS middleware
│   ├── hub.go           # Thread-safe Room management (sync.RWMutex), WebRTC signaling routing
│   ├── client.go        # WebSocket connection wrapper with heartbeats & panic safety
│   └── server_test.go   # Integration test suite with race detector coverage
├── client/               # React 19 + TypeScript + Vite + Tailwind CSS Frontend
│   └── src/
│       ├── types/       # Shared message protocol definitions
│       ├── hooks/       # useSocket (WebSocket manager), useWebRTC (Mesh call manager)
│       └── components/  # Discord UI: ChannelSidebar, ChatArea, UserList, VideoGrid, CallControls
├── start.sh              # Unified service runner with health checks and graceful teardown
└── README.md
```

### Backend (`server/`)
- **Technology**: Go (`go1.26+`), `github.com/gorilla/websocket`.
- **Thread Safety**: Complete room synchronization with `sync.RWMutex`.
- **Signaling Hub**:
  - Broadcasts room chat and user join/leave presence notifications.
  - Generates deduplicated user lists on membership changes.
  - Targeted 1-to-1 WebRTC signaling router (`data.target`) for SDP Offers, Answers, and ICE Candidates.
  - Automatically garbage-collects empty rooms.
- **Resilience**:
  - Buffered client send queues (256 frames) with non-blocking dispatch to prevent backpressure blocking.
  - Gorilla WebSocket ping/pong heartbeats (`pongWait: 60s`, `pingPeriod: 54s`, `writeWait: 10s`).
  - Full panic recovery across read and write pumps.
  - Strict HTTP status codes and error messaging.

### Frontend (`client/`)
- **Technology**: React 19, TypeScript, Vite, Tailwind CSS v3, Lucide Icons.
- **Theme**: Discord-style dark aesthetic (`#1e1f22`, `#2b2d31`, `#313338`).
- **Real-Time Features**:
  - Text Channels: `#general`, `#random`, `#dev-chat` with instant switching and message history.
  - Online Presence: Active participant counter and real-time user list with status indicators.
  - Voice Channels: `🔊 Voice Lounge`, `🔊 Gaming` with integrated WebRTC mesh audio/video calling.
  - Mesh WebRTC: Google STUN (`stun:stun.l.google.com:19302`), candidate buffering, mic mute toggle, camera toggle, screen sharing toggle via `getDisplayMedia`, and responsive participant video grid.

---

## WebSocket & Signaling Protocol

Messages are exchanged over `ws://localhost:8080/ws?room=<room_name>&user=<username>` in JSON:

```json
{
  "type": "chat | join | leave | users | signal | error",
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
| `error` | Server → Client | Unicast error message for invalid formats or unknown targets. |

---

## Getting Started

### Prerequisites
- **Go**: 1.22 or higher (installed at `/usr/local/go/bin` or in system `$PATH`).
- **Node.js**: v18+ and `npm`.

### One-Command Quickstart
Run the bundled start script to launch both backend and frontend:

```bash
./start.sh
```

The script will:
1. Compile and launch the Go backend on `http://localhost:8080`.
2. Perform an automated `/health` check.
3. Launch the Vite frontend on `http://localhost:5173`.
4. Gracefully terminate both processes when you press `Ctrl+C`.

---

## Manual Running & Testing

### Backend
```bash
cd server
export PATH=/usr/local/go/bin:$PATH

# Run all tests with data race detector
go test -v -race ./...

# Build server binary
go build -o server .

# Run server
./server
```

### Frontend
```bash
cd client

# Install dependencies
npm install

# Run development server
npm run dev

# Run production build and type checking
npm run build
```
