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

func TestVolumeCreateUsesDetectionTimeForLastContentUpdatedAt(t *testing.T) {
	connectSeriesRepositoryTestDB(t)

	seriesRepo := NewSeriesRepository()
	series := seedSeriesRepositoryTestSeries(t, seriesRepo)

	oldContentTime := time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second)
	if err := seriesRepo.UpdateUpdatedAt(nil, series.ID, oldContentTime); err != nil {
		t.Fatalf("UpdateUpdatedAt() error = %v", err)
	}

	volumeRepo := NewVolumeRepository()
	oldFileTime := time.Now().Add(-30 * 24 * time.Hour).UTC().Truncate(time.Second)
	volume := &model.Volume{
		SeriesID:     series.ID,
		Title:        "Volume 1",
		VolumeNumber: 1,
		Path:         "/tmp/volume-1.cbz",
		CreatedAt:    oldFileTime,
		UpdatedAt:    oldFileTime,
	}
	beforeCreate := time.Now().Add(-1 * time.Minute)
	if err := volumeRepo.Create(nil, volume); err != nil {
		t.Fatalf("VolumeRepository.Create() error = %v", err)
	}

	refreshed, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("FindByID() error = %v", err)
	}
	if refreshed == nil {
		t.Fatal("refreshed series = nil")
	}
	if refreshed.LastContentUpdatedAt.Before(beforeCreate) {
		t.Fatalf("LastContentUpdatedAt = %v, expected detection time after %v", refreshed.LastContentUpdatedAt, beforeCreate)
	}
	if refreshed.LastContentUpdatedAt.Equal(oldFileTime) {
		t.Fatalf("LastContentUpdatedAt should not reuse old file time %v", oldFileTime)
	}
}

func TestProgressAggregationUsesFixedPageTotalForNormalText(t *testing.T) {
	connectSeriesRepositoryTestDB(t)
	seedProgressAggregationFixture(t, "txt-normal", "txt-volume-normal", "txt-chapter-normal", 100, 100000, 25, 100, 99, "")

	seriesRepo := NewSeriesRepository()
	total, err := seriesRepo.GetTotalProgressUnits(nil, "txt-normal")
	if err != nil {
		t.Fatalf("GetTotalProgressUnits() error = %v", err)
	}
	if total != 100 {
		t.Fatalf("total units = %d, want 100", total)
	}

	read, err := seriesRepo.GetReadProgressUnits(nil, "user-1", "txt-normal")
	if err != nil {
		t.Fatalf("GetReadProgressUnits() error = %v", err)
	}
	if read != 25 {
		t.Fatalf("read units = %d, want 25", read)
	}
}

func TestProgressAggregationUsesPercentForCFIProgress(t *testing.T) {
	connectSeriesRepositoryTestDB(t)
	seedProgressAggregationFixture(t, "txt-epub", "txt-volume-epub", "txt-chapter-epub", 100, 100000, 1, 100, 75, "epubcfi(/6/2!/4/2)")

	seriesRepo := NewSeriesRepository()
	total, err := seriesRepo.GetTotalProgressUnits(nil, "txt-epub")
	if err != nil {
		t.Fatalf("GetTotalProgressUnits() error = %v", err)
	}
	if total != 100 {
		t.Fatalf("total units = %d, want 100", total)
	}

	read, err := seriesRepo.GetReadProgressUnits(nil, "user-1", "txt-epub")
	if err != nil {
		t.Fatalf("GetReadProgressUnits() error = %v", err)
	}
	if read != 75 {
		t.Fatalf("read units = %d, want 75", read)
	}

	volumeRepo := NewVolumeRepository()
	volumePercent, err := volumeRepo.GetProgressPercent(nil, "user-1", "txt-volume-epub")
	if err != nil {
		t.Fatalf("GetProgressPercent() error = %v", err)
	}
	if volumePercent != 75 {
		t.Fatalf("volume percent = %f, want 75", volumePercent)
	}

	batchPercent, err := volumeRepo.GetProgressPercentBatch(nil, "user-1", []string{"txt-volume-epub"})
	if err != nil {
		t.Fatalf("GetProgressPercentBatch() error = %v", err)
	}
	if batchPercent["txt-volume-epub"] != 75 {
		t.Fatalf("batch volume percent = %f, want 75", batchPercent["txt-volume-epub"])
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

func seedProgressAggregationFixture(
	t *testing.T,
	seriesID string,
	volumeID string,
	chapterID string,
	pageCount int,
	totalPositions int,
	currentPage int,
	totalPages int,
	progressPercent float64,
	currentCFI string,
) {
	t.Helper()

	if _, err := database.DB.Exec(`INSERT OR IGNORE INTO libraries (id, name, type, library_type) VALUES ('lib-1', 'Library', 'LOCAL', 'book')`); err != nil {
		t.Fatalf("insert library error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT OR IGNORE INTO users (id, username, nickname, password_hash, role) VALUES ('user-1', 'user-1', 'User', 'hash', 'USER')`); err != nil {
		t.Fatalf("insert user error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT OR IGNORE INTO library_paths (id, library_id, path, sort_order) VALUES ('lib-path-1', 'lib-1', '/library', 0)`); err != nil {
		t.Fatalf("insert library path error = %v", err)
	}
	if _, err := database.DB.Exec(
		`INSERT INTO series (id, library_id, title, path, created_at, updated_at) VALUES (?, 'lib-1', 'Series', '/library/series', datetime('now'), datetime('now'))`,
		seriesID,
	); err != nil {
		t.Fatalf("insert series error = %v", err)
	}
	if _, err := database.DB.Exec(
		`INSERT INTO volumes (id, series_id, title, volume_number, path, unit, chapter_count, extension, created_at, updated_at)
		 VALUES (?, ?, 'Volume', 1, '/library/series/volume.txt', 'chapter', 1, 'TXT', datetime('now'), datetime('now'))`,
		volumeID, seriesID,
	); err != nil {
		t.Fatalf("insert volume error = %v", err)
	}
	if _, err := database.DB.Exec(
		`INSERT INTO chapters (id, volume_id, title, chapter_number, path, page_count, total_positions, created_at, updated_at)
		 VALUES (?, ?, 'Chapter', 1, '/library/series/volume.txt', ?, ?, datetime('now'), datetime('now'))`,
		chapterID, volumeID, pageCount, totalPositions,
	); err != nil {
		t.Fatalf("insert chapter error = %v", err)
	}

	var currentCFIValue any
	if currentCFI != "" {
		currentCFIValue = currentCFI
	}
	if _, err := database.DB.Exec(
		`INSERT INTO reading_progress
		 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, current_position, total_positions, progress_percent, current_cfi, updated_at)
		 VALUES (?, 'user-1', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
		"progress-"+chapterID, seriesID, volumeID, chapterID, currentPage, totalPages, currentPage-1, totalPositions, progressPercent, currentCFIValue,
	); err != nil {
		t.Fatalf("insert progress error = %v", err)
	}
}
