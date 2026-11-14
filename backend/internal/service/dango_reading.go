package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

const (
	dangoEndpointSetting = "integration_dango_endpoint"
	dangoTokenSetting    = "integration_dango_token_encrypted"
)

type SecretCodec interface {
	EncryptValue(string) (string, error)
	DecryptValue(string) (string, error)
}

type DangoReadingStatus struct {
	Endpoint        string `json:"endpoint"`
	TokenConfigured bool   `json:"token_configured"`
}

type DangoReadingService struct {
	settings repository.UserSettingRepository
	secrets  SecretCodec
	client   *http.Client
}

func NewDangoReadingService(settings repository.UserSettingRepository, secrets SecretCodec) *DangoReadingService {
	return &DangoReadingService{settings: settings, secrets: secrets, client: &http.Client{Timeout: 10 * time.Second}}
}

func (s *DangoReadingService) Status(userID string) (*DangoReadingStatus, error) {
	endpoint, err := s.settingValue(userID, dangoEndpointSetting)
	if err != nil {
		return nil, err
	}
	token, err := s.settingValue(userID, dangoTokenSetting)
	if err != nil {
		return nil, err
	}
	return &DangoReadingStatus{Endpoint: endpoint, TokenConfigured: token != ""}, nil
}

func (s *DangoReadingService) Save(userID, endpoint, token string) error {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint != "" {
		parsed, err := url.ParseRequestURI(endpoint)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return fmt.Errorf("endpoint must be an absolute HTTP or HTTPS URL")
		}
	}
	token = strings.TrimSpace(token)
	encrypted := ""
	if token != "" {
		if s.secrets == nil {
			return fmt.Errorf("secret encryption is unavailable")
		}
		var err error
		encrypted, err = s.secrets.EncryptValue(token)
		if err != nil {
			return fmt.Errorf("encrypt Dango API key: %w", err)
		}
	}
	if endpoint != "" {
		if err := s.settings.Update(nil, userID, dangoEndpointSetting, endpoint); err != nil {
			return err
		}
	}
	if encrypted != "" {
		if err := s.settings.Update(nil, userID, dangoTokenSetting, encrypted); err != nil {
			return err
		}
	}
	return nil
}

func (s *DangoReadingService) Revoke(userID string) error {
	if err := s.settings.Delete(nil, userID, dangoTokenSetting); err != nil {
		return err
	}
	return s.settings.Delete(nil, userID, dangoEndpointSetting)
}

func (s *DangoReadingService) Publish(ctx context.Context, event ChapterCompletedWebhookEvent) error {
	if s == nil || strings.TrimSpace(event.UserID) == "" {
		return nil
	}
	endpoint, err := s.settingValue(event.UserID, dangoEndpointSetting)
	if err != nil {
		return fmt.Errorf("load Dango endpoint: %w", err)
	}
	encrypted, err := s.settingValue(event.UserID, dangoTokenSetting)
	if err != nil {
		return fmt.Errorf("load Dango API key: %w", err)
	}
	if endpoint == "" || encrypted == "" {
		return nil
	}
	token, err := s.secrets.DecryptValue(encrypted)
	if err != nil {
		return fmt.Errorf("decrypt Dango API key: %w", err)
	}
	chapter := float64(event.Chapter.Number)
	payload := struct {
		Title       string            `json:"title"`
		MediaType   string            `json:"media_type"`
		Chapter     float64           `json:"chapter"`
		Volume      *int              `json:"volume,omitempty"`
		Identifiers map[string]string `json:"identifiers,omitempty"`
	}{Title: event.Series.Title, MediaType: "manga", Chapter: chapter, Identifiers: event.Identifiers}
	if event.Chapter.VolumeNumber > 0 {
		volume := event.Chapter.VolumeNumber
		payload.Volume = &volume
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode Dango reading event: %w", err)
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(time.Duration(attempt) * 300 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("create Dango request: %w", err)
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Kumiho-Delivery", event.ID)
		response, err := s.client.Do(request)
		if err == nil {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				return nil
			}
			err = fmt.Errorf("Dango returned HTTP %d", response.StatusCode)
		}
		lastErr = err
	}
	return fmt.Errorf("deliver Dango reading event after 3 attempts: %w", lastErr)
}

func (s *DangoReadingService) settingValue(userID, key string) (string, error) {
	setting, err := s.settings.GetByKey(nil, userID, key)
	if err != nil || setting == nil {
		return "", err
	}
	return strings.TrimSpace(setting.Value), nil
}

type CompositeChapterWebhookPublisher []ChapterWebhookPublisher

func (publishers CompositeChapterWebhookPublisher) Publish(ctx context.Context, event ChapterCompletedWebhookEvent) error {
	if len(publishers) == 0 {
		return nil
	}
	deliveryErrors := make(chan error, len(publishers))
	var wait sync.WaitGroup
	for _, publisher := range publishers {
		if publisher == nil {
			continue
		}
		wait.Add(1)
		go func(publisher ChapterWebhookPublisher) {
			defer wait.Done()
			if err := publisher.Publish(ctx, event); err != nil {
				deliveryErrors <- err
			}
		}(publisher)
	}
	wait.Wait()
	close(deliveryErrors)
	var messages []string
	for err := range deliveryErrors {
		messages = append(messages, err.Error())
	}
	if len(messages) > 0 {
		return fmt.Errorf("webhook deliveries failed: %s", strings.Join(messages, "; "))
	}
	return nil
}
