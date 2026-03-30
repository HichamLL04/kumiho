package repository

import (
	"database/sql"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

var seriesCharacterSpacePattern = regexp.MustCompile(`\s+`)

type SeriesCharacterRepository struct{}

func NewSeriesCharacterRepository() *SeriesCharacterRepository {
	return &SeriesCharacterRepository{}
}

func NormalizeSeriesCharacterName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	return strings.ToLower(seriesCharacterSpacePattern.ReplaceAllString(trimmed, " "))
}

func (r *SeriesCharacterRepository) ListBySeriesID(db database.Queryer, seriesID string) ([]model.SeriesCharacter, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(`
		SELECT id, series_id, name, normalized_name, sort_order, role, external_image_url, image_path,
		       source_provider, source_character_id, source_relation_id, created_at, updated_at
		FROM series_characters
		WHERE series_id = ?
		ORDER BY sort_order, name, created_at
	`, seriesID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var items []model.SeriesCharacter
	for rows.Next() {
		var item model.SeriesCharacter
		if err := rows.Scan(
			&item.ID,
			&item.SeriesID,
			&item.Name,
			&item.NormalizedName,
			&item.SortOrder,
			&item.Role,
			&item.ExternalImageURL,
			&item.ImagePath,
			&item.SourceProvider,
			&item.SourceCharacterID,
			&item.SourceRelationID,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *SeriesCharacterRepository) FindByID(db database.Queryer, seriesID string, characterID string) (*model.SeriesCharacter, error) {
	db = database.GetQueryer(db)
	var item model.SeriesCharacter
	err := db.QueryRow(`
		SELECT id, series_id, name, normalized_name, sort_order, role, external_image_url, image_path,
		       source_provider, source_character_id, source_relation_id, created_at, updated_at
		FROM series_characters
		WHERE series_id = ? AND id = ?
	`, seriesID, characterID).Scan(
		&item.ID,
		&item.SeriesID,
		&item.Name,
		&item.NormalizedName,
		&item.SortOrder,
		&item.Role,
		&item.ExternalImageURL,
		&item.ImagePath,
		&item.SourceProvider,
		&item.SourceCharacterID,
		&item.SourceRelationID,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *SeriesCharacterRepository) ExistsNormalizedName(db database.Queryer, seriesID string, normalizedName string, excludeID string) (bool, error) {
	db = database.GetQueryer(db)
	var count int
	if excludeID != "" {
		if err := db.QueryRow(`SELECT COUNT(*) FROM series_characters WHERE series_id = ? AND normalized_name = ? AND id != ?`, seriesID, normalizedName, excludeID).Scan(&count); err != nil {
			return false, err
		}
	} else {
		if err := db.QueryRow(`SELECT COUNT(*) FROM series_characters WHERE series_id = ? AND normalized_name = ?`, seriesID, normalizedName).Scan(&count); err != nil {
			return false, err
		}
	}
	return count > 0, nil
}

func (r *SeriesCharacterRepository) ShiftSortOrders(db database.Queryer, seriesID string, delta int) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`UPDATE series_characters SET sort_order = sort_order + ?, updated_at = ? WHERE series_id = ?`, delta, time.Now(), seriesID)
	return err
}

func (r *SeriesCharacterRepository) Create(db database.Queryer, item *model.SeriesCharacter) error {
	db = database.GetQueryer(db)
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	now := time.Now()
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}
	if item.UpdatedAt.IsZero() {
		item.UpdatedAt = now
	}
	item.Name = strings.TrimSpace(item.Name)
	item.Role = strings.TrimSpace(item.Role)
	item.NormalizedName = NormalizeSeriesCharacterName(item.Name)
	_, err := db.Exec(`
		INSERT INTO series_characters (
			id, series_id, name, normalized_name, sort_order, role, external_image_url, image_path,
			source_provider, source_character_id, source_relation_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		item.ID,
		item.SeriesID,
		item.Name,
		item.NormalizedName,
		item.SortOrder,
		item.Role,
		item.ExternalImageURL,
		item.ImagePath,
		item.SourceProvider,
		item.SourceCharacterID,
		item.SourceRelationID,
		item.CreatedAt,
		item.UpdatedAt,
	)
	return err
}

func (r *SeriesCharacterRepository) Update(db database.Queryer, item *model.SeriesCharacter) error {
	db = database.GetQueryer(db)
	item.Name = strings.TrimSpace(item.Name)
	item.Role = strings.TrimSpace(item.Role)
	item.NormalizedName = NormalizeSeriesCharacterName(item.Name)
	item.UpdatedAt = time.Now()
	_, err := db.Exec(`
		UPDATE series_characters
		SET name = ?, normalized_name = ?, sort_order = ?, role = ?, external_image_url = ?, image_path = ?,
		    source_provider = ?, source_character_id = ?, source_relation_id = ?, updated_at = ?
		WHERE id = ? AND series_id = ?
	`,
		item.Name,
		item.NormalizedName,
		item.SortOrder,
		item.Role,
		item.ExternalImageURL,
		item.ImagePath,
		item.SourceProvider,
		item.SourceCharacterID,
		item.SourceRelationID,
		item.UpdatedAt,
		item.ID,
		item.SeriesID,
	)
	return err
}

func (r *SeriesCharacterRepository) Delete(db database.Queryer, seriesID string, characterID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM series_characters WHERE series_id = ? AND id = ?`, seriesID, characterID)
	return err
}

func (r *SeriesCharacterRepository) Reorder(db database.Queryer, seriesID string, orderedIDs []string) error {
	db = database.GetQueryer(db)
	for index, id := range orderedIDs {
		if _, err := db.Exec(`UPDATE series_characters SET sort_order = ?, updated_at = ? WHERE series_id = ? AND id = ?`, index, time.Now(), seriesID, id); err != nil {
			return err
		}
	}
	return nil
}
