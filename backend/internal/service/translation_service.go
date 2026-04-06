package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/capability"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

var (
	ErrNoActiveTranslationPlugin = errors.New("no active translation plugin")
	ErrTranslationSourceEmpty    = errors.New("translation source text is empty")
)

type BatchTranslateResponse struct {
	// Deprecated: kept for backward compatibility. Prefer TotalTargets for total batch size.
	TotalProcessed int  `json:"total_processed"`
	TotalTargets   int  `json:"total_targets"`
	TotalSuccess   int  `json:"total_success"`
	TotalFailed    int  `json:"total_failed"`
	Cancelled      bool `json:"cancelled,omitempty"`
}

type TranslateSeriesDescriptionResponse struct {
	Series         *model.Series `json:"series"`
	TargetLang     string        `json:"target_lang"`
	TranslatedText string        `json:"translated_text"`
}

type TranslationService struct {
	manager     *pluginengine.Manager
	seriesRepo  *repository.SeriesRepository
	settingRepo repository.SettingRepository
}

const (
	batchTranslateMaxAttempts = 3
	batchTranslateMinInterval = 250 * time.Millisecond
)

func NewTranslationService(
	manager *pluginengine.Manager,
	seriesRepo *repository.SeriesRepository,
	settingRepo repository.SettingRepository,
) *TranslationService {
	return &TranslationService{
		manager:     manager,
		seriesRepo:  seriesRepo,
		settingRepo: settingRepo,
	}
}

func (s *TranslationService) getActiveTranslationPlugin() (string, error) {
	records, err := s.manager.List()
	if err != nil {
		return "", err
	}

	for _, record := range records {
		if record.State == sdkstate.Active && hasCapability(record.Manifest, capability.TranslationTranslate) {
			return record.ID, nil
		}
	}
	return "", ErrNoActiveTranslationPlugin
}

// BatchTranslate finds all series metadata that has description but no translated description,
// and uses the active translation plugin to translate them.
func (s *TranslationService) BatchTranslate(ctx context.Context, targetLang string) (*BatchTranslateResponse, error) {
	targetLang = s.resolveTargetLanguage(targetLang)

	pluginID, err := s.getActiveTranslationPlugin()
	if err != nil {
		return nil, err
	}

	targets, err := s.seriesRepo.FindUntranslatedSeriesForTranslation(nil)
	if err != nil {
		return nil, err
	}

	result := &BatchTranslateResponse{
		TotalProcessed: len(targets),
		TotalTargets:   len(targets),
	}
	lastCallAt := time.Time{}

	for _, target := range targets {
		if err := ctx.Err(); err != nil {
			result.Cancelled = true
			return result, nil
		}
		if !lastCallAt.IsZero() {
			wait := time.Until(lastCallAt.Add(batchTranslateMinInterval))
			if wait > 0 {
				timer := time.NewTimer(wait)
				select {
				case <-ctx.Done():
					timer.Stop()
					result.Cancelled = true
					return result, nil
				case <-timer.C:
				}
			}
		}

		desc := strings.TrimSpace(target.Description)
		if desc == "" {
			result.TotalFailed++
			continue
		}

		req := &sdktypes.TranslateRequest{
			Text:       []string{desc},
			TargetLang: targetLang,
		}

		resp, err := s.translateWithRetry(ctx, pluginID, req, batchTranslateMaxAttempts)
		lastCallAt = time.Now()
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			result.Cancelled = true
			return result, nil
		}
		if err != nil || resp == nil {
			result.TotalFailed++
			continue
		}
		translated := strings.TrimSpace(resp.Translations[0].Text)
		if translated == "" {
			result.TotalFailed++
			continue
		}

		if updateErr := s.seriesRepo.UpdateDescriptionTranslated(nil, target.ID, translated, time.Now()); updateErr != nil {
			result.TotalFailed++
			continue
		}

		result.TotalSuccess++
	}

	return result, nil
}

func (s *TranslationService) TranslateSeriesDescription(
	ctx context.Context,
	seriesID string,
	userID string,
	targetLang string,
) (*TranslateSeriesDescriptionResponse, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}
	if series.Metadata == nil {
		series.Metadata = &model.SeriesMetadata{SeriesID: series.ID}
	}

	sourceText := strings.TrimSpace(series.Description)
	if sourceText == "" {
		return nil, ErrTranslationSourceEmpty
	}

	resolvedTargetLang := s.resolveTargetLanguage(targetLang)
	pluginID, err := s.getActiveTranslationPlugin()
	if err != nil {
		return nil, err
	}

	resp, err := s.translateAndValidate(ctx, pluginID, &sdktypes.TranslateRequest{
		Text:       []string{sourceText},
		TargetLang: resolvedTargetLang,
	})
	if err != nil {
		return nil, err
	}

	translated := strings.TrimSpace(resp.Translations[0].Text)
	if translated == "" {
		return nil, errors.New("empty translated text")
	}

	series.Metadata.Description = series.Description
	series.Metadata.DescriptionTranslated = translated
	series.UpdatedAt = time.Now()
	if err := s.seriesRepo.Update(nil, series); err != nil {
		return nil, err
	}

	return &TranslateSeriesDescriptionResponse{
		Series:         series,
		TargetLang:     resolvedTargetLang,
		TranslatedText: translated,
	}, nil
}

func (s *TranslationService) resolveTargetLanguage(targetLang string) string {
	if normalized := normalizeTargetLanguage(targetLang); normalized != "" {
		return normalized
	}
	if s.settingRepo != nil {
		if setting, err := s.settingRepo.GetByKey(nil, "app_language"); err == nil && setting != nil {
			if normalized := normalizeAppLanguage(setting.Value); normalized != "" {
				return normalized
			}
		}
	}
	return "ko"
}

func normalizeTargetLanguage(language string) string {
	normalized := strings.ToLower(strings.TrimSpace(language))
	switch normalized {
	case "ar", "bg", "cs", "da", "de", "el", "en", "en-gb", "en-us", "es", "es-419", "et", "fi", "fr",
		"hu", "id", "it", "ja", "ko", "lt", "lv", "nb", "nl", "pl", "pt", "pt-br", "pt-pt", "ro", "ru",
		"sk", "sl", "sv", "tr", "uk", "zh", "zh-hans", "zh-hant":
		return normalized
	default:
		return ""
	}
}

func (s *TranslationService) translateWithRetry(
	ctx context.Context,
	pluginID string,
	req *sdktypes.TranslateRequest,
	maxAttempts int,
) (*sdktypes.TranslateResponse, error) {
	if maxAttempts < 1 {
		maxAttempts = 1
	}

	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		resp, err := s.translateAndValidate(ctx, pluginID, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if !isRateLimitedTranslateError(err) || attempt == maxAttempts {
			break
		}

		backoff := time.Duration(attempt) * 500 * time.Millisecond
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}

	return nil, lastErr
}

func (s *TranslationService) translateAndValidate(
	ctx context.Context,
	pluginID string,
	req *sdktypes.TranslateRequest,
) (*sdktypes.TranslateResponse, error) {
	resp, err := s.manager.Translate(ctx, pluginID, req)
	if err != nil {
		return nil, err
	}
	if resp == nil {
		return nil, errors.New("empty translate response")
	}
	if strings.TrimSpace(resp.Error) != "" {
		if pluginErr, ok := pluginerrors.Parse(strings.TrimSpace(resp.Error)); ok {
			return nil, pluginErr
		}
		return nil, errors.New(strings.TrimSpace(resp.Error))
	}
	if len(resp.Translations) == 0 {
		return nil, errors.New("empty translated result")
	}
	return resp, nil
}

func isRateLimitedTranslateError(err error) bool {
	if err == nil {
		return false
	}

	var pluginErr *pluginerrors.PluginError
	if errors.As(err, &pluginErr) {
		return pluginErr.Code == pluginerrors.ErrCodeRateLimited
	}
	return false
}

func normalizeAppLanguage(language string) string {
	switch normalized := strings.ToLower(strings.TrimSpace(language)); {
	case strings.HasPrefix(normalized, "ko"):
		return "ko"
	case strings.HasPrefix(normalized, "ja"):
		return "ja"
	case strings.HasPrefix(normalized, "en"):
		return "en"
	default:
		return ""
	}
}
