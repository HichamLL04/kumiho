package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func openRawTestDB(t *testing.T) string {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_busy_timeout=30000&_journal_mode=WAL")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("db.Ping() error = %v", err)
	}

	DB = db
	t.Cleanup(func() {
		if err := Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		DB = nil
	})

	return dbPath
}

func objectExists(t *testing.T, objectType, objectName string) bool {
	t.Helper()

	var count int
	err := DB.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = ? AND name = ?`,
		objectType,
		objectName,
	).Scan(&count)
	if err != nil {
		t.Fatalf("objectExists(%s, %s) query error = %v", objectType, objectName, err)
	}

	return count > 0
}

func TestConnectFreshDatabaseCreatesMigrationArtifacts(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := Connect(dbPath); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		DB = nil
	})

	if !objectExists(t, "table", "sessions") {
		t.Fatal("sessions table was not created")
	}
	if !objectExists(t, "index", "idx_sessions_token_hash") {
		t.Fatal("idx_sessions_token_hash index was not created")
	}

	if got := getMigrationVersion(); got != latestMigrationVersion {
		t.Fatalf("getMigrationVersion() = %d, want %d", got, latestMigrationVersion)
	}
}

func TestMigrateLegacyDatabaseWithoutVersionRunsPendingMigration(t *testing.T) {
	openRawTestDB(t)

	_, err := DB.Exec(`
		CREATE TABLE server_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE libraries (
			id TEXT PRIMARY KEY,
			library_type TEXT DEFAULT 'book'
		);

		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			can_download BOOLEAN DEFAULT 0
		);

		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			refresh_token_hash TEXT NOT NULL DEFAULT '',
			expires_at DATETIME NOT NULL
		);

		CREATE TABLE reading_progress (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			series_id TEXT NOT NULL,
			chapter_id TEXT,
			current_time REAL DEFAULT 0,
			duration REAL DEFAULT 0
		);
	`)
	if err != nil {
		t.Fatalf("seed legacy schema error = %v", err)
	}

	_, err = DB.Exec(
		`INSERT INTO reading_progress (id, user_id, series_id, chapter_id, current_time, duration) VALUES (?, ?, ?, ?, ?, ?)`,
		"progress-1",
		"user-1",
		"series-1",
		"chapter-1",
		"01:02:03",
		"02:00",
	)
	if err != nil {
		t.Fatalf("insert legacy reading_progress error = %v", err)
	}

	err = Migrate()
	if err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}

	if got := getMigrationVersion(); got != latestMigrationVersion {
		t.Fatalf("getMigrationVersion() = %d, want %d", got, latestMigrationVersion)
	}

	var currentTime float64
	var duration float64
	err = DB.QueryRow(
		`SELECT "current_time", "duration" FROM reading_progress WHERE id = ?`,
		"progress-1",
	).Scan(&currentTime, &duration)
	if err != nil {
		t.Fatalf("select normalized reading_progress error = %v", err)
	}

	if currentTime != 3723 {
		t.Fatalf("current_time = %v, want 3723", currentTime)
	}
	if duration != 120 {
		t.Fatalf("duration = %v, want 120", duration)
	}

	var textValueCount int
	err = DB.QueryRow(
		`SELECT COUNT(*) FROM reading_progress WHERE typeof("current_time") = 'text' OR typeof("duration") = 'text'`,
	).Scan(&textValueCount)
	if err != nil {
		t.Fatalf("count text reading_progress rows error = %v", err)
	}
	if textValueCount != 0 {
		t.Fatalf("textValueCount = %d, want 0", textValueCount)
	}
}
