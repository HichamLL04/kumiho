package repository

import (
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func TestSeriesCharacterRepositoryReorderRollsBackOnFailure(t *testing.T) {
	connectSeriesCharacterTestDB(t)
	seriesID := seedSeriesCharacterTestSeries(t)
	repo := NewSeriesCharacterRepository()

	first := seedSeriesCharacter(t, repo, seriesID, "char-1", "Alpha", 10)
	second := seedSeriesCharacter(t, repo, seriesID, "char-2", "Beta", 20)

	if _, err := database.DB.Exec(`
		CREATE TRIGGER series_characters_reorder_fail
		BEFORE UPDATE ON series_characters
		FOR EACH ROW
		WHEN NEW.id = 'char-2'
		BEGIN
			SELECT RAISE(FAIL, 'reorder failed');
		END;
	`); err != nil {
		t.Fatalf("create trigger error = %v", err)
	}

	err := repo.Reorder(nil, seriesID, []string{first.ID, second.ID})
	if err == nil {
		t.Fatal("Reorder() error = nil")
	}

	items, err := repo.ListBySeriesID(nil, seriesID)
	if err != nil {
		t.Fatalf("ListBySeriesID() error = %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("items len = %d, want 2", len(items))
	}
	for _, item := range items {
		switch item.ID {
		case first.ID:
			if item.SortOrder != 10 {
				t.Fatalf("first sort_order = %d, want 10", item.SortOrder)
			}
		case second.ID:
			if item.SortOrder != 20 {
				t.Fatalf("second sort_order = %d, want 20", item.SortOrder)
			}
		}
	}
}

func connectSeriesCharacterTestDB(t *testing.T) {
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

func seedSeriesCharacterTestSeries(t *testing.T) string {
	t.Helper()

	if _, err := database.DB.Exec(`INSERT INTO libraries (id, name, type, library_type) VALUES ('lib-1', 'Library', 'LOCAL', 'book')`); err != nil {
		t.Fatalf("insert library error = %v", err)
	}
	if _, err := database.DB.Exec(`INSERT INTO library_paths (id, library_id, path, sort_order) VALUES ('lib-path-1', 'lib-1', '/library', 0)`); err != nil {
		t.Fatalf("insert library path error = %v", err)
	}

	seriesRepo := NewSeriesRepository()
	series := &model.Series{
		LibraryID: "lib-1",
		Title:     "Example Series",
		Path:      "/library/example-series.epub",
		Metadata:  &model.SeriesMetadata{},
	}
	if err := seriesRepo.Create(nil, series); err != nil {
		t.Fatalf("SeriesRepository.Create() error = %v", err)
	}
	return series.ID
}

func seedSeriesCharacter(t *testing.T, repo *SeriesCharacterRepository, seriesID string, id string, name string, sortOrder int) *model.SeriesCharacter {
	t.Helper()

	item := &model.SeriesCharacter{
		ID:        id,
		SeriesID:  seriesID,
		Name:      name,
		SortOrder: sortOrder,
	}
	if err := repo.Create(nil, item); err != nil {
		t.Fatalf("SeriesCharacterRepository.Create() error = %v", err)
	}
	return item
}
