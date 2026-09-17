package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func TestApplyMetadataTxtToSeries(t *testing.T) {
	s := &Scanner{}

	t.Run("both AniList and MAL IDs present", func(t *testing.T) {
		tempDir := t.TempDir()
		content := `Title: Dandadan
AniList ID: 105398
AniList URL: https://anilist.co/manga/105398
MyAnimeList ID: 121496
MyAnimeList URL: https://myanimelist.net/manga/121496
Updated: 2026-09-17T10:45:00.000Z`
		if err := os.WriteFile(filepath.Join(tempDir, "metadata.txt"), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write metadata.txt: %v", err)
		}

		series := &model.Series{
			Title: "Dandadan",
			Path:  tempDir,
		}

		changed := s.applyMetadataTxtToSeries(series, tempDir)
		if !changed {
			t.Errorf("expected changed=true, got false")
		}
		if series.Metadata == nil {
			t.Fatalf("expected series.Metadata to be non-nil")
		}
		if series.Metadata.AnilistID != "105398" {
			t.Errorf("expected AnilistID 105398, got %s", series.Metadata.AnilistID)
		}
		if series.Metadata.MalID != "121496" {
			t.Errorf("expected MalID 121496, got %s", series.Metadata.MalID)
		}

		// Second run shouldn't change anything
		changedAgain := s.applyMetadataTxtToSeries(series, tempDir)
		if changedAgain {
			t.Errorf("expected changed=false on second run, got true")
		}
	})

	t.Run("only AniList ID present", func(t *testing.T) {
		tempDir := t.TempDir()
		content := `Title: Solo Leveling
AniList ID: 105399`
		if err := os.WriteFile(filepath.Join(tempDir, "metadata.txt"), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write metadata.txt: %v", err)
		}

		series := &model.Series{
			Title: "Solo Leveling",
			Path:  tempDir,
		}

		changed := s.applyMetadataTxtToSeries(series, tempDir)
		if !changed {
			t.Errorf("expected changed=true, got false")
		}
		if series.Metadata.AnilistID != "105399" {
			t.Errorf("expected AnilistID 105399, got %s", series.Metadata.AnilistID)
		}
		if series.Metadata.MalID != "" {
			t.Errorf("expected empty MalID, got %s", series.Metadata.MalID)
		}
	})

	t.Run("only MAL ID present via URL fallback", func(t *testing.T) {
		tempDir := t.TempDir()
		content := `Title: Berserk
MyAnimeList URL: https://myanimelist.net/manga/2`
		if err := os.WriteFile(filepath.Join(tempDir, "METADATA.TXT"), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write METADATA.TXT: %v", err)
		}

		series := &model.Series{
			Title: "Berserk",
			Path:  tempDir,
		}

		changed := s.applyMetadataTxtToSeries(series, tempDir)
		if !changed {
			t.Errorf("expected changed=true, got false")
		}
		if series.Metadata.MalID != "2" {
			t.Errorf("expected MalID 2, got %s", series.Metadata.MalID)
		}
		if series.Metadata.AnilistID != "" {
			t.Errorf("expected empty AnilistID, got %s", series.Metadata.AnilistID)
		}
	})

	t.Run("archive file path passed as seriesPath", func(t *testing.T) {
		tempDir := t.TempDir()
		archivePath := filepath.Join(tempDir, "volume01.cbz")
		if err := os.WriteFile(archivePath, []byte("fake cbz"), 0644); err != nil {
			t.Fatalf("failed to create fake archive: %v", err)
		}
		content := `AniList ID: 99999`
		if err := os.WriteFile(filepath.Join(tempDir, "metadata.txt"), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write metadata.txt: %v", err)
		}

		series := &model.Series{
			Title: "Test",
			Path:  archivePath,
		}

		changed := s.applyMetadataTxtToSeries(series, archivePath)
		if !changed {
			t.Errorf("expected changed=true, got false")
		}
		if series.Metadata.AnilistID != "99999" {
			t.Errorf("expected AnilistID 99999, got %s", series.Metadata.AnilistID)
		}
	})

	t.Run("series_metadata.txt file name supported", func(t *testing.T) {
		tempDir := t.TempDir()
		content := `Title: Jujutsu Kaisen
AniList ID: 101517
MyAnimeList ID: 113138`
		if err := os.WriteFile(filepath.Join(tempDir, "series_metadata.txt"), []byte(content), 0644); err != nil {
			t.Fatalf("failed to write series_metadata.txt: %v", err)
		}

		series := &model.Series{
			Title: "Jujutsu Kaisen",
			Path:  tempDir,
		}

		changed := s.applyMetadataTxtToSeries(series, tempDir)
		if !changed {
			t.Errorf("expected changed=true, got false")
		}
		if series.Metadata.AnilistID != "101517" {
			t.Errorf("expected AnilistID 101517, got %s", series.Metadata.AnilistID)
		}
		if series.Metadata.MalID != "113138" {
			t.Errorf("expected MalID 113138, got %s", series.Metadata.MalID)
		}
	})

	t.Run("metadata files excluded from isArchive", func(t *testing.T) {
		if isArchive("metadata.txt") {
			t.Errorf("expected isArchive(metadata.txt) = false")
		}
		if isArchive("series_metadata.txt") {
			t.Errorf("expected isArchive(series_metadata.txt) = false")
		}
		if isArchive("series_metadata.json") {
			t.Errorf("expected isArchive(series_metadata.json) = false")
		}
		if !isArchive("chapter01.cbz") {
			t.Errorf("expected isArchive(chapter01.cbz) = true")
		}
		if !isArchive("real_book.txt") {
			t.Errorf("expected isArchive(real_book.txt) = true")
		}
	})
}
