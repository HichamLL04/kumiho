package service

import (
	"context"
	"errors"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/capability"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func TestTranslationServiceBatchTranslateReturnsErrorWithoutActivePlugin(t *testing.T) {
	connectMetadataTestDB(t)

	svc := NewTranslationService(
		pluginengine.NewManager(pluginengine.NewMemoryStore()),
		repository.NewSeriesRepository(),
		repository.NewSettingRepository(),
	)

	_, err := svc.BatchTranslate(context.Background(), "en")
	if !errors.Is(err, ErrNoActiveTranslationPlugin) {
		t.Fatalf("BatchTranslate() error = %v, want %v", err, ErrNoActiveTranslationPlugin)
	}
}

func TestTranslationServiceBatchTranslateRetriesRateLimitedPlugin(t *testing.T) {
	connectMetadataTestDB(t)

	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	series.Description = "Hello world"
	series.Metadata.Description = "Hello world"
	if err := seriesRepo.Update(nil, series); err != nil {
		t.Fatalf("SeriesRepository.Update() error = %v", err)
	}

	rt := &translationRuntime{
		translateSequence: []translationCallResult{
			{err: pluginerrors.NewRetryable(pluginerrors.ErrCodeRateLimited, "slow down")},
			{err: pluginerrors.NewRetryable(pluginerrors.ErrCodeRateLimited, "slow down")},
			{resp: &sdktypes.TranslateResponse{Translations: []sdktypes.TranslationResult{{Text: "안녕하세요"}}}},
		},
	}
	svc := NewTranslationService(newActiveTranslationManager(t, rt), seriesRepo, repository.NewSettingRepository())

	result, err := svc.BatchTranslate(context.Background(), "ko")
	if err != nil {
		t.Fatalf("BatchTranslate() error = %v", err)
	}
	if result.TotalSuccess != 1 || result.TotalFailed != 0 {
		t.Fatalf("result = %#v", result)
	}
	if rt.translateCalls != 3 {
		t.Fatalf("translate calls = %d, want 3", rt.translateCalls)
	}

	refreshed, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if refreshed == nil || refreshed.Metadata == nil {
		t.Fatal("refreshed metadata should not be nil")
	}
	if refreshed.Metadata.DescriptionTranslated != "안녕하세요" {
		t.Fatalf("translated description = %q", refreshed.Metadata.DescriptionTranslated)
	}
}

func TestTranslationServiceBatchTranslateReturnsPartialResultOnCancel(t *testing.T) {
	connectMetadataTestDB(t)

	seriesRepo := repository.NewSeriesRepository()
	first := seedMetadataSeries(t, seriesRepo)
	first.Description = "First"
	first.Metadata.Description = "First"
	if err := seriesRepo.Update(nil, first); err != nil {
		t.Fatalf("SeriesRepository.Update(first) error = %v", err)
	}

	second := &model.Series{
		LibraryID:   first.LibraryID,
		Title:       "Second Series",
		Path:        "/library/second-series.epub",
		Description: "Second",
		Metadata: &model.SeriesMetadata{
			Description: "Second",
		},
	}
	if err := seriesRepo.Create(nil, second); err != nil {
		t.Fatalf("SeriesRepository.Create(second) error = %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	rt := &translationRuntime{
		translateSequence: []translationCallResult{
			{resp: &sdktypes.TranslateResponse{Translations: []sdktypes.TranslationResult{{Text: "첫 번째"}}}},
		},
		afterTranslate: func(call int) {
			if call == 1 {
				cancel()
			}
		},
	}
	svc := NewTranslationService(newActiveTranslationManager(t, rt), seriesRepo, repository.NewSettingRepository())

	result, err := svc.BatchTranslate(ctx, "ko")
	if err != nil {
		t.Fatalf("BatchTranslate() error = %v", err)
	}
	if !result.Cancelled {
		t.Fatalf("Cancelled = %v, want true", result.Cancelled)
	}
	if result.TotalSuccess != 1 || result.TotalFailed != 0 || result.TotalProcessed != 2 {
		t.Fatalf("result = %#v", result)
	}
	if rt.translateCalls != 1 {
		t.Fatalf("translate calls = %d, want 1", rt.translateCalls)
	}
}

func TestTranslationServiceResolveTargetLanguageFallsBackToAppLanguage(t *testing.T) {
	svc := NewTranslationService(
		pluginengine.NewManager(pluginengine.NewMemoryStore()),
		repository.NewSeriesRepository(),
		&fakeSettingRepo{setting: &model.Setting{Key: "app_language", Value: "ja-JP"}},
	)

	if language := svc.resolveTargetLanguage(""); language != "ja" {
		t.Fatalf("resolveTargetLanguage(\"\") = %q, want ja", language)
	}
}

func newActiveTranslationManager(t *testing.T, rt *translationRuntime) *pluginengine.Manager {
	t.Helper()

	manager := pluginengine.NewManager(pluginengine.NewMemoryStore(), rt)
	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:           "plugin-translate",
		Name:         "Translate Plugin",
		RuntimeType:  sdkmanifest.RuntimeTypeBinary,
		Capabilities: []capability.Capability{capability.TranslationTranslate},
	}, "/plugins/translate")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}
	if _, err := manager.MarkRegistered(record.ID); err != nil {
		t.Fatalf("MarkRegistered() error = %v", err)
	}
	if _, err := manager.Activate(context.Background(), record.ID); err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	return manager
}

type fakeSettingRepo struct {
	setting *model.Setting
	err     error
}

func (r *fakeSettingRepo) GetByKey(_ database.Queryer, key string) (*model.Setting, error) {
	if r.err != nil {
		return nil, r.err
	}
	if r.setting != nil && r.setting.Key == key {
		return r.setting, nil
	}
	return nil, nil
}

func (r *fakeSettingRepo) GetAll(database.Queryer) ([]model.Setting, error) {
	if r.setting == nil {
		return nil, r.err
	}
	return []model.Setting{*r.setting}, r.err
}

func (r *fakeSettingRepo) Update(database.Queryer, string, string) error {
	return r.err
}

type translationCallResult struct {
	resp *sdktypes.TranslateResponse
	err  error
}

type translationRuntime struct {
	translateSequence []translationCallResult
	translateCalls    int
	afterTranslate    func(call int)
}

func (r *translationRuntime) Type() sdkmanifest.RuntimeType {
	return sdkmanifest.RuntimeTypeBinary
}

func (r *translationRuntime) Start(context.Context, pluginruntime.Instance) error {
	return nil
}

func (r *translationRuntime) Stop(context.Context, pluginruntime.Instance) error {
	return nil
}

func (r *translationRuntime) Healthcheck(context.Context, pluginruntime.Instance) (*healthcheck.Response, error) {
	return &healthcheck.Response{Status: healthcheck.StatusOK}, nil
}

func (r *translationRuntime) Search(context.Context, pluginruntime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, nil
}

func (r *translationRuntime) Fetch(context.Context, pluginruntime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, nil
}

func (r *translationRuntime) Translate(_ context.Context, _ pluginruntime.Instance, _ *sdktypes.TranslateRequest) (*sdktypes.TranslateResponse, error) {
	r.translateCalls++
	call := r.translateCalls
	if r.afterTranslate != nil {
		defer r.afterTranslate(call)
	}
	if len(r.translateSequence) == 0 {
		return nil, nil
	}
	if call > len(r.translateSequence) {
		call = len(r.translateSequence)
	}
	result := r.translateSequence[call-1]
	return result.resp, result.err
}

func (r *translationRuntime) Detect(context.Context, pluginruntime.Instance, *sdktypes.DetectRequest) (*sdktypes.DetectResponse, error) {
	return nil, nil
}

var _ repository.SettingRepository = (*fakeSettingRepo)(nil)
var _ pluginruntime.Runtime = (*translationRuntime)(nil)
