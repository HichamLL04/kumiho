package handler

import (
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func TestSortMetadataCharactersPrioritizesMainRole(t *testing.T) {
	items := []sdktypes.MetadataCharacter{
		{Name: "Cho U", Role: "supporting"},
		{Name: "Friend", Role: "main"},
		{Name: "Fukubei Hattori", Role: "supporting"},
		{Name: "Alice", Role: " Main "},
	}

	sortMetadataCharacters(items)

	got := []string{items[0].Name, items[1].Name, items[2].Name, items[3].Name}
	want := []string{"Alice", "Friend", "Cho U", "Fukubei Hattori"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sorted names = %#v, want %#v", got, want)
		}
	}
}

func TestSortSeriesCharactersForMetadataPrioritizesMainRole(t *testing.T) {
	base := time.Date(2026, 4, 2, 10, 0, 0, 0, time.UTC)
	items := []model.SeriesCharacter{
		{ID: "1", Name: "Cho U", Role: "supporting", CreatedAt: base.Add(3 * time.Minute)},
		{ID: "2", Name: "Friend", Role: "main", CreatedAt: base.Add(2 * time.Minute)},
		{ID: "3", Name: "Fukubei Hattori", Role: "supporting", CreatedAt: base.Add(4 * time.Minute)},
		{ID: "4", Name: "Alice", Role: " Main ", CreatedAt: base.Add(1 * time.Minute)},
	}

	sortSeriesCharactersForMetadata(items)

	got := []string{items[0].Name, items[1].Name, items[2].Name, items[3].Name}
	want := []string{"Alice", "Friend", "Cho U", "Fukubei Hattori"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sorted names = %#v, want %#v", got, want)
		}
	}
}

func TestShouldRetainImportedCharacterUsesProviderIdentifiers(t *testing.T) {
	item := model.SeriesCharacter{
		Name:              "Old Name",
		SourceProvider:    "kumiho-plugin-metadata-kitsu",
		SourceCharacterID: "char-1",
		SourceRelationID:  "rel-1",
	}

	if !shouldRetainImportedCharacter(item, map[string]struct{}{
		"kumiho-plugin-metadata-kitsu:relation:rel-1": {},
	}) {
		t.Fatal("expected imported character to be retained when relation id matches")
	}

	if shouldRetainImportedCharacter(item, map[string]struct{}{
		"kumiho-plugin-metadata-kitsu:relation:rel-2": {},
	}) {
		t.Fatal("expected imported character to be removed when identifiers are absent")
	}
}

func TestStaleImportedCharactersForSyncRemovesOnlyMatchingProviderCharacters(t *testing.T) {
	existing := []model.SeriesCharacter{
		{ID: "imported-1", SourceProvider: "kumiho-plugin-metadata-kitsu", SourceCharacterID: "char-1"},
		{ID: "imported-2", SourceProvider: "kumiho-plugin-metadata-kitsu", SourceRelationID: "rel-1"},
		{ID: "manual-1", SourceProvider: ""},
		{ID: "other-1", SourceProvider: "other-provider", SourceCharacterID: "char-9"},
	}

	stale := staleImportedCharactersForSync(existing, "kumiho-plugin-metadata-kitsu", map[string]struct{}{}, map[string]struct{}{})
	if len(stale) != 2 {
		t.Fatalf("stale count = %d, want 2", len(stale))
	}

	got := map[string]struct{}{}
	for _, item := range stale {
		got[item.ID] = struct{}{}
	}
	if _, ok := got["imported-1"]; !ok {
		t.Fatal("expected imported-1 to be stale")
	}
	if _, ok := got["imported-2"]; !ok {
		t.Fatal("expected imported-2 to be stale")
	}
	if _, ok := got["manual-1"]; ok {
		t.Fatal("manual character should not be stale")
	}
	if _, ok := got["other-1"]; ok {
		t.Fatal("other provider character should not be stale")
	}
}

func TestIsAllowedCharacterImageContentType(t *testing.T) {
	for _, contentType := range []string{"image/jpeg", "image/png", "image/gif", "image/webp"} {
		if !isAllowedCharacterImageContentType(contentType) {
			t.Fatalf("contentType %q should be allowed", contentType)
		}
	}

	for _, contentType := range []string{"image/svg+xml", "text/plain", "", " application/pdf "} {
		if isAllowedCharacterImageContentType(contentType) {
			t.Fatalf("contentType %q should be rejected", contentType)
		}
	}
}
