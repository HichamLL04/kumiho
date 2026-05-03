package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestMigrateSeriesLastContentUpdatedAt(t *testing.T) {
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
