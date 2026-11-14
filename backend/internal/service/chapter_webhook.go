package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/google/uuid"
)

// ChapterCompletedWebhookEvent is the versioned, app-neutral event sent to
// configured webhook consumers after a reader marks a chapter as complete.
type ChapterCompletedWebhookEvent struct {
	ID          string            `json:"id"`
	Version     int               `json:"version"`
	Type        string            `json:"type"`
	OccurredAt  time.Time         `json:"occurred_at"`
	UserID      string            `json:"user_id"`
	Series      WebhookSeries     `json:"series"`
	Chapter     WebhookChapter    `json:"chapter"`
	Identifiers map[string]string `json:"identifiers,omitempty"`
}

type WebhookSeries struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	Metadata map[string]string `json:"metadata,omitempty"`
}

type WebhookChapter struct {
	ID           string `json:"id"`
	Number       int    `json:"number"`
	Title        string `json:"title"`
	VolumeID     string `json:"volume_id"`
	VolumeNumber int    `json:"volume_number"`
}

var catalogIDPattern = regexp.MustCompile(`(?i)/(?:manga|anime)/(\d+)`)

// ReadCatalogIdentifiers reads catalog IDs from the common sidecar files next
// to a series. metadata.json takes precedence and metadata.txt fills gaps.
func ReadCatalogIdentifiers(seriesPath string) map[string]string {
	baseDir := seriesPath
	if info, err := os.Stat(seriesPath); err == nil && !info.IsDir() {
		baseDir = filepath.Dir(seriesPath)
	}
	entries, err := os.ReadDir(baseDir)
	if err != nil {
		return nil
	}
	paths := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		switch strings.ToLower(entry.Name()) {
		case "metadata.json":
			paths["json"] = filepath.Join(baseDir, entry.Name())
		case "metadata.txt", "series_metadata.txt":
			if paths["text"] == "" {
				paths["text"] = filepath.Join(baseDir, entry.Name())
			}
		}
	}
	identifiers := make(map[string]string, 2)
	if path := paths["json"]; path != "" {
		if data, readErr := os.ReadFile(path); readErr == nil {
			var values map[string]json.RawMessage
			if json.Unmarshal(data, &values) == nil {
				for key, names := range map[string][]string{
					"anilist_id": {"anilist_id", "anilist"},
					"mal_id":     {"mal_id", "myanimelist_id", "myanimelist"},
				} {
					for _, name := range names {
						if raw := values[name]; len(raw) > 0 {
							var value string
							if json.Unmarshal(raw, &value) != nil {
								value = strings.Trim(string(raw), `"`)
							}
							if value = catalogID(value, key); value != "" {
								identifiers[key] = value
								break
							}
						}
					}
					if identifiers[key] == "" {
						urlKey := "anilist_url"
						if key == "mal_id" {
							urlKey = "mal_url"
						}
						if raw := values[urlKey]; len(raw) > 0 {
							var value string
							_ = json.Unmarshal(raw, &value)
							if value = catalogID(value, key); value != "" {
								identifiers[key] = value
							}
						}
					}
				}
			}
		}
	}
	if path := paths["text"]; path != "" {
		if data, readErr := os.ReadFile(path); readErr == nil {
			for _, line := range strings.Split(string(data), "\n") {
				parts := strings.SplitN(strings.TrimSpace(line), ":", 2)
				if len(parts) != 2 {
					continue
				}
				key := strings.ToLower(strings.TrimSpace(parts[0]))
				value := strings.TrimSpace(parts[1])
				if identifiers["anilist_id"] == "" && (key == "anilist" || key == "anilist_id" || key == "anilist id" || key == "anilist url") {
					identifiers["anilist_id"] = catalogID(value, "anilist_id")
				}
				if identifiers["mal_id"] == "" && (key == "mal" || key == "mal_id" || key == "mal id" || key == "mal url" || key == "myanimelist" || key == "myanimelist id" || key == "myanimelist url") {
					identifiers["mal_id"] = catalogID(value, "mal_id")
				}
			}
		}
	}
	if identifiers["anilist_id"] == "" {
		delete(identifiers, "anilist_id")
	}
	if identifiers["mal_id"] == "" {
		delete(identifiers, "mal_id")
	}
	if len(identifiers) == 0 {
		return nil
	}
	return identifiers
}

func catalogID(value, key string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.Trim(value, "0123456789") == "" {
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	if key == "anilist_id" && host != "anilist.co" && !strings.HasSuffix(host, ".anilist.co") {
		return ""
	}
	if key == "mal_id" && host != "myanimelist.net" && !strings.HasSuffix(host, ".myanimelist.net") {
		return ""
	}
	if match := catalogIDPattern.FindStringSubmatch(parsed.Path); len(match) > 1 {
		if _, err := strconv.Atoi(match[1]); err == nil {
			return match[1]
		}
	}
	return ""
}

type ChapterWebhookPublisher interface {
	Publish(context.Context, ChapterCompletedWebhookEvent) error
}

type ChapterWebhookService struct {
	url    string
	secret []byte
	client *http.Client
}

func NewChapterWebhookService(cfg *config.Config) *ChapterWebhookService {
	if cfg == nil {
		return nil
	}
	endpoint := strings.TrimSpace(cfg.WebhookURL)
	if endpoint == "" {
		return nil
	}
	return &ChapterWebhookService{
		url:    endpoint,
		secret: []byte(cfg.WebhookSecret),
		client: &http.Client{Timeout: 8 * time.Second},
	}
}

func (s *ChapterWebhookService) Publish(ctx context.Context, event ChapterCompletedWebhookEvent) error {
	if s == nil || s.url == "" {
		return nil
	}
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	if event.Version == 0 {
		event.Version = 1
	}
	if event.Type == "" {
		event.Type = "chapter.completed"
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode chapter webhook event: %w", err)
	}

	var lastErr error
	timestamp := event.OccurredAt.UTC().Format(time.RFC3339Nano)
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			delay := time.Duration(attempt) * 250 * time.Millisecond
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("create chapter webhook request: %w", err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Kumiho-Event", event.Type)
		request.Header.Set("X-Kumiho-Delivery", event.ID)
		request.Header.Set("X-Kumiho-Timestamp", timestamp)
		if len(s.secret) > 0 {
			mac := hmac.New(sha256.New, s.secret)
			_, _ = mac.Write([]byte(timestamp + "."))
			_, _ = mac.Write(body)
			request.Header.Set("X-Kumiho-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		}

		response, requestErr := s.client.Do(request)
		if requestErr == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				return nil
			}
			requestErr = fmt.Errorf("webhook endpoint returned HTTP %d", response.StatusCode)
		}
		lastErr = requestErr
	}
	return fmt.Errorf("deliver chapter webhook after 3 attempts: %w", lastErr)
}
