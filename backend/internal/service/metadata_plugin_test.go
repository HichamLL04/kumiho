package service

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/capability"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func TestMetadataServiceSearchSeriesAggregatesCandidates(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	rt := &metadataRuntime{
		searchResp: &sdktypes.SearchResponse{
			Candidates: []sdktypes.SearchCandidate{
				{
					Source:     sdktypes.SourceRef{ID: "src-1", Name: "sample"},
					Title:      "Example Book",
					Score:      0.95,
					Confidence: 0.9,
				},
			},
		},
	}
	manager := newActiveMetadataManager(t, rt)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	result, err := svc.SearchSeries(context.Background(), series.ID, "", MetadataSearchOptions{})
	if err != nil {
		t.Fatalf("SearchSeries() error = %v", err)
	}
	if len(result.Candidates) != 1 {
		t.Fatalf("candidates len = %d, want 1", len(result.Candidates))
	}
	if result.Candidates[0].PluginID != "plugin-sample" {
		t.Fatalf("plugin_id = %q", result.Candidates[0].PluginID)
	}
	if result.Query.LocalTitle == "" {
		t.Fatal("query local title should not be empty")
	}
}

func TestMetadataServiceSearchSeriesPrefersLowerVolumeWhenConfidenceMatches(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	rt := &metadataRuntime{
		searchResp: &sdktypes.SearchResponse{
			Candidates: []sdktypes.SearchCandidate{
				{Source: sdktypes.SourceRef{ID: "src-17", Name: "sample"}, Title: "666 사탄 17", Score: 0.95, Confidence: 0.63},
				{Source: sdktypes.SourceRef{ID: "src-1", Name: "sample"}, Title: "666 사탄 1", Score: 0.95, Confidence: 0.63},
				{Source: sdktypes.SourceRef{ID: "src-3", Name: "sample"}, Title: "666 사탄 3", Score: 0.95, Confidence: 0.63},
			},
		},
	}
	manager := newActiveMetadataManager(t, rt)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	result, err := svc.SearchSeries(context.Background(), series.ID, "", MetadataSearchOptions{})
	if err != nil {
		t.Fatalf("SearchSeries() error = %v", err)
	}

	if len(result.Candidates) != 3 {
		t.Fatalf("candidates len = %d, want 3", len(result.Candidates))
	}
	if result.Candidates[0].Candidate.Title != "666 사탄 1" {
		t.Fatalf("first candidate title = %q", result.Candidates[0].Candidate.Title)
	}
	if result.Candidates[1].Candidate.Title != "666 사탄 3" {
		t.Fatalf("second candidate title = %q", result.Candidates[1].Candidate.Title)
	}
	if result.Candidates[2].Candidate.Title != "666 사탄 17" {
		t.Fatalf("third candidate title = %q", result.Candidates[2].Candidate.Title)
	}
}

func TestMetadataServiceSearchSeriesUsesOverrideTitle(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	rt := &metadataRuntime{
		searchResp: &sdktypes.SearchResponse{
			Candidates: []sdktypes.SearchCandidate{
				{Source: sdktypes.SourceRef{ID: "src-1", Name: "sample"}, Title: "Override Book", Score: 0.95, Confidence: 0.9},
			},
		},
	}
	manager := newActiveMetadataManager(t, rt)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	result, err := svc.SearchSeries(context.Background(), series.ID, "", MetadataSearchOptions{Title: "All you Need Is Kill"})
	if err != nil {
		t.Fatalf("SearchSeries() error = %v", err)
	}
	if result.Query.LocalTitle != "All you Need Is Kill" {
		t.Fatalf("query local title = %q", result.Query.LocalTitle)
	}
	if len(result.Query.Identifiers) != 0 {
		t.Fatalf("query identifiers = %#v, want empty for manual override search", result.Query.Identifiers)
	}
}

func TestMetadataServiceSearchSeriesKeepsProviderOrderForLowConfidenceTies(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	rt := &metadataRuntime{
		searchResp: &sdktypes.SearchResponse{
			Candidates: []sdktypes.SearchCandidate{
				{Source: sdktypes.SourceRef{ID: "src-b", Name: "sample"}, Title: "Zulu Story", Score: 0.92, Confidence: 0.35},
				{Source: sdktypes.SourceRef{ID: "src-a", Name: "sample"}, Title: "Alpha Story", Score: 0.84, Confidence: 0.35},
				{Source: sdktypes.SourceRef{ID: "src-c", Name: "sample"}, Title: "Beta Story", Score: 0.76, Confidence: 0.35},
			},
		},
	}
	manager := newActiveMetadataManager(t, rt)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	result, err := svc.SearchSeries(context.Background(), series.ID, "", MetadataSearchOptions{})
	if err != nil {
		t.Fatalf("SearchSeries() error = %v", err)
	}

	if len(result.Candidates) != 3 {
		t.Fatalf("candidates len = %d, want 3", len(result.Candidates))
	}
	if result.Candidates[0].Candidate.Title != "Zulu Story" {
		t.Fatalf("first candidate title = %q", result.Candidates[0].Candidate.Title)
	}
	if result.Candidates[1].Candidate.Title != "Alpha Story" {
		t.Fatalf("second candidate title = %q", result.Candidates[1].Candidate.Title)
	}
	if result.Candidates[2].Candidate.Title != "Beta Story" {
		t.Fatalf("third candidate title = %q", result.Candidates[2].Candidate.Title)
	}
}

func TestMetadataServiceSearchSeriesDoesNotForceBookContentType(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	rt := &metadataRuntime{
		searchResp: &sdktypes.SearchResponse{
			Candidates: []sdktypes.SearchCandidate{
				{Source: sdktypes.SourceRef{ID: "src-1", Name: "sample"}, Title: "Naruto", Score: 0.95, Confidence: 0.9},
			},
		},
	}
	manager := newActiveMetadataManager(t, rt)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	result, err := svc.SearchSeries(context.Background(), series.ID, "", MetadataSearchOptions{Title: "Naruto"})
	if err != nil {
		t.Fatalf("SearchSeries() error = %v", err)
	}
	if len(result.Candidates) != 1 {
		t.Fatalf("candidates len = %d, want 1", len(result.Candidates))
	}
	if rt.lastSearchReq == nil {
		t.Fatal("runtime should receive search request")
	}
	if rt.lastSearchReq.ContentType != "" {
		t.Fatalf("search content type = %q, want empty", rt.lastSearchReq.ContentType)
	}
}

func TestMetadataServiceFetchSeriesMetadataReturnsPluginNotReadyForInactivePlugin(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	manager := newMetadataManagerWithState(t, &metadataRuntime{}, sdkstate.Registered, []capability.Capability{capability.MetadataSearch, capability.MetadataFetch})
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	_, err := svc.FetchSeriesMetadata(context.Background(), series.ID, "", MetadataFetchSelection{
		PluginID: "plugin-sample",
		Source:   sdktypes.SourceRef{ID: "src-1", Name: "sample"},
	})
	if err == nil {
		t.Fatal("FetchSeriesMetadata() error = nil")
	}

	var pluginErr *pluginerrors.PluginError
	if !errors.As(err, &pluginErr) {
		t.Fatalf("error type = %T, want PluginError", err)
	}
	if pluginErr.Code != pluginerrors.ErrCodePluginNotReady {
		t.Fatalf("code = %q, want %q", pluginErr.Code, pluginerrors.ErrCodePluginNotReady)
	}
}

func TestMetadataServiceFetchSeriesMetadataReturnsUnsupportedForMissingFetchCapability(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	manager := newMetadataManagerWithState(t, &metadataRuntime{}, sdkstate.Active, []capability.Capability{capability.MetadataSearch})
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	_, err := svc.FetchSeriesMetadata(context.Background(), series.ID, "", MetadataFetchSelection{
		PluginID: "plugin-sample",
		Source:   sdktypes.SourceRef{ID: "src-1", Name: "sample"},
	})
	if err == nil {
		t.Fatal("FetchSeriesMetadata() error = nil")
	}

	var pluginErr *pluginerrors.PluginError
	if !errors.As(err, &pluginErr) {
		t.Fatalf("error type = %T, want PluginError", err)
	}
	if pluginErr.Code != pluginerrors.ErrCodeUnsupported {
		t.Fatalf("code = %q, want %q", pluginErr.Code, pluginerrors.ErrCodeUnsupported)
	}
}

func TestMetadataServiceApplySeriesMetadataUpdatesDatabase(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	result, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Title:           "Applied Title",
		Description:     "<p>Applied Description</p><p>Extra line</p>",
		Authors:         []string{"Author One", "Author Two"},
		Tags:            []string{"Computers / Programming / Algorithms", "Computers / Internet / General"},
		PublicationDate: "2024-09-01",
		Publisher:       "Kumiho Press",
		Identifiers: map[string]string{
			"isbn13": "9781234567890",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}
	if len(result.UpdatedFields) == 0 {
		t.Fatal("updated_fields should not be empty")
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil {
		t.Fatal("updated series = nil")
	}
	if updated.Title != "Example Series" {
		t.Fatalf("Title = %q", updated.Title)
	}
	if updated.Description != "Applied Description\n\nExtra line" {
		t.Fatalf("Description = %q", updated.Description)
	}
	if updated.Metadata == nil {
		t.Fatal("Metadata = nil")
	}
	if updated.Metadata.Authors != "Author One, Author Two" {
		t.Fatalf("Authors = %q", updated.Metadata.Authors)
	}
	if updated.Metadata.OriginalTitle != "Applied Title" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}
	if updated.Metadata.Tags != "Computers, Programming, Algorithms, Internet, General" {
		t.Fatalf("Tags = %q", updated.Metadata.Tags)
	}
	if updated.Metadata.PublicationYear != "2024" {
		t.Fatalf("PublicationYear = %q", updated.Metadata.PublicationYear)
	}
	if updated.Metadata.ISBN != "9781234567890" {
		t.Fatalf("ISBN = %q", updated.Metadata.ISBN)
	}
}

func TestMetadataServiceApplySeriesMetadataStoresFetchedTitleAsOriginalTitle(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Title: "Example Series",
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	if updated.Metadata.OriginalTitle != "Example Series" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}
}

func TestMetadataServiceApplySeriesMetadataStoresOriginalTitlesMap(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Title:         "강철의 연금술사",
		OriginalTitle: "Fullmetal Alchemist",
		OriginalTitles: map[string]string{
			"ko": "강철의 연금술사",
			"en": "Fullmetal Alchemist",
			"ja": "鋼の錬金術師",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	if updated.Metadata.OriginalTitle != "강철의 연금술사" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}

	var originalTitles map[string]string
	if err := json.Unmarshal([]byte(updated.Metadata.OriginalTitles), &originalTitles); err != nil {
		t.Fatalf("Unmarshal(OriginalTitles) error = %v", err)
	}
	if originalTitles["ko"] != "강철의 연금술사" || originalTitles["en"] != "Fullmetal Alchemist" || originalTitles["ja"] != "鋼の錬金術師" {
		t.Fatalf("OriginalTitles = %#v", originalTitles)
	}
}

func TestMetadataServiceApplySeriesMetadataPreservesManualOriginalTitle(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	series.Metadata = &model.SeriesMetadata{
		SeriesID:       series.ID,
		OriginalTitle:  "사용자 지정 원제",
		OriginalTitles: `{"ko":"예전 제목","en":"Old Title"}`,
	}
	if err := seriesRepo.Update(nil, series); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		OriginalTitle: "Fetched Title",
		OriginalTitles: map[string]string{
			"ko": "새 한국어 제목",
			"en": "New English Title",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	if updated.Metadata.OriginalTitle != "사용자 지정 원제" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}
	var originalTitles map[string]string
	if err := json.Unmarshal([]byte(updated.Metadata.OriginalTitles), &originalTitles); err != nil {
		t.Fatalf("Unmarshal(OriginalTitles) error = %v", err)
	}
	if originalTitles["_manual_title"] != "사용자 지정 원제" {
		t.Fatalf("manual title marker = %q", originalTitles["_manual_title"])
	}
}

func TestMetadataServiceApplySeriesMetadataKeepsExistingOriginalTitlesWhenFetchedMapIsEmpty(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	series.Metadata = &model.SeriesMetadata{
		SeriesID:       series.ID,
		OriginalTitle:  "사용자 지정 원제",
		OriginalTitles: `{"ko":"예전 제목","en":"Old Title","_manual_title":"사용자 지정 원제"}`,
	}
	if err := seriesRepo.Update(nil, series); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		OriginalTitle: "Fetched Title",
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	var originalTitles map[string]string
	if err := json.Unmarshal([]byte(updated.Metadata.OriginalTitles), &originalTitles); err != nil {
		t.Fatalf("Unmarshal(OriginalTitles) error = %v", err)
	}
	if originalTitles["ko"] != "예전 제목" || originalTitles["en"] != "Old Title" || originalTitles["_manual_title"] != "사용자 지정 원제" {
		t.Fatalf("OriginalTitles = %#v", originalTitles)
	}
}

func TestMetadataServiceApplySeriesMetadataUpdatesAutoResolvedOriginalTitleWhenFetchedMapChanges(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	series.Metadata = &model.SeriesMetadata{
		SeriesID:       series.ID,
		OriginalTitle:  "Old English Title",
		OriginalTitles: `{"ko":"예전 한국어 제목","en":"Old English Title"}`,
	}
	if err := seriesRepo.Update(nil, series); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		OriginalTitles: map[string]string{
			"ko": "새 한국어 제목",
			"en": "New English Title",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	if updated.Metadata.OriginalTitle != "새 한국어 제목" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}
}

func TestMetadataServiceApplySeriesMetadataUsesLocaleAndLibraryOverride(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	if _, err := database.DB.Exec(`UPDATE libraries SET original_title_override = 1 WHERE id = ?`, series.LibraryID); err != nil {
		t.Fatalf("update library original_title_override error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT INTO server_settings (key, value, updated_at) VALUES ('original_title_locale', 'ja', CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`); err != nil {
		t.Fatalf("insert setting error = %v", err)
	}
	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	applied, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Title:         "Localized Title",
		OriginalTitle: "Fallback Title",
		OriginalTitles: map[string]string{
			"ko": "강철의 연금술사",
			"ja": "鋼の錬金術師",
			"en": "Fullmetal Alchemist",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	if updated.Metadata.OriginalTitle != "鋼の錬金術師" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}
	if updated.Title != "Example Series" {
		t.Fatalf("Title = %q", updated.Title)
	}
	if applied == nil || applied.Series == nil {
		t.Fatal("applied series should not be nil")
	}
	if applied.Series.DisplayTitle != "鋼の錬金術師" {
		t.Fatalf("DisplayTitle = %q", applied.Series.DisplayTitle)
	}
}

func TestMetadataServiceApplySeriesMetadataKeepsManualOriginalTitleForLibraryOverride(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	series.Metadata = &model.SeriesMetadata{
		SeriesID:       series.ID,
		OriginalTitle:  "사용자 지정 원제",
		OriginalTitles: `{"ko":"예전 제목","en":"Old Title","ja":"古いタイトル"}`,
	}
	if err := seriesRepo.Update(nil, series); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if _, err := database.DB.Exec(`UPDATE libraries SET original_title_override = 1 WHERE id = ?`, series.LibraryID); err != nil {
		t.Fatalf("update library original_title_override error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT INTO server_settings (key, value, updated_at) VALUES ('original_title_locale', 'ja', CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`); err != nil {
		t.Fatalf("insert setting error = %v", err)
	}

	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))
	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		OriginalTitle: "Fetched Title",
		OriginalTitles: map[string]string{
			"ko": "새 한국어 제목",
			"en": "New English Title",
			"ja": "新しい日本語タイトル",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if updated == nil || updated.Metadata == nil {
		t.Fatal("updated metadata should not be nil")
	}
	if updated.Metadata.OriginalTitle != "사용자 지정 원제" {
		t.Fatalf("OriginalTitle = %q", updated.Metadata.OriginalTitle)
	}
	if updated.Title != "Example Series" {
		t.Fatalf("Title = %q", updated.Title)
	}
}

func TestMetadataServiceApplySeriesMetadataDownloadsThumbnail(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	imageBytes := []byte{0x89, 0x50, 0x4e, 0x47}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(imageBytes)
	}))
	defer server.Close()

	cfg := (&configForMetadataTests{DataDir: t.TempDir()}).Config()
	svc := newMetadataServiceForTests(t, cfg, server.Client(), seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	result, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Cover: &sdktypes.CoverInfo{
			URL: server.URL + "/cover.png",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}

	if result.Series == nil || result.Series.ThumbnailPath == nil {
		t.Fatal("ThumbnailPath should be set")
	}
	if _, err := os.Stat(*result.Series.ThumbnailPath); err != nil {
		t.Fatalf("thumbnail file stat error = %v", err)
	}
	if result.Series.ThumbnailURL == nil || *result.Series.ThumbnailURL == "" {
		t.Fatal("ThumbnailURL should be set")
	}
	found := false
	for _, field := range result.UpdatedFields {
		if field == "thumbnail" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("UpdatedFields = %v, want thumbnail included", result.UpdatedFields)
	}
}

func TestMetadataServiceApplySeriesMetadataRemovesPartialThumbnailOnWriteFailure(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	cfg := (&configForMetadataTests{DataDir: t.TempDir()}).Config()
	client := &http.Client{
		Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"image/png"}},
				Body:       &failingReadCloser{err: errors.New("read failed")},
			}, nil
		}),
	}
	svc := newMetadataServiceForTests(t, cfg, client, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	_, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Cover: &sdktypes.CoverInfo{URL: "http://example.com/cover.png"},
	})
	if err == nil {
		t.Fatal("ApplySeriesMetadata() error = nil")
	}

	hash := md5.Sum([]byte(series.Path))
	thumbnailPath := filepath.Join(cfg.DataDir, "thumbnails", "series", hex.EncodeToString(hash[:])+".png")
	if _, statErr := os.Stat(thumbnailPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("thumbnail stat error = %v, want not exist", statErr)
	}
}

func TestMetadataServiceApplySeriesMetadataReplacesExistingThumbnail(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	existingThumb := filepath.Join(t.TempDir(), "existing-thumb.png")
	if err := os.WriteFile(existingThumb, []byte{0x89, 0x50, 0x4e, 0x47}, 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	series.ThumbnailPath = &existingThumb
	existingURL := "/api/v1/series/" + series.ID + "/thumbnail"
	series.ThumbnailURL = &existingURL
	series.UpdatedAt = time.Now()
	if err := seriesRepo.Update(nil, series); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	serverHit := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverHit = true
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte{0x89, 0x50, 0x4e, 0x47})
	}))
	defer server.Close()

	cfg := (&configForMetadataTests{DataDir: t.TempDir()}).Config()
	svc := newMetadataServiceForTests(t, cfg, server.Client(), seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	result, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Cover: &sdktypes.CoverInfo{
			URL: server.URL + "/cover.png",
		},
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}
	if !serverHit {
		t.Fatal("cover should be downloaded when metadata is applied again")
	}
	if result.Series == nil || result.Series.ThumbnailPath == nil {
		t.Fatal("ThumbnailPath should remain set")
	}
	if *result.Series.ThumbnailPath == existingThumb {
		t.Fatalf("ThumbnailPath = %q, expected a replaced thumbnail path", *result.Series.ThumbnailPath)
	}
	if _, err := os.Stat(*result.Series.ThumbnailPath); err != nil {
		t.Fatalf("replaced thumbnail file stat error = %v", err)
	}
	found := false
	for _, field := range result.UpdatedFields {
		if field == "thumbnail" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("UpdatedFields = %v, want thumbnail included", result.UpdatedFields)
	}
}

func TestMetadataServiceApplySeriesMetadataReturnsFallbackThumbnailURL(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)

	if _, err := database.DB.Exec(`INSERT INTO volumes (id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, created_at, updated_at)
		VALUES ('vol-1', ?, 'Volume 1', 1, '/library/volume-1.cbz', ?, 0, 'volume', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		series.ID, "/tmp/volume-thumb.png"); err != nil {
		t.Fatalf("insert volume error = %v", err)
	}

	svc := newMetadataServiceForTests(t, (&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

	result, err := svc.ApplySeriesMetadata(context.Background(), series.ID, "", &sdktypes.MetadataResult{
		Title: "Applied Title",
	})
	if err != nil {
		t.Fatalf("ApplySeriesMetadata() error = %v", err)
	}
	if result.Series == nil || result.Series.ThumbnailURL == nil || *result.Series.ThumbnailURL == "" {
		t.Fatal("ThumbnailURL should be enriched on apply response")
	}
}

type configForMetadataTests struct {
	DataDir string
}

func (c *configForMetadataTests) Config() *config.Config {
	return &config.Config{
		DataDir:   c.DataDir,
		PluginDir: filepath.Join(c.DataDir, "plugins"),
	}
}

func connectMetadataTestDB(t *testing.T) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
		database.DB = nil
	})
}

func seedMetadataSeries(t *testing.T, seriesRepo *repository.SeriesRepository) *model.Series {
	t.Helper()

	if _, err := database.DB.Exec(`INSERT INTO libraries (id, name, type, library_type) VALUES ('lib-1', 'Library', 'LOCAL', 'book')`); err != nil {
		t.Fatalf("insert library error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT INTO library_paths (id, library_id, path, sort_order) VALUES ('lib-path-1', 'lib-1', '/library', 0)`); err != nil {
		t.Fatalf("insert library path error = %v", err)
	}

	series := &model.Series{
		LibraryID: "lib-1",
		Title:     "Example Series",
		Path:      "/library/example-series.epub",
		Metadata:  &model.SeriesMetadata{},
	}
	if err := seriesRepo.Create(nil, series); err != nil {
		t.Fatalf("SeriesRepository.Create() error = %v", err)
	}
	return series
}

func newMetadataServiceForTests(
	t *testing.T,
	cfg *config.Config,
	client *http.Client,
	seriesRepo *repository.SeriesRepository,
	manager *pluginengine.Manager,
) *MetadataService {
	t.Helper()
	return NewMetadataService(
		cfg,
		client,
		seriesRepo,
		repository.NewLibraryRepository(),
		repository.NewSettingRepository(),
		manager,
	)
}

func newActiveMetadataManager(t *testing.T, rt *metadataRuntime) *pluginengine.Manager {
	t.Helper()

	return newMetadataManagerWithState(t, rt, sdkstate.Active, []capability.Capability{capability.MetadataSearch, capability.MetadataFetch})
}

func newMetadataManagerWithState(t *testing.T, rt *metadataRuntime, state sdkstate.State, capabilities []capability.Capability) *pluginengine.Manager {
	t.Helper()

	manager := pluginengine.NewManager(pluginengine.NewMemoryStore(), rt)
	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:           "plugin-sample",
		Name:         "Sample Plugin",
		RuntimeType:  sdkmanifest.RuntimeTypeBinary,
		Capabilities: capabilities,
	}, "/plugins/sample")
	if err != nil {
		t.Fatalf("RegisterInstalled() error = %v", err)
	}
	switch state {
	case sdkstate.Installed:
	case sdkstate.Registered:
		if _, err := manager.MarkRegistered(record.ID); err != nil {
			t.Fatalf("MarkRegistered() error = %v", err)
		}
	case sdkstate.Active:
		if _, err := manager.MarkRegistered(record.ID); err != nil {
			t.Fatalf("MarkRegistered() error = %v", err)
		}
		if _, err := manager.Activate(context.Background(), record.ID); err != nil {
			t.Fatalf("Activate() error = %v", err)
		}
	default:
		t.Fatalf("unsupported manager state for test helper: %q", state)
	}
	return manager
}

type metadataRuntime struct {
	searchResp    *sdktypes.SearchResponse
	fetchResp     *sdktypes.FetchResponse
	lastSearchReq *sdktypes.SearchRequest
}

func (r *metadataRuntime) Type() sdkmanifest.RuntimeType {
	return sdkmanifest.RuntimeTypeBinary
}

func (r *metadataRuntime) Start(context.Context, pluginruntime.Instance) error {
	return nil
}

func (r *metadataRuntime) Stop(context.Context, pluginruntime.Instance) error {
	return nil
}

func (r *metadataRuntime) Healthcheck(context.Context, pluginruntime.Instance) (*healthcheck.Response, error) {
	return &healthcheck.Response{Status: healthcheck.StatusOK}, nil
}

func (r *metadataRuntime) Search(_ context.Context, _ pluginruntime.Instance, req *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	if req != nil {
		reqCopy := *req
		r.lastSearchReq = &reqCopy
	}
	return r.searchResp, nil
}

func (r *metadataRuntime) Fetch(context.Context, pluginruntime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return r.fetchResp, nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

type failingReadCloser struct {
	read bool
	err  error
}

func (r *failingReadCloser) Read(p []byte) (int, error) {
	if !r.read {
		r.read = true
		if len(p) > 0 {
			p[0] = 0x89
			return 1, nil
		}
	}
	return 0, r.err
}

func (r *failingReadCloser) Close() error {
	return nil
}
