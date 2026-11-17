#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH=/usr/local/go/bin:$PATH

echo "=========================================="
echo " Starting WeConnect Full-Stack Application"
echo "=========================================="

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    trap - SIGINT SIGTERM EXIT
    echo ""
    echo "Stopping WeConnect services..."
    if [ -n "$FRONTEND_PID" ]; then
        echo "Stopping frontend (PID: $FRONTEND_PID)..."
        pkill -P "$FRONTEND_PID" 2>/dev/null || true
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    if [ -n "$BACKEND_PID" ]; then
        echo "Stopping backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    echo "WeConnect stopped cleanly."
}

trap cleanup SIGINT SIGTERM EXIT

# 1. Build & Start Go Backend
echo "--> Starting Go WebSocket Server on port 8080..."
cd "$ROOT_DIR/server"
if [ ! -f "server" ]; then
    echo "Building Go server binary..."
    go build -buildvcs=false -o server .
fi

./server &
BACKEND_PID=$!

# Health check with timeout
echo "--> Checking backend health..."
RETRIES=20
HEALTH_OK=0
for i in $(seq 1 $RETRIES); do
    if curl -s http://localhost:8080/health | grep -q '"status":"ok"'; then
        HEALTH_OK=1
        break
    fi
    sleep 0.5
done

if [ $HEALTH_OK -eq 1 ]; then
    echo "Backend is up and healthy at http://localhost:8080"
else
    echo "Backend failed health check. Exiting."
    exit 1
fi

# 2. Start Vite Frontend
echo "--> Starting React + Vite Frontend..."
cd "$ROOT_DIR/client"
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi

npm run dev &
FRONTEND_PID=$!

echo "=========================================="
echo " WeConnect is running!"
echo " Frontend: http://localhost:5173"
echo " Backend:  http://localhost:8080"
echo " Press Ctrl+C to shut down all services"
echo "=========================================="

# Wait for frontend process
wait "$FRONTEND_PID" 2>/dev/null || true
