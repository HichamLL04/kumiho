package repository

import (
	"database/sql"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

type ViewerSession struct {
	UserID     string
	SessionID  string
	SeriesID   string
	ChapterID  string
	LastSeenAt time.Time
	UpdatedAt  time.Time
}

type ViewerSessionRepository struct{}

func NewViewerSessionRepository() *ViewerSessionRepository {
	return &ViewerSessionRepository{}
}

func (r *ViewerSessionRepository) GetByUserID(q database.Queryer, userID string) (*ViewerSession, error) {
	db := database.GetQueryer(q)
	var (
		session        ViewerSession
		seriesIDValue  sql.NullString
		chapterIDValue sql.NullString
	)

	err := db.QueryRow(
		`SELECT user_id, session_id, series_id, chapter_id, last_seen_at, updated_at
		 FROM viewer_sessions
		 WHERE user_id = ?`,
		userID,
	).Scan(
		&session.UserID,
		&session.SessionID,
		&seriesIDValue,
		&chapterIDValue,
		&session.LastSeenAt,
		&session.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if seriesIDValue.Valid {
		session.SeriesID = seriesIDValue.String
	}
	if chapterIDValue.Valid {
		session.ChapterID = chapterIDValue.String
	}

	return &session, nil
}

func (r *ViewerSessionRepository) Upsert(q database.Queryer, userID, sessionID, seriesID, chapterID string) error {
	db := database.GetQueryer(q)
	_, err := db.Exec(
		`INSERT INTO viewer_sessions (user_id, session_id, series_id, chapter_id, last_seen_at, updated_at)
		 VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
		 ON CONFLICT(user_id) DO UPDATE SET
		   session_id = excluded.session_id,
		   series_id = excluded.series_id,
		   chapter_id = excluded.chapter_id,
		   last_seen_at = datetime('now'),
		   updated_at = datetime('now')`,
		userID, sessionID, nullableString(seriesID), nullableString(chapterID),
	)
	return err
}

// TouchIfOwner updates lease heartbeat only when the current owner session matches.
// It never changes session ownership.
func (r *ViewerSessionRepository) TouchIfOwner(q database.Queryer, userID, sessionID, seriesID, chapterID string) (bool, error) {
	db := database.GetQueryer(q)
	result, err := db.Exec(
		`UPDATE viewer_sessions
		 SET series_id = ?,
		     chapter_id = ?,
		     last_seen_at = datetime('now'),
		     updated_at = datetime('now')
		 WHERE user_id = ? AND session_id = ?`,
		nullableString(seriesID), nullableString(chapterID), userID, sessionID,
	)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	return rows > 0, nil
}

func (r *ViewerSessionRepository) IsExpired(s *ViewerSession, ttl time.Duration, now time.Time) bool {
	if s == nil {
		return true
	}
	return now.Sub(s.LastSeenAt) > ttl
}

func nullableString(value string) interface{} {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
