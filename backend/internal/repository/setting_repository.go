package repository

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func NormalizeOriginalTitleLocale(locale string) string {
	normalized := strings.ToLower(strings.TrimSpace(locale))
	switch {
	case strings.HasPrefix(normalized, "ko"):
		return "ko"
	case strings.HasPrefix(normalized, "ja"):
		return "ja"
	case strings.HasPrefix(normalized, "en"):
		return "en"
	default:
		return ""
	}
}

// IsOriginalTitleOverrideEnabled reads original_title_override, falling back to the legacy epub_title_override key.
func IsOriginalTitleOverrideEnabled(repo SettingRepository) bool {
	return IsOriginalTitleOverrideEnabledWithQuery(nil, repo)
}

// IsOriginalTitleOverrideEnabledWithQuery reads original title override settings using the provided query context.
func IsOriginalTitleOverrideEnabledWithQuery(q database.Queryer, repo SettingRepository) bool {
	if repo == nil {
		return false
	}
	for _, key := range []string{"original_title_override", "epub_title_override"} {
		setting, err := repo.GetByKey(q, key)
		if err != nil || setting == nil {
			continue
		}
		return strings.EqualFold(strings.TrimSpace(setting.Value), "true")
	}
	return false
}

func PreferredOriginalTitleLocale(repo SettingRepository) string {
	return PreferredOriginalTitleLocaleWithQuery(nil, repo)
}

func PreferredOriginalTitleLocaleWithQuery(q database.Queryer, repo SettingRepository) string {
	if repo == nil {
		return "ko"
	}

	for _, key := range []string{"original_title_locale"} {
		setting, err := repo.GetByKey(q, key)
		if err != nil || setting == nil {
			continue
		}
		if normalized := NormalizeOriginalTitleLocale(setting.Value); normalized != "" {
			return normalized
		}
	}
	return "ko"
}

type SettingRepository interface {
	GetByKey(q database.Queryer, key string) (*model.Setting, error)
	GetAll(q database.Queryer) ([]model.Setting, error)
	Update(q database.Queryer, key, value string) error
}

type settingRepository struct{}

func NewSettingRepository() SettingRepository {
	return &settingRepository{}
}

func (r *settingRepository) GetByKey(q database.Queryer, key string) (*model.Setting, error) {
	q = database.GetQueryer(q)
	setting := &model.Setting{}
	query := `SELECT key, value, updated_at FROM server_settings WHERE key = ?`
	err := q.QueryRow(query, key).Scan(&setting.Key, &setting.Value, &setting.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return setting, nil
}

func (r *settingRepository) GetAll(q database.Queryer) ([]model.Setting, error) {
	q = database.GetQueryer(q)
	query := `SELECT key, value, updated_at FROM server_settings`
	rows, err := q.Query(query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var settings []model.Setting
	for rows.Next() {
		var s model.Setting
		if err := rows.Scan(&s.Key, &s.Value, &s.UpdatedAt); err != nil {
			return nil, err
		}
		settings = append(settings, s)
	}
	return settings, nil
}

func (r *settingRepository) Update(q database.Queryer, key, value string) error {
	q = database.GetQueryer(q)
	query := `
		INSERT INTO server_settings (key, value, updated_at)
		VALUES (?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET
			value = excluded.value,
			updated_at = excluded.updated_at
	`
	_, err := q.Exec(query, key, value, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update setting: %w", err)
	}
	return nil
}
