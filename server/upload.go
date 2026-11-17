package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	maxUploadSize     = 10 << 20 // 10 MB strict limit
	multipartOverhead = 64 << 10 // 64 KB multipart header/boundary allowance
)

var blockedExtensions = map[string]bool{
	".exe":   true,
	".sh":    true,
	".bash":  true,
	".zsh":   true,
	".bat":   true,
	".cmd":   true,
	".com":   true,
	".msi":   true,
	".ps1":   true,
	".vbs":   true,
	".js":    true,
	".mjs":   true,
	".cjs":   true,
	".html":  true,
	".htm":   true,
	".xhtml": true,
	".svg":   true,
	".php":   true,
	".phtml": true,
	".jar":   true,
	".scr":   true,
	".dll":   true,
	".so":    true,
	".dylib": true,
}

func sanitizeExtension(filename string) (string, error) {
	ext := strings.ToLower(strings.TrimSpace(filepath.Ext(filename)))
	if ext == "" {
		return "", nil
	}
	if blockedExtensions[ext] {
		return "", fmt.Errorf("file extension %q is not allowed", ext)
	}
	if len(ext) > 12 {
		return "", errors.New("file extension is too long")
	}
	for _, r := range ext[1:] {
		if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return "", errors.New("file extension contains invalid characters")
		}
	}
	return ext, nil
}

func isSafeUploadFilename(name string) bool {
	if name == "" || len(name) > 128 {
		return false
	}
	if strings.Contains(name, "..") || strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return false
	}
	if filepath.Base(name) != name {
		return false
	}
	for _, r := range name {
		ok := (r >= 'a' && r <= 'z') ||
			(r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') ||
			r == '.' || r == '-' || r == '_'
		if !ok {
			return false
		}
	}
	return true
}

func generateSafeUploadName(ext string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b) + ext, nil
}

func isSafeImageMIME(mimeType string) bool {
	base := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	return strings.HasPrefix(base, "image/") && base != "image/svg+xml"
}

// uploadHandler handles POST /api/upload for images, documents, and general files up to 10MB.
func uploadHandler(store Store, uploadDir string) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			log.Printf("[Upload] Failed to ensure upload directory: %v", err)
			writeError(w, http.StatusInternalServerError, "Upload storage unavailable")
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize+multipartOverhead)
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) || strings.Contains(strings.ToLower(err.Error()), "request body too large") {
				writeError(w, http.StatusRequestEntityTooLarge, "File exceeds maximum allowed size of 10MB")
				return
			}
			writeError(w, http.StatusBadRequest, "Invalid multipart upload request")
			return
		}
		defer func() {
			if r.MultipartForm != nil {
				_ = r.MultipartForm.RemoveAll()
			}
		}()

		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(w, http.StatusBadRequest, "Missing file in form field 'file'")
			return
		}
		defer file.Close()

		origName := strings.TrimSpace(filepath.Base(header.Filename))
		if origName == "" || origName == "." || origName == "/" {
			origName = "upload"
		}

		ext, err := sanitizeExtension(origName)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		// Read initial 512 bytes for real MIME detection
		sniffBuf := make([]byte, 512)
		n, readErr := file.Read(sniffBuf)
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			writeError(w, http.StatusBadRequest, "Failed to read uploaded file")
			return
		}
		sniffBuf = sniffBuf[:n]
		if n == 0 {
			writeError(w, http.StatusBadRequest, "Uploaded file is empty")
			return
		}

		mimeType := http.DetectContentType(sniffBuf)
		// Normalize plain mime without parameters for clean client handling
		cleanMIME := strings.TrimSpace(strings.Split(mimeType, ";")[0])
		if cleanMIME == "text/html" {
			writeError(w, http.StatusBadRequest, "HTML uploads are not allowed")
			return
		}

		safeName, err := generateSafeUploadName(ext)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to generate filename")
			return
		}

		destPath := filepath.Join(uploadDir, safeName)
		dst, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			log.Printf("[Upload] Failed to create file %s: %v", destPath, err)
			writeError(w, http.StatusInternalServerError, "Failed to store uploaded file")
			return
		}

		writtenHead, err := dst.Write(sniffBuf)
		if err != nil {
			_ = dst.Close()
			_ = os.Remove(destPath)
			writeError(w, http.StatusInternalServerError, "Failed to write uploaded file")
			return
		}

		// Enforce strict 10MB cap on total file bytes
		remainingLimit := int64(maxUploadSize-writtenHead) + 1
		writtenTail, copyErr := io.Copy(dst, io.LimitReader(file, remainingLimit))
		closeErr := dst.Close()
		if copyErr != nil || closeErr != nil {
			_ = os.Remove(destPath)
			var maxBytesErr *http.MaxBytesError
			if errors.As(copyErr, &maxBytesErr) {
				writeError(w, http.StatusRequestEntityTooLarge, "File exceeds maximum allowed size of 10MB")
				return
			}
			writeError(w, http.StatusInternalServerError, "Failed to save uploaded file")
			return
		}

		totalSize := int64(writtenHead) + writtenTail
		if totalSize > maxUploadSize {
			_ = os.Remove(destPath)
			writeError(w, http.StatusRequestEntityTooLarge, "File exceeds maximum allowed size of 10MB")
			return
		}

		isImage := isSafeImageMIME(cleanMIME)

		writeJSON(w, http.StatusCreated, map[string]any{
			"url":      "/api/uploads/" + safeName,
			"name":     origName,
			"size":     totalSize,
			"mimeType": cleanMIME,
			"isImage":  isImage,
		})
	})
}

// serveUploadHandler handles GET /api/uploads/{filename} with strict traversal protection and safe headers.
func serveUploadHandler(uploadDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		rawPath := r.URL.Path
		if r.URL.RawPath != "" && (strings.Contains(strings.ToLower(r.URL.RawPath), "%2f") || strings.Contains(r.URL.RawPath, "..")) {
			writeError(w, http.StatusBadRequest, "Invalid filename")
			return
		}

		filename := strings.TrimPrefix(rawPath, "/api/uploads/")
		if !isSafeUploadFilename(filename) {
			writeError(w, http.StatusBadRequest, "Invalid filename")
			return
		}

		absDir, err := filepath.Abs(uploadDir)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Upload directory error")
			return
		}
		fullPath := filepath.Join(absDir, filename)
		if !strings.HasPrefix(fullPath, absDir+string(os.PathSeparator)) {
			writeError(w, http.StatusBadRequest, "Invalid filename")
			return
		}

		info, err := os.Stat(fullPath)
		if err != nil || info.IsDir() {
			writeError(w, http.StatusNotFound, "File not found")
			return
		}

		// Sniff real content type to decide inline image vs attachment download
		f, err := os.Open(fullPath)
		if err != nil {
			writeError(w, http.StatusNotFound, "File not found")
			return
		}
		head := make([]byte, 512)
		n, _ := f.Read(head)
		_ = f.Close()
		mimeType := http.DetectContentType(head[:n])

		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		if !isSafeImageMIME(mimeType) {
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		}

		http.ServeFile(w, r, fullPath)
	}
}

// --- GIF Search Proxy + Curated Fallback ---

type GifItem struct {
	ID    string   `json:"id"`
	Title string   `json:"title"`
	URL   string   `json:"url"`
	Tags  []string `json:"-"`
}

var curatedGifs = []GifItem{
	{ID: "wave-hello", Title: "Hello Wave", URL: "https://media.giphy.com/media/ASd0Ukj0y3qMM/giphy.gif", Tags: []string{"hello", "hi", "wave", "hey", "greet", "welcome"}},
	{ID: "thumbs-up", Title: "Thumbs Up", URL: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif", Tags: []string{"thumbs", "up", "ok", "yes", "approve", "nice", "good"}},
	{ID: "party-celebrate", Title: "Party Celebration", URL: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif", Tags: []string{"party", "celebrate", "dance", "woo", "hype", "congrats"}},
	{ID: "applause-clap", Title: "Slow Clap Applause", URL: "https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif", Tags: []string{"clap", "applause", "bravo", "gg", "respect", "win"}},
	{ID: "mind-blown", Title: "Mind Blown", URL: "https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif", Tags: []string{"mind", "blown", "wow", "whoa", "amazing", "shocked"}},
	{ID: "laugh-lol", Title: "Laughing Out Loud", URL: "https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif", Tags: []string{"laugh", "lol", "haha", "funny", "rofl", "lmao"}},
	{ID: "fire-lit", Title: "This Is Fire", URL: "https://media.giphy.com/media/l3q2XhfQ8oCkm1Ts4/giphy.gif", Tags: []string{"fire", "lit", "awesome", "epic", "hot", "clap"}},
	{ID: "coding-cat", Title: "Fast Typing Coding", URL: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif", Tags: []string{"coding", "typing", "cat", "hacker", "dev", "work", "computer"}},
	{ID: "ship-it-rocket", Title: "Rocket Launch Ship It", URL: "https://media.giphy.com/media/mi6DsSSNKDbUY/giphy.gif", Tags: []string{"rocket", "launch", "ship", "deploy", "go", "fast"}},
	{ID: "coffee-sip", Title: "Morning Coffee", URL: "https://media.giphy.com/media/3oriO04qxVReM5rJEA/giphy.gif", Tags: []string{"coffee", "morning", "drink", "tea", "break", "chill"}},
	{ID: "thinking-hmm", Title: "Thinking Hard", URL: "https://media.giphy.com/media/a5viI92PAF89q/giphy.gif", Tags: []string{"think", "thinking", "hmm", "wonder", "question", "debug"}},
	{ID: "yes-nod", Title: "Approving Nod", URL: "https://media.giphy.com/media/NEvPzZ8bd1V4Y/giphy.gif", Tags: []string{"yes", "nod", "agree", "deal", "cool", "nice"}},
	{ID: "facepalm", Title: "Classic Facepalm", URL: "https://media.giphy.com/media/6yRVg0HWzgS88/giphy.gif", Tags: []string{"facepalm", "oops", "fail", "bug", "no", "bruh"}},
	{ID: "love-heart", Title: "Sending Love", URL: "https://media.giphy.com/media/M90mJvfWfd5mbUuULX/giphy.gif", Tags: []string{"love", "heart", "thanks", "thank", "cute", "hug"}},
	{ID: "gg-victory", Title: "GG Victory", URL: "https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif", Tags: []string{"gg", "win", "victory", "trophy", "champ", "game"}},
	{ID: "popcorn", Title: "Grabbing Popcorn", URL: "https://media.giphy.com/media/tFK8urY6XHj2w/giphy.gif", Tags: []string{"popcorn", "watch", "drama", "waiting", "ready"}},
}

func filterCuratedGifs(query string) []GifItem {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		res := make([]GifItem, len(curatedGifs))
		copy(res, curatedGifs)
		return res
	}
	res := make([]GifItem, 0)
	for _, g := range curatedGifs {
		if strings.Contains(strings.ToLower(g.Title), q) {
			res = append(res, g)
			continue
		}
		for _, tag := range g.Tags {
			if strings.Contains(tag, q) || strings.Contains(q, tag) {
				res = append(res, g)
				break
			}
		}
	}
	return res
}

func fetchGiphyGifs(apiKey, query string) ([]GifItem, error) {
	client := &http.Client{Timeout: 4 * time.Second}
	endpoint := "https://api.giphy.com/v1/gifs/trending"
	params := url.Values{}
	params.Set("api_key", apiKey)
	params.Set("limit", "16")
	params.Set("rating", "g")
	if strings.TrimSpace(query) != "" {
		endpoint = "https://api.giphy.com/v1/gifs/search"
		params.Set("q", strings.TrimSpace(query))
	}

	resp, err := client.Get(endpoint + "?" + params.Encode())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("giphy upstream status %d", resp.StatusCode)
	}

	var payload struct {
		Data []struct {
			ID     string `json:"id"`
			Title  string `json:"title"`
			Images struct {
				FixedHeight struct {
					URL string `json:"url"`
				} `json:"fixed_height"`
				Downsized struct {
					URL string `json:"url"`
				} `json:"downsized"`
			} `json:"images"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	items := make([]GifItem, 0, len(payload.Data))
	for _, d := range payload.Data {
		gifURL := d.Images.FixedHeight.URL
		if gifURL == "" {
			gifURL = d.Images.Downsized.URL
		}
		if gifURL == "" {
			continue
		}
		items = append(items, GifItem{
			ID:    d.ID,
			Title: d.Title,
			URL:   gifURL,
		})
	}
	return items, nil
}

func fetchTenorGifs(apiKey, query string) ([]GifItem, error) {
	client := &http.Client{Timeout: 4 * time.Second}
	endpoint := "https://tenor.googleapis.com/v2/featured"
	params := url.Values{}
	params.Set("key", apiKey)
	params.Set("limit", "16")
	params.Set("media_filter", "gif,tinygif")
	if strings.TrimSpace(query) != "" {
		endpoint = "https://tenor.googleapis.com/v2/search"
		params.Set("q", strings.TrimSpace(query))
	}

	resp, err := client.Get(endpoint + "?" + params.Encode())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tenor upstream status %d", resp.StatusCode)
	}

	var payload struct {
		Results []struct {
			ID           string `json:"id"`
			ContentDesc  string `json:"content_description"`
			MediaFormats struct {
				TinyGif struct {
					URL string `json:"url"`
				} `json:"tinygif"`
				Gif struct {
					URL string `json:"url"`
				} `json:"gif"`
			} `json:"media_formats"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	items := make([]GifItem, 0, len(payload.Results))
	for _, r := range payload.Results {
		gifURL := r.MediaFormats.TinyGif.URL
		if gifURL == "" {
			gifURL = r.MediaFormats.Gif.URL
		}
		if gifURL == "" {
			continue
		}
		title := r.ContentDesc
		if title == "" {
			title = "GIF"
		}
		items = append(items, GifItem{
			ID:    r.ID,
			Title: title,
			URL:   gifURL,
		})
	}
	return items, nil
}

// gifSearchHandler handles GET /api/gifs?q=... using Giphy/Tenor if configured or curated fallback.
func gifSearchHandler(store Store) http.HandlerFunc {
	return requireAuth(store, func(w http.ResponseWriter, r *http.Request, user *User) {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		query := strings.TrimSpace(r.URL.Query().Get("q"))

		if giphyKey := strings.TrimSpace(os.Getenv("GIPHY_API_KEY")); giphyKey != "" {
			if gifs, err := fetchGiphyGifs(giphyKey, query); err == nil {
				writeJSON(w, http.StatusOK, map[string]any{
					"gifs":   gifs,
					"source": "giphy",
				})
				return
			} else {
				log.Printf("[GIF] Giphy upstream failed, using curated fallback: %v", err)
			}
		} else if tenorKey := strings.TrimSpace(os.Getenv("TENOR_API_KEY")); tenorKey != "" {
			if gifs, err := fetchTenorGifs(tenorKey, query); err == nil {
				writeJSON(w, http.StatusOK, map[string]any{
					"gifs":   gifs,
					"source": "tenor",
				})
				return
			} else {
				log.Printf("[GIF] Tenor upstream failed, using curated fallback: %v", err)
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"gifs":   filterCuratedGifs(query),
			"source": "curated",
		})
	})
}
