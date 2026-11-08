package handler

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type MangafyChapterRef struct {
	Path          string      `json:"path"`
	MangaTitle    string      `json:"manga_title"`
	ChapterNumber interface{} `json:"chapter_number"`
}

var (
	mangafyClient    = &http.Client{Timeout: 5 * time.Second}
	mangafyURLMu     sync.RWMutex
	cachedMangafyURL string
)

func getMangafyCandidates() []string {
	mangafyURLMu.RLock()
	cached := cachedMangafyURL
	mangafyURLMu.RUnlock()

	rawCandidates := make([]string, 0, 7)
	if cached != "" {
		rawCandidates = append(rawCandidates, cached)
	}

	envURL := strings.TrimRight(strings.TrimSpace(os.Getenv("MANGAFY_URL")), "/")
	if envURL != "" {
		rawCandidates = append(rawCandidates, envURL)
	}

	rawCandidates = append(rawCandidates,
		"http://host.docker.internal:4000",
		"http://172.22.0.1:4000",
		"http://mangafy:4000",
		"http://172.17.0.1:4000",
		"http://localhost:4000",
	)

	seenURL := make(map[string]bool)
	candidates := make([]string, 0, len(rawCandidates))
	for _, u := range rawCandidates {
		if !seenURL[u] {
			seenURL[u] = true
			candidates = append(candidates, u)
		}
	}
	return candidates
}

func notifyMangafy(seriesTitle string, chapterNumber interface{}, path string) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"path":           path,
		"manga_title":    seriesTitle,
		"chapter_number": chapterNumber,
	})

	candidates := getMangafyCandidates()
	for _, baseURL := range candidates {
		targetURL := baseURL + "/api/chapters/delete"
		log.Printf("[Mangafy] Sending chapter delete to %s for '%s' ch.%v (path: %s)", targetURL, seriesTitle, chapterNumber, path)
		resp, reqErr := mangafyClient.Post(targetURL, "application/json", bytes.NewBuffer(reqBody))
		if reqErr == nil && resp != nil {
			log.Printf("[Mangafy] Mangafy response from %s: HTTP %d", targetURL, resp.StatusCode)
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
				mangafyURLMu.Lock()
				cachedMangafyURL = baseURL
				mangafyURLMu.Unlock()
				return
			}
		} else if reqErr != nil {
			log.Printf("[Mangafy] Attempt failed for %s: %v", targetURL, reqErr)
		}
	}
}

func notifyMangafyBatch(items []MangafyChapterRef) {
	if len(items) == 0 {
		return
	}

	reqBody, _ := json.Marshal(map[string]interface{}{
		"chapters": items,
	})

	candidates := getMangafyCandidates()
	for _, baseURL := range candidates {
		targetURL := baseURL + "/api/chapters/delete"
		log.Printf("[Mangafy] Sending batch delete (%d chapters) to %s", len(items), targetURL)
		resp, reqErr := mangafyClient.Post(targetURL, "application/json", bytes.NewBuffer(reqBody))
		if reqErr == nil && resp != nil {
			log.Printf("[Mangafy] Mangafy batch response from %s: HTTP %d", targetURL, resp.StatusCode)
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
				mangafyURLMu.Lock()
				cachedMangafyURL = baseURL
				mangafyURLMu.Unlock()
				return
			}
		} else if reqErr != nil {
			log.Printf("[Mangafy] Batch attempt failed for %s: %v", targetURL, reqErr)
		}
	}

	// Fallback to individual calls if batch failed or unsupported
	log.Printf("[Mangafy] Batch call did not succeed, falling back to individual chapter notifications")
	for _, item := range items {
		notifyMangafy(item.MangaTitle, item.ChapterNumber, item.Path)
	}
}
