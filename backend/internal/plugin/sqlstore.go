package plugin

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
)

// SQLStore persists plugin records in SQLite.
type SQLStore struct{}

func NewSQLStore() *SQLStore {
	return &SQLStore{}
}

func (s *SQLStore) Save(record Record) error {
	manifestJSON, err := json.Marshal(record.Manifest)
	if err != nil {
		return fmt.Errorf("marshal plugin manifest: %w", err)
	}

	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}
	record.UpdatedAt = time.Now()

	_, err = database.DB.Exec(`
		INSERT INTO plugin_installations (
			id, manifest_json, state, install_path, last_error, created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			manifest_json = excluded.manifest_json,
			state = excluded.state,
			install_path = excluded.install_path,
			last_error = excluded.last_error,
			updated_at = excluded.updated_at
	`, record.ID, string(manifestJSON), string(record.State), record.InstallPath, record.LastError, record.CreatedAt, record.UpdatedAt)
	if err != nil {
		return fmt.Errorf("save plugin record: %w", err)
	}

	return nil
}

func (s *SQLStore) Get(id string) (Record, bool, error) {
	row := database.DB.QueryRow(`
		SELECT id, manifest_json, state, install_path, last_error, created_at, updated_at
		FROM plugin_installations
		WHERE id = ?
	`, id)

	record, err := scanPluginRecord(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Record{}, false, nil
		}
		return Record{}, false, err
	}
	return record, true, nil
}

func (s *SQLStore) List() ([]Record, error) {
	rows, err := database.DB.Query(`
		SELECT id, manifest_json, state, install_path, last_error, created_at, updated_at
		FROM plugin_installations
		ORDER BY id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var records []Record
	for rows.Next() {
		record, scanErr := scanPluginRecord(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func (s *SQLStore) Delete(id string) error {
	_, err := database.DB.Exec(`DELETE FROM plugin_installations WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete plugin record: %w", err)
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanPluginRecord(s scanner) (Record, error) {
	var (
		record       Record
		manifestJSON string
		stateValue   string
		lastError    sql.NullString
		installPath  sql.NullString
	)

	if err := s.Scan(
		&record.ID,
		&manifestJSON,
		&stateValue,
		&installPath,
		&lastError,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return Record{}, err
	}

	if err := json.Unmarshal([]byte(manifestJSON), &record.Manifest); err != nil {
		return Record{}, fmt.Errorf("unmarshal plugin manifest: %w", err)
	}

	record.State = sdkstate.State(stateValue)
	record.InstallPath = installPath.String
	record.LastError = lastError.String

	return record, nil
}
