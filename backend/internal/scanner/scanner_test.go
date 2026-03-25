package scanner

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/fsnotify/fsnotify"
)

var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
	0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
	0x44, 0xae, 0x42, 0x60, 0x82,
}

func TestScanLibraryBumpsSeriesUpdatedAtWhenNewChapterIsAdded(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "library")
	seriesPath := filepath.Join(libraryPath, "테스트 시리즈")

	if err := writeTestChapter(seriesPath, "1화"); err != nil {
		t.Fatalf("writeTestChapter(1화) error = %v", err)
	}

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()
	chapterRepo := repository.NewChapterRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		repository.NewVolumeRepository(),
		chapterRepo,
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatalf("ScanLibrary() initial error = %v", err)
	}

	seriesList, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() error = %v", err)
	}
	if len(seriesList) != 1 {
		t.Fatalf("len(seriesList) = %d, want 1", len(seriesList))
	}

	staleUpdatedAt := time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second)
	err = seriesRepo.UpdateUpdatedAt(nil, seriesList[0].ID, staleUpdatedAt)
	if err != nil {
		t.Fatalf("SeriesRepository.UpdateUpdatedAt() error = %v", err)
	}

	err = writeTestChapter(seriesPath, "2화")
	if err != nil {
		t.Fatalf("writeTestChapter(2화) error = %v", err)
	}
	err = os.Chtimes(seriesPath, staleUpdatedAt, staleUpdatedAt)
	if err != nil {
		t.Fatalf("os.Chtimes(seriesPath) error = %v", err)
	}

	_, err = s.ScanLibrary(context.Background(), library)
	if err != nil {
		t.Fatalf("ScanLibrary() rescan error = %v", err)
	}

	updatedSeries, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() after rescan error = %v", err)
	}
	if len(updatedSeries) != 1 {
		t.Fatalf("len(updatedSeries) = %d, want 1", len(updatedSeries))
	}
	if !updatedSeries[0].UpdatedAt.After(staleUpdatedAt) {
		t.Fatalf("UpdatedAt = %v, want after %v", updatedSeries[0].UpdatedAt, staleUpdatedAt)
	}

	chapterCount, err := chapterRepo.CountBySeriesID(nil, updatedSeries[0].ID)
	if err != nil {
		t.Fatalf("ChapterRepository.CountBySeriesID() error = %v", err)
	}
	if chapterCount != 2 {
		t.Fatalf("chapterCount = %d, want 2", chapterCount)
	}
}

func TestHasScannedVolumeContentChangeTreatsSentinelPageCountAsUnchanged(t *testing.T) {
	s := &Scanner{}

	existingVol := &model.Volume{ID: "volume-1", VolumeNumber: 1, Unit: "volume", HasAudio: false}
	volData := &scannedVolume{
		VolumeNumber: 1,
		Unit:         "volume",
		HasAudio:     false,
		Chapters: []scannedChapter{
			{
				Title:         "챕터 1",
				ChapterNumber: 1,
				Path:          "/library/series/chapter-1",
				PageCount:     0,
				Pages:         nil,
				HasAudio:      false,
			},
		},
	}

	changed, err := s.hasScannedVolumeContentChange(
		volData,
		existingVol,
		map[string][]*model.Volume{},
		map[string][]model.Chapter{
			"volume-1": {
				{
					VolumeID:      "volume-1",
					Title:         "챕터 1",
					ChapterNumber: 1,
					Path:          "/library/series/chapter-1",
					PageCount:     -1,
					HasAudio:      false,
				},
			},
		},
		map[string]bool{
			"volume-1": true,
		},
	)
	if err != nil {
		t.Fatalf("hasScannedVolumeContentChange() error = %v", err)
	}

	if changed {
		t.Fatal("hasScannedVolumeContentChange() = true, want false")
	}
}

func TestRemoveLibraryWatchKeepsNestedLibraryWatches(t *testing.T) {
	baseDir := t.TempDir()
	rootPath := filepath.Join(baseDir, "data")
	nestedPath := filepath.Join(rootPath, "other")
	nestedChildPath := filepath.Join(nestedPath, "child")

	if err := os.MkdirAll(nestedChildPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatalf("fsnotify.NewWatcher() error = %v", err)
	}
	defer func() { _ = watcher.Close() }()

	s := &Scanner{
		watcher:   watcher,
		watchRefs: make(map[string]int),
	}

	if err := s.AddLibraryWatch("root-lib", rootPath); err != nil {
		t.Fatalf("AddLibraryWatch(root) error = %v", err)
	}
	if err := s.AddLibraryWatch("nested-lib", nestedPath); err != nil {
		t.Fatalf("AddLibraryWatch(nested) error = %v", err)
	}

	s.RemoveLibraryWatch("root-lib")

	watchList := watcher.WatchList()
	if !slices.Contains(watchList, nestedPath) {
		t.Fatalf("watch list missing nested root %q after removing parent: %v", nestedPath, watchList)
	}
	if !slices.Contains(watchList, nestedChildPath) {
		t.Fatalf("watch list missing nested child %q after removing parent: %v", nestedChildPath, watchList)
	}
	if slices.Contains(watchList, rootPath) {
		t.Fatalf("watch list still contains removed root %q: %v", rootPath, watchList)
	}
}

func writeTestChapter(seriesPath, chapterName string) error {
	chapterPath := filepath.Join(seriesPath, chapterName)
	if err := os.MkdirAll(chapterPath, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(chapterPath, "001.png"), tinyPNG, 0o644)
}
