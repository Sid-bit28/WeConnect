package main

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimiter implements a lightweight thread-safe per-IP sliding window rate limiter.
type RateLimiter struct {
	mu        sync.Mutex
	limit     int
	window    time.Duration
	buckets   map[string][]time.Time
	lastPrune time.Time
}

// NewRateLimiter constructs a RateLimiter permitting at most limit requests per window per IP.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		limit:     limit,
		window:    window,
		buckets:   make(map[string][]time.Time),
		lastPrune: time.Now(),
	}
}

// Allow records an attempt for key (client IP) and returns whether it is permitted
// along with the suggested retry duration when rate limited.
func (rl *RateLimiter) Allow(key string) (bool, time.Duration) {
	now := time.Now()
	cutoff := now.Add(-rl.window)

	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Periodically prune stale buckets to keep memory bounded without background goroutines
	if now.Sub(rl.lastPrune) >= rl.window {
		for k, stamps := range rl.buckets {
			valid := stamps[:0]
			for _, ts := range stamps {
				if ts.After(cutoff) {
					valid = append(valid, ts)
				}
			}
			if len(valid) == 0 {
				delete(rl.buckets, k)
			} else {
				rl.buckets[k] = valid
			}
		}
		rl.lastPrune = now
	}

	stamps := rl.buckets[key]
	valid := stamps[:0]
	for _, ts := range stamps {
		if ts.After(cutoff) {
			valid = append(valid, ts)
		}
	}

	if len(valid) >= rl.limit {
		rl.buckets[key] = valid
		retryAfter := valid[0].Add(rl.window).Sub(now)
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		return false, retryAfter
	}

	valid = append(valid, now)
	rl.buckets[key] = valid
	return true, 0
}

func extractClientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		if first := strings.TrimSpace(parts[0]); first != "" {
			return first
		}
	}
	if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
		return xri
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	if r.RemoteAddr != "" {
		return r.RemoteAddr
	}
	return "unknown"
}

// Middleware wraps an http.HandlerFunc with per-IP rate limiting (429 + Retry-After).
func (rl *RateLimiter) Middleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := extractClientIP(r)
		allowed, retryAfter := rl.Allow(ip)
		if !allowed {
			secs := int(math.Ceil(retryAfter.Seconds()))
			if secs < 1 {
				secs = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			writeError(w, http.StatusTooManyRequests, "Too many requests. Please try again later.")
			return
		}
		next(w, r)
	}
}
