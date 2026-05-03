package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestMigrateSeriesLastContentUpdatedAt(t *testing.T) {
	t.Run("updated_at column exists", func(t *testing.T) {
		testMigrateSeriesLastContentUpdatedAtWithUpdatedAt(t)
	})
	t.Run("updated_at column missing", func(t *testing.T) {
		testMigrateSeriesLastContentUpdatedAtWithoutUpdatedAt(t)
	})
}

func testMigrateSeriesLastContentUpdatedAtWithUpdatedAt(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "migration-43.db")

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer func() {
		_ = db.Close()
		DB = nil
	}()

	DB = db

	if _, err := DB.Exec(`
		CREATE TABLE series (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			updated_at DATETIME
		)
	`); err != nil {
		t.Fatalf("create series table error = %v", err)
	}

	if _, err := DB.Exec(`
		INSERT INTO series (id, title, updated_at)
		VALUES ('series-1', 'Series 1', '2026-05-03 09:30:00')
	`); err != nil {
		t.Fatalf("seed series error = %v", err)
	}
	if _, err := DB.Exec(`
		INSERT INTO series (id, title, updated_at)
		VALUES ('series-null-updated-at', 'Series Null UpdatedAt', NULL)
	`); err != nil {
		t.Fatalf("seed series with null updated_at error = %v", err)
	}
	if err := migrateSeriesLastContentUpdatedAt(); err != nil {
		t.Fatalf("migrateSeriesLastContentUpdatedAt() error = %v", err)
	}

	if !columnExists("series", "last_content_updated_at") {
		t.Fatal("last_content_updated_at column was not added")
	}

	var migratedValue string
	if err := DB.QueryRow(`SELECT datetime(last_content_updated_at) FROM series WHERE id = 'series-1'`).Scan(&migratedValue); err != nil {
		t.Fatalf("select migrated last_content_updated_at error = %v", err)
	}
	if migratedValue != "2026-05-03 09:30:00" {
		t.Fatalf("migrated last_content_updated_at = %s, want 2026-05-03 09:30:00", migratedValue)
	}

	var nullBackfilledValue sql.NullString
	if err := DB.QueryRow(`SELECT datetime(last_content_updated_at) FROM series WHERE id = 'series-null-updated-at'`).Scan(&nullBackfilledValue); err != nil {
		t.Fatalf("select null-updated_at backfill error = %v", err)
	}
	if !nullBackfilledValue.Valid {
		t.Fatal("last_content_updated_at should be backfilled when updated_at is NULL")
	}

	if _, err := DB.Exec(`
		INSERT INTO series (id, title, updated_at, last_content_updated_at)
		VALUES ('series-existing-last-content', 'Series Existing Last Content', '2026-05-03 10:10:00', '2026-05-01 08:00:00')
	`); err != nil {
		t.Fatalf("insert series with existing last_content_updated_at error = %v", err)
	}

	if err := migrateSeriesLastContentUpdatedAt(); err != nil {
		t.Fatalf("re-run migrateSeriesLastContentUpdatedAt() error = %v", err)
	}

	var preservedValue string
	if err := DB.QueryRow(`SELECT datetime(last_content_updated_at) FROM series WHERE id = 'series-existing-last-content'`).Scan(&preservedValue); err != nil {
		t.Fatalf("select preserved last_content_updated_at error = %v", err)
	}
	if preservedValue != "2026-05-01 08:00:00" {
		t.Fatalf("preserved last_content_updated_at = %s, want 2026-05-01 08:00:00", preservedValue)
	}

	if _, err := DB.Exec(`
		INSERT INTO series (id, title, updated_at)
		VALUES ('series-2', 'Series 2', '2026-05-03 10:45:00')
	`); err != nil {
		t.Fatalf("insert series after migration error = %v", err)
	}

	var insertedValue string
	if err := DB.QueryRow(`SELECT datetime(last_content_updated_at) FROM series WHERE id = 'series-2'`).Scan(&insertedValue); err != nil {
		t.Fatalf("select inserted last_content_updated_at error = %v", err)
	}
	if insertedValue != "2026-05-03 10:45:00" {
		t.Fatalf("inserted last_content_updated_at = %s, want 2026-05-03 10:45:00", insertedValue)
	}
}

func testMigrateSeriesLastContentUpdatedAtWithoutUpdatedAt(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "migration-43-no-updated-at.db")

	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer func() {
		_ = db.Close()
		DB = nil
	}()

	DB = db

	if _, err := DB.Exec(`
		CREATE TABLE series (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL
		)
	`); err != nil {
		t.Fatalf("create legacy series table error = %v", err)
	}

	if _, err := DB.Exec(`
		INSERT INTO series (id, title)
		VALUES ('legacy-series-1', 'Legacy Series 1')
	`); err != nil {
		t.Fatalf("seed legacy series error = %v", err)
	}

	if err := migrateSeriesLastContentUpdatedAt(); err != nil {
		t.Fatalf("migrateSeriesLastContentUpdatedAt() on legacy schema error = %v", err)
	}

	if !columnExists("series", "last_content_updated_at") {
		t.Fatal("last_content_updated_at column was not added on legacy schema")
	}

	var migratedValue sql.NullString
	if err := DB.QueryRow(`SELECT datetime(last_content_updated_at) FROM series WHERE id = 'legacy-series-1'`).Scan(&migratedValue); err != nil {
		t.Fatalf("select legacy migrated last_content_updated_at error = %v", err)
	}
	if !migratedValue.Valid {
		t.Fatal("legacy series last_content_updated_at should be backfilled")
	}

	if _, err := DB.Exec(`
		INSERT INTO series (id, title)
		VALUES ('legacy-series-2', 'Legacy Series 2')
	`); err != nil {
		t.Fatalf("insert legacy series after migration error = %v", err)
	}

	var insertedValue sql.NullString
	if err := DB.QueryRow(`SELECT datetime(last_content_updated_at) FROM series WHERE id = 'legacy-series-2'`).Scan(&insertedValue); err != nil {
		t.Fatalf("select legacy inserted last_content_updated_at error = %v", err)
	}
	if !insertedValue.Valid {
		t.Fatal("legacy inserted series last_content_updated_at should be initialized by trigger")
	}
}
