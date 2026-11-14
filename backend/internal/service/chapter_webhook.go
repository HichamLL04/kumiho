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
