package plugin

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
)

func openSQLStoreTestDB(t *testing.T) {
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

func TestSQLStoreSaveUpdatesTimestampAndPreservesCreatedAt(t *testing.T) {
	openSQLStoreTestDB(t)

	store := NewSQLStore()
	createdAt := time.Now().Add(-2 * time.Hour).UTC().Truncate(time.Second)

	record := Record{
		ID: "plugin-a",
		Manifest: sdkmanifest.Manifest{
			ID:          "plugin-a",
			Name:        "Plugin A",
			Version:     "0.1.0",
			RuntimeType: sdkmanifest.RuntimeTypeBinary,
		},
		State:       sdkstate.Installed,
		InstallPath: "/plugins/plugin-a",
		CreatedAt:   createdAt,
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	saved, ok, err := store.Get(record.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !ok {
		t.Fatal("Get() ok = false")
	}
	if !saved.CreatedAt.Equal(createdAt) {
		t.Fatalf("CreatedAt = %v, want %v", saved.CreatedAt, createdAt)
	}

	firstUpdatedAt := saved.UpdatedAt
	time.Sleep(20 * time.Millisecond)

	saved.State = sdkstate.Active
	saved.LastError = "transient"
	saveErr := store.Save(saved)
	if saveErr != nil {
		t.Fatalf("second Save() error = %v", saveErr)
	}

	updated, ok, err := store.Get(record.ID)
	if err != nil {
		t.Fatalf("Get() after update error = %v", err)
	}
	if !ok {
		t.Fatal("Get() after update ok = false")
	}
	if !updated.CreatedAt.Equal(createdAt) {
		t.Fatalf("updated CreatedAt = %v, want %v", updated.CreatedAt, createdAt)
	}
	if !updated.UpdatedAt.After(firstUpdatedAt) {
		t.Fatalf("UpdatedAt = %v, want after %v", updated.UpdatedAt, firstUpdatedAt)
	}

	records, err := store.List()
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("len(List()) = %d, want 1", len(records))
	}
}

func TestSQLStoreGetReturnsNotFoundWithoutError(t *testing.T) {
	openSQLStoreTestDB(t)

	record, ok, err := NewSQLStore().Get("missing")
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if ok {
		t.Fatalf("Get() ok = true, record = %#v", record)
	}
}

func TestSQLStoreGetReturnsManifestUnmarshalError(t *testing.T) {
	openSQLStoreTestDB(t)

	_, err := database.DB.Exec(`
		INSERT INTO plugin_installations (id, manifest_json, state, install_path, last_error, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, "broken-plugin", "{invalid-json", string(sdkstate.Installed), "/plugins/broken", "")
	if err != nil {
		t.Fatalf("seed plugin_installations error = %v", err)
	}

	_, ok, err := NewSQLStore().Get("broken-plugin")
	if err == nil {
		t.Fatal("Get() error = nil, want manifest unmarshal error")
	}
	if ok {
		t.Fatal("Get() ok = true, want false")
	}
}
