package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type PluginSecretRepository interface {
	GetByKey(q database.Queryer, pluginID, fieldKey string) (*model.PluginSecret, error)
	ListByPlugin(q database.Queryer, pluginID string) ([]model.PluginSecret, error)
	Upsert(q database.Queryer, pluginID, fieldKey, valueEncrypted string) error
	Delete(q database.Queryer, pluginID, fieldKey string) error
	DeleteByPlugin(q database.Queryer, pluginID string) error
}

type pluginSecretRepository struct{}

func NewPluginSecretRepository() PluginSecretRepository {
	return &pluginSecretRepository{}
}

func (r *pluginSecretRepository) GetByKey(q database.Queryer, pluginID, fieldKey string) (*model.PluginSecret, error) {
	q = database.GetQueryer(q)
	secret := &model.PluginSecret{}
	query := `SELECT plugin_id, field_key, value_encrypted, updated_at FROM plugin_secrets WHERE plugin_id = ? AND field_key = ?`
	err := q.QueryRow(query, pluginID, fieldKey).Scan(&secret.PluginID, &secret.FieldKey, &secret.ValueEncrypted, &secret.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return secret, nil
}

func (r *pluginSecretRepository) ListByPlugin(q database.Queryer, pluginID string) ([]model.PluginSecret, error) {
	q = database.GetQueryer(q)
	rows, err := q.Query(`SELECT plugin_id, field_key, value_encrypted, updated_at FROM plugin_secrets WHERE plugin_id = ?`, pluginID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	secrets := []model.PluginSecret{}
	for rows.Next() {
		var item model.PluginSecret
		if err := rows.Scan(&item.PluginID, &item.FieldKey, &item.ValueEncrypted, &item.UpdatedAt); err != nil {
			return nil, err
		}
		secrets = append(secrets, item)
	}
	return secrets, nil
}

func (r *pluginSecretRepository) Upsert(q database.Queryer, pluginID, fieldKey, valueEncrypted string) error {
	q = database.GetQueryer(q)
	query := `
		INSERT INTO plugin_secrets (plugin_id, field_key, value_encrypted, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(plugin_id, field_key) DO UPDATE SET
			value_encrypted = excluded.value_encrypted,
			updated_at = excluded.updated_at
	`
	_, err := q.Exec(query, pluginID, fieldKey, valueEncrypted, time.Now())
	if err != nil {
		return fmt.Errorf("failed to upsert plugin secret: %w", err)
	}
	return nil
}

func (r *pluginSecretRepository) Delete(q database.Queryer, pluginID, fieldKey string) error {
	q = database.GetQueryer(q)
	_, err := q.Exec(`DELETE FROM plugin_secrets WHERE plugin_id = ? AND field_key = ?`, pluginID, fieldKey)
	if err != nil {
		return fmt.Errorf("failed to delete plugin secret: %w", err)
	}
	return nil
}

func (r *pluginSecretRepository) DeleteByPlugin(q database.Queryer, pluginID string) error {
	q = database.GetQueryer(q)
	_, err := q.Exec(`DELETE FROM plugin_secrets WHERE plugin_id = ?`, pluginID)
	if err != nil {
		return fmt.Errorf("failed to delete plugin secrets: %w", err)
	}
	return nil
}
