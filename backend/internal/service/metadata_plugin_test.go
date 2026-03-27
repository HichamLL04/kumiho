package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/capability"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
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
					Source:     sdktypes.SourceRef{ID: "gb-1", Name: "googlebooks"},
					Title:      "Example Book",
					Score:      0.95,
					Confidence: 0.9,
				},
			},
		},
	}
	manager := newActiveMetadataManager(t, rt)
	svc := NewMetadataService((&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, manager)

	result, err := svc.SearchSeries(context.Background(), series.ID, "")
	if err != nil {
		t.Fatalf("SearchSeries() error = %v", err)
	}
	if len(result.Candidates) != 1 {
		t.Fatalf("candidates len = %d, want 1", len(result.Candidates))
	}
	if result.Candidates[0].PluginID != "plugin-googlebooks" {
		t.Fatalf("plugin_id = %q", result.Candidates[0].PluginID)
	}
	if result.Query.LocalTitle == "" {
		t.Fatal("query local title should not be empty")
	}
}

func TestMetadataServiceApplySeriesMetadataUpdatesDatabase(t *testing.T) {
	connectMetadataTestDB(t)
	seriesRepo := repository.NewSeriesRepository()
	series := seedMetadataSeries(t, seriesRepo)
	svc := NewMetadataService((&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

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
	svc := NewMetadataService((&configForMetadataTests{DataDir: t.TempDir()}).Config(), nil, seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

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
	svc := NewMetadataService(cfg, server.Client(), seriesRepo, pluginengine.NewManager(pluginengine.NewMemoryStore()))

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

func newActiveMetadataManager(t *testing.T, rt *metadataRuntime) *pluginengine.Manager {
	t.Helper()

	manager := pluginengine.NewManager(pluginengine.NewMemoryStore(), rt)
	record, err := manager.RegisterInstalled(sdkmanifest.Manifest{
		ID:           "plugin-googlebooks",
		Name:         "Google Books",
		RuntimeType:  sdkmanifest.RuntimeTypeBinary,
		Capabilities: []capability.Capability{capability.MetadataSearch, capability.MetadataFetch},
	}, "/plugins/googlebooks")
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

type metadataRuntime struct {
	searchResp *sdktypes.SearchResponse
	fetchResp  *sdktypes.FetchResponse
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

func (r *metadataRuntime) Search(context.Context, pluginruntime.Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return r.searchResp, nil
}

func (r *metadataRuntime) Fetch(context.Context, pluginruntime.Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return r.fetchResp, nil
}
