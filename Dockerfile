# Stage 1: Build Frontend Assets
FROM node:20-alpine AS frontend-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci || npm install

COPY client/ ./
RUN npm run build

# Stage 2: Build Go Backend Binary
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/server

RUN apk add --no-cache git ca-certificates
COPY server/go.mod server/go.sum* ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -buildvcs=false -ldflags="-w -s" -o server .

# Stage 3: Minimal Production Runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy compiled backend binary
COPY --from=backend-builder /app/server/server ./server

# Copy compiled static frontend SPA assets
COPY --from=frontend-builder /app/client/dist ./static

# Configure environment defaults
ENV PORT=8080 \
    STATIC_DIR=/app/static

EXPOSE 8080

CMD ["./server"]
