package repository

import (
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/google/uuid"
)

type ChapterCompletionRepository struct{}

func NewChapterCompletionRepository() *ChapterCompletionRepository {
	return &ChapterCompletionRepository{}
}

// MarkComplete 챕터 완독 처리
func (r *ChapterCompletionRepository) MarkComplete(db database.Queryer, userID, chapterID string) error {
	db = database.GetQueryer(db)

	// 이미 완독된 경우 완료 시간 갱신 (ON CONFLICT DO UPDATE)
	_, err := db.Exec(
		`INSERT INTO chapter_completions (id, user_id, chapter_id, completed_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, chapter_id) DO UPDATE SET completed_at = excluded.completed_at`,
		uuid.New().String(), userID, chapterID, time.Now(),
	)
	return err
}

// IsCompleted 챕터 완독 여부 확인
func (r *ChapterCompletionRepository) IsCompleted(db database.Queryer, userID, chapterID string) (bool, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM chapter_completions WHERE user_id = ? AND chapter_id = ?`,
		userID, chapterID,
	).Scan(&count)

	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// FindCompletedChapterIDs 볼륨 내 완독된 챕터 ID 목록 조회
func (r *ChapterCompletionRepository) FindCompletedChapterIDs(db database.Queryer, userID, volumeID string) (map[string]bool, error) {
	db = database.GetQueryer(db)

	rows, err := db.Query(
		`SELECT cc.chapter_id 
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 WHERE (cc.user_id = ? OR ? = '' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'MASTER'))
		   AND c.volume_id = ?
		 UNION
		 SELECT rp.chapter_id
		 FROM reading_progress rp
		 JOIN chapters c ON rp.chapter_id = c.id
		 WHERE (rp.user_id = ? OR ? = '' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'MASTER'))
		   AND c.volume_id = ?
		   AND (rp.progress_percent >= 90 OR rp.progress_percent >= 0.9 OR (rp.total_pages > 0 AND rp.current_page >= rp.total_pages))
		 UNION
		 SELECT c.id
		 FROM chapters c
		 JOIN volume_completions vc ON c.volume_id = vc.volume_id
		 WHERE (vc.user_id = ? OR ? = '' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'MASTER'))
		   AND c.volume_id = ?`,
		userID, userID, userID, volumeID,
		userID, userID, userID, volumeID,
		userID, userID, userID, volumeID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]bool)
	for rows.Next() {
		var chapterID string
		if err := rows.Scan(&chapterID); err != nil {
			return nil, err
		}
		result[chapterID] = true
	}
	return result, nil
}

// FindCompletedChapterIDsBySeries 시리즈 내 완독된 챕터 ID 목록 조회
func (r *ChapterCompletionRepository) FindCompletedChapterIDsBySeries(db database.Queryer, userID, seriesID string) (map[string]bool, error) {
	db = database.GetQueryer(db)

	rows, err := db.Query(
		`SELECT cc.chapter_id 
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE (cc.user_id = ? OR ? = '' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'MASTER'))
		   AND v.series_id = ?
		 UNION
		 SELECT rp.chapter_id
		 FROM reading_progress rp
		 JOIN chapters c ON rp.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE (rp.user_id = ? OR ? = '' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'MASTER'))
		   AND v.series_id = ?
		   AND (rp.progress_percent >= 90 OR rp.progress_percent >= 0.9 OR (rp.total_pages > 0 AND rp.current_page >= rp.total_pages))
		 UNION
		 SELECT c.id
		 FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 JOIN volume_completions vc ON v.id = vc.volume_id
		 WHERE (vc.user_id = ? OR ? = '' OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'MASTER'))
		   AND v.series_id = ?`,
		userID, userID, userID, seriesID,
		userID, userID, userID, seriesID,
		userID, userID, userID, seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]bool)
	for rows.Next() {
		var chapterID string
		if err := rows.Scan(&chapterID); err != nil {
			return nil, err
		}
		result[chapterID] = true
	}
	return result, nil
}

// FindAllCompletedByUser 사용자가 완독한 모든 챕터 ID 조회 (시리즈/볼륨 단위 없이 전체)
// 성능 주의: 필요할 때만 사용
func (r *ChapterCompletionRepository) FindAllCompletedByUser(db database.Queryer, userID string) (map[string]bool, error) {
	db = database.GetQueryer(db)

	rows, err := db.Query(
		`SELECT chapter_id FROM chapter_completions WHERE user_id = ? OR ? = ''
		 UNION
		 SELECT rp.chapter_id FROM reading_progress rp
		 WHERE (rp.user_id = ? OR ? = '')
		   AND (rp.progress_percent >= 90 OR rp.progress_percent >= 0.9 OR (rp.total_pages > 0 AND rp.current_page >= rp.total_pages))
		 UNION
		 SELECT c.id FROM chapters c
		 JOIN volume_completions vc ON c.volume_id = vc.volume_id
		 WHERE vc.user_id = ? OR ? = ''`,
		userID, userID,
		userID, userID,
		userID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	result := make(map[string]bool)
	for rows.Next() {
		var chapterID string
		if err := rows.Scan(&chapterID); err != nil {
			return nil, err
		}
		result[chapterID] = true
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// DeleteByVolume 완독 정보 삭제 (볼륨 삭제 또는 초기화 시)
func (r *ChapterCompletionRepository) DeleteByVolume(db database.Queryer, userID, volumeID string) error {
	db = database.GetQueryer(db)

	_, err := db.Exec(
		`DELETE FROM chapter_completions 
		 WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE volume_id = ?)`,
		userID, volumeID,
	)
	return err
}

// DeleteByChapter 특정 챕터 완독 정보 삭제
func (r *ChapterCompletionRepository) DeleteByChapter(db database.Queryer, userID, chapterID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`DELETE FROM chapter_completions WHERE user_id = ? AND chapter_id = ?`,
		userID, chapterID,
	)
	return err
}
