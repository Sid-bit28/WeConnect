package main

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxPreviewBodyBytes  = 512 * 1024 // 512 KB max HTML read
	maxPreviewRedirects  = 3
	previewFetchTimeout  = 4 * time.Second
	previewCacheTTL      = 15 * time.Minute
	previewCacheMaxItems = 500
)

var (
	ErrBlockedPreviewURL = errors.New("URL is not allowed")

	_, cgnatCIDR, _       = net.ParseCIDR("100.64.0.0/10")
	_, thisNetworkCIDR, _ = net.ParseCIDR("0.0.0.0/8")
	_, ipv6ULACIDR, _     = net.ParseCIDR("fc00::/7")
	_, ipv6LinkLocal, _   = net.ParseCIDR("fe80::/10")

	metaTagRegex  = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	metaAttrRegex = regexp.MustCompile(`(?is)([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')`)
	titleTagRegex = regexp.MustCompile(`(?is)<title\b[^>]*>(.*?)</title>`)
	wsCollapseRe  = regexp.MustCompile(`\s+`)
)

// LinkPreview holds sanitized OpenGraph / HTML metadata for a URL.
type LinkPreview struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Image       string `json:"image,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
}

type cachedPreview struct {
	preview   LinkPreview
	expiresAt time.Time
}

type previewCache struct {
	mu    sync.RWMutex
	items map[string]cachedPreview
}

func newPreviewCache() *previewCache {
	return &previewCache{
		items: make(map[string]cachedPreview),
	}
}

func (c *previewCache) Get(key string) (LinkPreview, bool) {
	now := time.Now()
	c.mu.RLock()
	entry, ok := c.items[key]
	c.mu.RUnlock()
	if !ok || now.After(entry.expiresAt) {
		return LinkPreview{}, false
	}
	return entry.preview, true
}

func (c *previewCache) Set(key string, p LinkPreview) {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()

	if len(c.items) >= previewCacheMaxItems {
		// Evict expired entries first
		for k, v := range c.items {
			if now.After(v.expiresAt) {
				delete(c.items, k)
			}
		}
		// If still full, evict oldest expiring entry
		if len(c.items) >= previewCacheMaxItems {
			var oldestKey string
			var oldestTime time.Time
			for k, v := range c.items {
				if oldestKey == "" || v.expiresAt.Before(oldestTime) {
					oldestKey = k
					oldestTime = v.expiresAt
				}
			}
			if oldestKey != "" {
				delete(c.items, oldestKey)
			}
		}
	}

	c.items[key] = cachedPreview{
		preview:   p,
		expiresAt: now.Add(previewCacheTTL),
	}
}

func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified() {
		return true
	}
	if cgnatCIDR != nil && cgnatCIDR.Contains(ip) {
		return true
	}
	if thisNetworkCIDR != nil && thisNetworkCIDR.Contains(ip) {
		return true
	}
	if ipv6ULACIDR != nil && ipv6ULACIDR.Contains(ip) {
		return true
	}
	if ipv6LinkLocal != nil && ipv6LinkLocal.Contains(ip) {
		return true
	}
	return false
}

func validatePreviewURL(rawURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" || len(trimmed) > 2048 {
		return nil, fmt.Errorf("%w: invalid URL length", ErrBlockedPreviewURL)
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("%w: malformed URL", ErrBlockedPreviewURL)
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("%w: only http and https URLs are supported", ErrBlockedPreviewURL)
	}

	if u.User != nil {
		return nil, fmt.Errorf("%w: embedded credentials are not allowed", ErrBlockedPreviewURL)
	}

	host := strings.ToLower(strings.TrimSpace(u.Hostname()))
	if host == "" {
		return nil, fmt.Errorf("%w: missing host", ErrBlockedPreviewURL)
	}

	if host == "localhost" ||
		strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".internal") {
		return nil, fmt.Errorf("%w: local hosts are blocked", ErrBlockedPreviewURL)
	}

	if ip := net.ParseIP(host); ip != nil && isBlockedIP(ip) {
		return nil, fmt.Errorf("%w: private or loopback IP addresses are blocked", ErrBlockedPreviewURL)
	}

	return u, nil
}

func safePreviewDialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid dial address", ErrBlockedPreviewURL)
	}

	var ips []net.IP
	if parsed := net.ParseIP(host); parsed != nil {
		ips = []net.IP{parsed}
	} else {
		resolved, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(resolved) == 0 {
			return nil, fmt.Errorf("DNS lookup failed: %w", err)
		}
		for _, r := range resolved {
			ips = append(ips, r.IP)
		}
	}

	// Reject if ANY resolved IP belongs to a private, loopback, link-local, or reserved range
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return nil, fmt.Errorf("%w: resolved IP %s is blocked", ErrBlockedPreviewURL, ip.String())
		}
	}

	dialer := &net.Dialer{
		Timeout:   previewFetchTimeout,
		KeepAlive: 0,
	}

	var lastErr error
	for _, ip := range ips {
		conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func newSafePreviewHTTPClient() *http.Client {
	transport := &http.Transport{
		DialContext:           safePreviewDialContext,
		TLSHandshakeTimeout:   3 * time.Second,
		ResponseHeaderTimeout: previewFetchTimeout,
		DisableKeepAlives:     true,
		MaxIdleConns:          10,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   previewFetchTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxPreviewRedirects {
				return errors.New("too many redirects")
			}
			if _, err := validatePreviewURL(req.URL.String()); err != nil {
				return err
			}
			return nil
		},
	}
}

func cleanMetaText(raw string, maxRunes int) string {
	unescaped := html.UnescapeString(raw)
	collapsed := strings.TrimSpace(wsCollapseRe.ReplaceAllString(unescaped, " "))
	runes := []rune(collapsed)
	if len(runes) <= maxRunes {
		return collapsed
	}
	return string(runes[:maxRunes-1]) + "…"
}

func resolveSafeImageURL(pageURL *url.URL, rawImg string) string {
	trimmed := strings.TrimSpace(html.UnescapeString(rawImg))
	if trimmed == "" || len(trimmed) > 2048 {
		return ""
	}
	ref, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	resolved := ref
	if pageURL != nil {
		resolved = pageURL.ResolveReference(ref)
	}
	scheme := strings.ToLower(resolved.Scheme)
	if (scheme != "http" && scheme != "https") || resolved.User != nil {
		return ""
	}
	return resolved.String()
}

// extractHTMLMetadata parses OpenGraph / standard HTML metadata safely without external dependencies.
func extractHTMLMetadata(pageURL *url.URL, htmlBody string) LinkPreview {
	preview := LinkPreview{}
	if pageURL != nil {
		preview.URL = pageURL.String()
	}

	meta := make(map[string]string)
	for _, tag := range metaTagRegex.FindAllString(htmlBody, 128) {
		matches := metaAttrRegex.FindAllStringSubmatch(tag, -1)
		var key, content string
		for _, m := range matches {
			attrName := strings.ToLower(strings.TrimSpace(m[1]))
			attrVal := m[2]
			if attrVal == "" {
				attrVal = m[3]
			}
			switch attrName {
			case "property", "name":
				if key == "" {
					key = strings.ToLower(strings.TrimSpace(attrVal))
				}
			case "content":
				content = attrVal
			}
		}
		if key != "" && content != "" {
			if _, exists := meta[key]; !exists {
				meta[key] = content
			}
		}
	}

	title := meta["og:title"]
	if title == "" {
		title = meta["twitter:title"]
	}
	if title == "" {
		if tm := titleTagRegex.FindStringSubmatch(htmlBody); len(tm) > 1 {
			title = tm[1]
		}
	}

	desc := meta["og:description"]
	if desc == "" {
		desc = meta["twitter:description"]
	}
	if desc == "" {
		desc = meta["description"]
	}

	img := meta["og:image"]
	if img == "" {
		img = meta["twitter:image"]
	}

	siteName := meta["og:site_name"]
	if siteName == "" && pageURL != nil {
		siteName = strings.TrimPrefix(strings.ToLower(pageURL.Hostname()), "www.")
	}

	preview.Title = cleanMetaText(title, 200)
	preview.Description = cleanMetaText(desc, 300)
	preview.Image = resolveSafeImageURL(pageURL, img)
	preview.SiteName = cleanMetaText(siteName, 100)
	return preview
}

// linkPreviewHandler handles GET /api/link-preview?url=... with strict SSRF protection and TTL caching.
func linkPreviewHandler(store Store) http.HandlerFunc {
	cache := newPreviewCache()
	client := newSafePreviewHTTPClient()

	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
		parsedURL, err := validatePreviewURL(rawURL)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		cacheKey := parsedURL.String()
		if cached, ok := cache.Get(cacheKey); ok {
			writeJSON(w, http.StatusOK, cached)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, cacheKey, nil)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Failed to build preview request")
			return
		}
		req.Header.Set("User-Agent", "WeConnectLinkPreview/1.0 (+https://weconnect.local)")
		req.Header.Set("Accept", "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1")

		resp, err := client.Do(req)
		if err != nil {
			if errors.Is(err, ErrBlockedPreviewURL) {
				writeError(w, http.StatusBadRequest, "URL target is blocked")
				return
			}
			writeJSON(w, http.StatusOK, LinkPreview{URL: cacheKey})
			return
		}
		defer resp.Body.Close()

		contentType := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type")))
		if resp.StatusCode < 200 || resp.StatusCode >= 300 || !strings.HasPrefix(contentType, "text/html") {
			empty := LinkPreview{URL: cacheKey}
			cache.Set(cacheKey, empty)
			writeJSON(w, http.StatusOK, empty)
			return
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxPreviewBodyBytes))
		if err != nil {
			writeJSON(w, http.StatusOK, LinkPreview{URL: cacheKey})
			return
		}

		finalURL := resp.Request.URL
		if finalURL == nil {
			finalURL = parsedURL
		}
		preview := extractHTMLMetadata(finalURL, string(bodyBytes))
		preview.URL = cacheKey

		cache.Set(cacheKey, preview)
		writeJSON(w, http.StatusOK, preview)
	})
}
