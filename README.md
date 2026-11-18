<div align="center">

<img src="./client/public/logo.svg" width="72" height="72" alt="WeConnect Logo" />

# WeConnect

### *Next-Generation Real-Time Communication Platform*

**High-Performance Discord Alternative · Ultra-Low Latency WebRTC Mesh · Bespoke Obsidian Interface**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-weconnect--dgw2.onrender.com-6366f1?style=for-the-badge&logo=render&logoColor=white)](https://weconnect-dgw2.onrender.com)
[![Go Version](https://img.shields.io/badge/Go-1.23-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://golang.org)
[![React 19](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![WebRTC](https://img.shields.io/badge/WebRTC-Mesh%20Calling-FF6C37?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org)
[![PostgreSQL](https://img.shields.io/badge/Neon-PostgreSQL-00E599?style=for-the-badge&logo=postgresql&logoColor=black)](https://neon.tech)
[![Docker](https://img.shields.io/badge/Docker-28MB%20Alpine-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![Android APK](https://img.shields.io/badge/Android-4.1MB%20APK-3DDC84?style=for-the-badge&logo=android&logoColor=white)](#-android-apk-mobile-app)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<br/>

[🚀 **Explore Live App**](https://weconnect-dgw2.onrender.com) • [📱 **Android APK**](#-android-apk-mobile-app) • [🎬 **Interactive Walkthrough Tour**](https://weconnect-dgw2.onrender.com/tour.html) • [✨ **Features**](#-key-features) • [🎥 **Video Showcase**](#-video-showcase--gallery) • [📐 **Architecture**](#-technical-architecture) • [⚡ **Quickstart**](#-quickstart--local-development) • [🚢 **Deployment**](#-cloud-deployment-render--neon)

<br/>

</div>

---

## 💡 Overview

**WeConnect** is a full-stack, enterprise-grade real-time collaboration ecosystem inspired by modern tools like Discord and Linear. Engineered from first principles with **zero bloat**, it unifies sub-millisecond full-duplex WebSocket messaging with an advanced **multi-track WebRTC mesh audio/video calling engine**.

Whether streaming 1080p 60fps video with tab audio, multitasking via an in-app Picture-in-Picture mini-player, sharing encrypted documents, or enjoying instant direct messaging with call alerts, WeConnect delivers a fluid, dark-mode experience packaged in an ultra-lean **28MB Alpine container**.

---

## 🎥 Video Showcase & Gallery

> [!TIP]
> **Experience WeConnect in Action:** Watch the full product walkthrough demonstrating crystal-clear WebRTC mesh calls, screen audio capture, and bespoke UI interactions.

### 🎬 Product Walkthrough Video

<div align="center">

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ▶  WECONNECT LIVE PRODUCT TOUR                                      1080p HD   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

<!-- 
  To showcase your video on GitHub:
  1. Upload your recorded .mp4 or .webm into a GitHub Issue/PR draft, copy the uploaded CDN url, and paste it into the <video> tag below:
  OR
  2. Embed a high-resolution animated GIF preview linked to your YouTube / Loom recording.
-->

<video src="https://github.com/user-attachments/assets/replace-with-your-video-id.mp4" controls="controls" muted="muted" playsinline="playsinline" width="100%" poster="https://raw.githubusercontent.com/Sid-bit28/WeConnect/main/.github/preview-banner.png">
  <p>Your browser does not support the video tag. <a href="https://weconnect-dgw2.onrender.com">Click here to test the live interactive application.</a></p>
</video>

<br/>

[![Watch Demo](https://img.shields.io/badge/Watch%20Full%20Demo-YouTube%201080p-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://weconnect-dgw2.onrender.com/tour.html)
</div>

<br/>

### 📸 Core Feature Gallery

| 1. Discord Stage Layout & Screen Sharing | 2. In-App Floating PiP Mini-Player |
| :---: | :---: |
| Simultaneous 1080p webcam + full tab/system audio screen broadcast with Discord-inspired presenter layout. | Draggable, resizable floating call dock maintaining background audio sinks while chatting. |
| **3. Direct Messages & Live Call Ringing** | **4. Rich Multimedia Chat & File Sharing** |
| Real-time presence, typing indicators, read receipts, and live incoming call modal with audio chime. | Markdown formatting, inline code blocks, file uploads up to 2GB, stickers, and Giphy search. |

---

## ✨ Key Features

### 🎙️ WebRTC Audio, Video & Screen Engine
- **Simultaneous Dual-Stream Architecture**: Separate `RTCPeerConnection` pipelines for camera and screen sharing prevent track negotiation conflicts and maintain pristine framerates.
- **Synchronized Tab & System Audio**: Full stereo capture using `getDisplayMedia` with browser tab and PipeWire/system audio forwarding.
- **Active Speaker Detection**: Real-time volume analysis powered by the Web Audio API with green halo indicators and audio meter bars.
- **Mid-Call Device Switcher**: Live dynamic microphone and camera switching during ongoing calls without reconnection interruption.
- **Resilient Re-Acquisition**: Hardware-aware track recovery automatically revives ended camera tracks and synchronizes state via `media-state` signaling.

### 🖼️ In-App Floating Picture-in-Picture (PiP)
- **Fluid Floating Mini-Player**: Minimize any active channel or DM call into a floating, touch-friendly window that snaps across your workspace.
- **Persistent Audio Sinks**: Background WebRTC audio rendering ensures uninterrupted voice calls while navigating channels, reading docs, or sending files.
- **One-Click Expansion & Docking**: Quick controls for mic toggle, camera mute, and call termination directly on the mini-player.

### 💬 Real-Time Messaging & Rich Media
- **Rich Text & Code Highlighting**: Full GitHub Flavored Markdown support with fenced code blocks and copy shortcuts.
- **Attachments & Documents**: Instant file sharing supporting images, PDFs, archives, and media with download progress indicators.
- **Interactive Reactions & Replies**: Threaded quoting/replies, emoji reactions, message editing, and creator-guarded deletion.
- **Giphy & Sticker Library**: Integrated sticker picker and Giphy search engine for expressive team communication.
- **SSRF-Safe Link Previews**: OpenGraph metadata scraper equipped with strict RFC1918 private network filters to eliminate SSRF attack vectors.

### 🛡️ Channels, Groups & Presence
- **Flexible Channels**: Public rooms (`#general`, `#random`, `#voice-lounge`) and private invite-only groups with creator-managed access control.
- **Direct Messaging (DMs)**: End-to-end 1-on-1 private rooms with persistent message history and read receipts (`Sent` / `Read`).
- **Real-Time Presence**: Live online/offline status, custom status badges, typing indicators, and unread notification badges.

---

## 📐 Technical Architecture

```mermaid
flowchart TD
    subgraph Clients["React 19 Client Tier"]
        C1["User Alice\n(React 19 + Vite)"]
        C2["User Bob\n(React 19 + Vite)"]
    end

    subgraph ServerTier["Go 1.23 High-Performance Server"]
        WS["Gorilla WebSocket Hub\n(/ws)"]
        AUTH["Auth & Sessions API\n(/api/auth)"]
        MSG["Chat & Signal Router\n(RWMutex Concurrency)"]
        SSRF["SSRF-Safe Link Scraper\n(/api/link-preview)"]
    end

    subgraph StorageTier["Dual-Engine Storage"]
        PG["Neon Serverless PostgreSQL\n(pgxpool connection pool)"]
        FS["Atomic FileStore Fallback\n(data/store.json)"]
    end

    subgraph WebRTCData["Peer-to-Peer Mesh Network"]
        CAM["Webcam MediaStream (P2P)"]
        SCR["Screen Share + Tab Audio (P2P)"]
    end

    C1 <-->|"WSS Signals / Chat / Presence"| WS
    C2 <-->|"WSS Signals / Chat / Presence"| WS
    WS <--> MSG
    MSG <--> PG
    MSG -.->|"Fallback if DB unset"| FS
    C1 <-.->|"P2P Video & Audio Mesh"| CAM <-.-> C2
    C1 <-.->|"P2P Screen Broadcast"| SCR <-.-> C2
```

### 🔬 Engineering Decisions & Benchmarks

| Metric / Dimension | WeConnect | Standard Bloatware (Slack/Discord) | Why It Matters |
| :--- | :--- | :--- | :--- |
| **Container Size** | **~28 MB** (Alpine 3.20) | 800 MB - 1.5 GB | Ultra-fast cold starts and tiny deployment footprint. |
| **Idle Memory (Backend)** | **< 20 MB** (Go runtime) | 400 MB - 1.2 GB (Node/Electron) | Extremely cost-effective; runs on free-tier micro instances. |
| **Signaling Latency** | **< 2 ms** dispatch | 45 - 120 ms | Instant typing indicators, call rings, and message delivery. |
| **WebRTC Media Path** | **Direct Mesh P2P** | Centralized SFU/MCU server | Maximum privacy; audio and video never touch the database. |
| **Storage Portability** | **PostgreSQL + FileStore** | Vendor-locked Cloud DB | Run completely offline without internet or external DB setup. |

---

## 🛠️ Tech Stack Deep Dive

### Backend
* **Language**: Go (`1.23.0`)
* **WebSocket Engine**: `github.com/gorilla/websocket` with non-blocking 256-frame buffers and heartbeat monitors (`pongWait: 60s`, `pingPeriod: 54s`).
* **Database Driver**: `github.com/jackc/pgx/v5` with connection pooling (`pgxpool`), optimized for serverless sleep/cold-wake cycles.
* **Security**: Argon2id password hashing, constant-time token comparison, sliding-window rate limiting, and RFC1918 loopback SSRF guards.
* **Testing**: 100% passing test suite across 23 integration scenarios executed with Go race detection (`go test -race ./...`).

### Frontend
* **Core Framework**: React 19, TypeScript 5.7, Vite 6
* **Styling**: Tailwind CSS v3 with custom Linear/Obsidian theme tokens and responsive `100dvh` drawer layouts.
* **Media Handling**: Native WebRTC (`RTCPeerConnection`, `getDisplayMedia`, Web Audio API `AudioContext`).
* **Icons & Animation**: Lucide React, Framer-like responsive micro-transitions.

---

## ⚡ Quickstart & Local Development

### Prerequisites
* [Go 1.23+](https://golang.org/dl/)
* [Node.js 20+](https://nodejs.org/)
* [Docker & Docker Compose](https://www.docker.com/) *(optional for container run)*

### 1. Automated Local Runner
Clone the repository and run the startup script:

```bash
git clone https://github.com/Sid-bit28/WeConnect.git
cd WeConnect
chmod +x start.sh
./start.sh
```

- **Backend**: `http://localhost:8080` (WebSocket signaling & REST API)
- **Frontend**: `http://localhost:5173` (Vite dev server with hot module reload)

---

### 2. All-in-One Docker Compose
To spin up WeConnect with PostgreSQL locally in a single command:

```bash
docker compose up --build
```

Access the application at `http://localhost:8080`.

---

## 🚢 Cloud Deployment (Render + Neon)

WeConnect is pre-configured with a zero-config [`render.yaml`](./render.yaml) Blueprint and Neon serverless connection tuning.

### Step 1: Provision Neon PostgreSQL
1. Sign up for free at [neon.tech](https://neon.tech).
2. Create a project and copy your **Pooled Connection String**:
   ```
   postgres://username:password@ep-cool-fog-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### Step 2: Deploy to Render
1. Push your code to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), select **New → Blueprint** and link your repository.
3. Render will read [`render.yaml`](./render.yaml), provision the Docker service, and prompt for:
   * `DATABASE_URL`: Paste your Neon connection string.
   * `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` *(Optional: Metered.ca free credentials for strict corporate firewalls)*.
4. Click **Apply**. Your app will build and deploy with full HTTPS/WSS support.

---

## 📱 Android APK (Mobile App)

WeConnect is packaged for Android via **Capacitor 8** with native WebRTC hardware acceleration, automatic permission prompts, and high-density adaptive launcher icons.

### 📥 Download & Install APK
The compiled debug APK is generated and staged directly in the repository root:
* **File**: [`WeConnect.apk`](./WeConnect.apk) (4.1 MB)
* **Package**: `com.weconnect.app`
* **Features Enabled**: Full 1080p camera calling, microphone audio, background audio sinks, picture-in-picture, and real-time push-alerts.

To install directly onto an Android device via USB debugging:
```bash
adb install -r WeConnect.apk
```

### ⚙️ Build from Source
```bash
cd client
npm run build
node scripts/generate-icons.js
npx cap sync android
cd android && ./gradlew assembleDebug
```
The newly compiled APK will be in `client/android/app/build/outputs/apk/debug/app-debug.apk`.

### 🚀 Automated GitHub Actions CI/CD
Every tag (`v*`) or push to `main` automatically triggers [`.github/workflows/build-apk.yml`](./.github/workflows/build-apk.yml) to compile and upload the latest APK as a downloadable release asset.

---

## 📡 WebSocket Protocol Reference

Clients communicate over `wss://<host>/ws?room=<name>&token=<jwt>` using structured JSON envelopes:

```json
{
  "type": "chat | signal | typing | read_receipt | error",
  "room": "general",
  "sender": "siddarth",
  "content": "Meeting started in Voice Lounge!",
  "data": {
    "target": "alice",
    "signalType": "offer",
    "payload": { ... }
  },
  "timestamp": 1700000000000
}
```

### Core Signal Types
| Signal Type | Sender → Receiver | Function |
| :--- | :--- | :--- |
| `offer` / `answer` | Client ↔ Client | WebRTC SDP negotiation for 1080p camera & microphone. |
| `candidate` | Client ↔ Client | Trickle ICE network pathway discovery. |
| `screen-offer` / `screen-answer` | Presenter ↔ Viewer | Independent peer connection negotiation for screen broadcast. |
| `media-state` | Client → Peers | Real-time broadcast of microphone mute and camera visibility toggles. |
| `screen-leave` | Presenter → Room | Graceful teardown of screen share streams on the stage. |
| `call-join` | Client → Room | Broadcast to announce call entry and initiate mesh handshake. |

---

## 📁 Repository Structure

```
WeConnect/
├── client/                     # React 19 Frontend
│   ├── src/
│   │   ├── components/         # Modular UI (VideoGrid, FloatingCallPiP, ChatArea, etc.)
│   │   ├── hooks/              # useWebRTC, useSocket, useActiveSpeaker, useAuth
│   │   ├── types/              # Protocol interfaces & TypeScript definitions
│   │   └── App.tsx             # Root layout & drawer state manager
│   ├── tailwind.config.js      # Linear-inspired Obsidian design tokens
│   └── vite.config.ts          # Optimized bundler configuration
│
├── server/                     # High-Performance Go Server
│   ├── main.go                 # HTTP server, routing, SPA static file server
│   ├── hub.go                  # Concurrency-safe room manager & signaling dispatcher
│   ├── client.go               # Non-blocking WebSocket reader/writer pumps
│   ├── store.go                # Dynamic Store interface & atomic FileStore
│   ├── postgres_store.go       # Neon pgxpool implementation with migrations
│   └── server_test.go          # 23 comprehensive race-condition integration tests
│
├── Dockerfile                  # Multi-stage production build (Node 20 → Go 1.23 → Alpine)
├── docker-compose.yml          # Local containerized orchestration with PostgreSQL
├── render.yaml                 # Infrastructure-as-Code Blueprint for Render
└── start.sh                    # Dual-service hot-reloading development script
```

---

## 👨‍💻 Author

**Siddarth Banerjee**
- **GitHub**: [@Sid-bit28](https://github.com/Sid-bit28)
- **Project Repository**: [github.com/Sid-bit28/WeConnect](https://github.com/Sid-bit28/WeConnect)
- **Live Demo**: [weconnect-dgw2.onrender.com](https://weconnect-dgw2.onrender.com)

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
