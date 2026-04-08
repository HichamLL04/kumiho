package repository

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func TestSeriesRepositoryUpdatePreservingUpdatedAtKeepsDatabaseTimestamp(t *testing.T) {
	connectSeriesRepositoryTestDB(t)

	repo := NewSeriesRepository()
	series := seedSeriesRepositoryTestSeries(t, repo)

	newerUpdatedAt := series.UpdatedAt.Add(2 * time.Hour).UTC().Truncate(time.Second)
	if err := repo.UpdateUpdatedAt(nil, series.ID, newerUpdatedAt); err != nil {
		t.Fatalf("UpdateUpdatedAt() error = %v", err)
	}

	series.Description = "Updated description"
	series.Metadata.Description = "Updated description"
	series.Metadata.Authors = "Author One"
	series.UpdatedAt = series.UpdatedAt.Add(-2 * time.Hour)

	if err := repo.UpdatePreservingUpdatedAt(nil, series); err != nil {
		t.Fatalf("UpdatePreservingUpdatedAt() error = %v", err)
	}

	refreshed, err := repo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if refreshed == nil {
		t.Fatal("refreshed series = nil")
	}
	if !refreshed.UpdatedAt.Equal(newerUpdatedAt) {
		t.Fatalf("UpdatedAt = %v, want %v", refreshed.UpdatedAt, newerUpdatedAt)
	}
	if refreshed.Description != "Updated description" {
		t.Fatalf("Description = %q", refreshed.Description)
	}
	if refreshed.Metadata == nil {
		t.Fatal("Metadata = nil")
	}
	if refreshed.Metadata.Authors != "Author One" {
		t.Fatalf("Authors = %q", refreshed.Metadata.Authors)
	}
}

func connectSeriesRepositoryTestDB(t *testing.T) {
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

func seedSeriesRepositoryTestSeries(t *testing.T, repo *SeriesRepository) *model.Series {
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
	if err := repo.Create(nil, series); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	return series
}
