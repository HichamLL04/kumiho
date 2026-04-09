package service

import (
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func TestSeriesEnrichServiceAssignsDisplayUnitByRootVolumeUnit(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	seriesRepo := repository.NewSeriesRepository()
	chapterRepo := repository.NewChapterRepository()
	volumeRepo := repository.NewVolumeRepository()

	svc := NewSeriesEnrichService(seriesRepo, chapterRepo, volumeRepo)

	if _, err := database.DB.Exec(`INSERT INTO libraries (id, name, type, library_type) VALUES ('library-1', 'Library', 'LOCAL', 'book')`); err != nil {
		t.Fatalf("insert library error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT INTO library_paths (id, library_id, path, sort_order) VALUES ('library-path-1', 'library-1', '/books', 0)`); err != nil {
		t.Fatalf("insert library path error = %v", err)
	}

	series := &model.Series{
		LibraryID: "library-1",
		Title:     "테스트 시리즈",
		Path:      "/books/test-series",
		Metadata:  &model.SeriesMetadata{},
	}
	if err := seriesRepo.Create(nil, series); err != nil {
		t.Fatalf("SeriesRepository.Create() error = %v", err)
	}

	rootVolume := &model.Volume{
		ID:           "root-volume",
		SeriesID:     series.ID,
		Title:        "v01",
		VolumeNumber: 1,
		Path:         "/books/test-series/v01.zip",
		Unit:         "volume",
	}
	if err := volumeRepo.Create(nil, rootVolume); err != nil {
		t.Fatalf("VolumeRepository.Create(rootVolume) error = %v", err)
	}

	svc.EnrichSingle(series, "")

	if series.DisplayUnit != "volume" {
		t.Fatalf("DisplayUnit = %q, want %q", series.DisplayUnit, "volume")
	}

	if err := volumeRepo.Delete(nil, rootVolume.ID); err != nil {
		t.Fatalf("VolumeRepository.Delete(rootVolume) error = %v", err)
	}

	rootChapter := &model.Volume{
		ID:           "root-chapter",
		SeriesID:     series.ID,
		Title:        "c01",
		VolumeNumber: 1,
		Path:         "/books/test-series/c01.zip",
		Unit:         "chapter",
	}
	if err := volumeRepo.Create(nil, rootChapter); err != nil {
		t.Fatalf("VolumeRepository.Create(rootChapter) error = %v", err)
	}

	svc.EnrichSingle(series, "")

	if series.DisplayUnit != "chapter" {
		t.Fatalf("DisplayUnit = %q, want %q", series.DisplayUnit, "chapter")
	}
}
