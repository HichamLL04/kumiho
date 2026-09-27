package repository

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type SeriesHistoryRepository struct{}

func NewSeriesHistoryRepository() *SeriesHistoryRepository {
	return &SeriesHistoryRepository{}
}

// UpsertHistory 히스토리 레코드 생성 또는 업데이트
func (r *SeriesHistoryRepository) UpsertHistory(db database.Queryer, history *model.SeriesHistory) error {
	db = database.GetQueryer(db)

	if history.ID == "" {
		existing, err := r.FindMatch(db, history.AnilistID, history.MalID, history.Path, history.Title)
		if err == nil && existing != nil {
			history.ID = existing.ID
		} else {
			history.ID = uuid.New().String()
		}
	}

	if history.ReadChaptersJSON == "" {
		history.ReadChaptersJSON = "[]"
	}

	query := `
		INSERT INTO series_history (
			id, library_id, title, original_title, original_titles, path,
			anilist_id, mal_id, description, authors, tags, status,
			publication_year, published_at, publisher, thumbnail_path,
			last_read_chapter_num, read_chapters_json, user_id, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			library_id = CASE WHEN excluded.library_id != '' THEN excluded.library_id ELSE series_history.library_id END,
			title = CASE WHEN excluded.title != '' THEN excluded.title ELSE series_history.title END,
			original_title = CASE WHEN excluded.original_title != '' THEN excluded.original_title ELSE series_history.original_title END,
			original_titles = CASE WHEN excluded.original_titles != '' THEN excluded.original_titles ELSE series_history.original_titles END,
			path = CASE WHEN excluded.path != '' THEN excluded.path ELSE series_history.path END,
			anilist_id = CASE WHEN excluded.anilist_id != '' THEN excluded.anilist_id ELSE series_history.anilist_id END,
			mal_id = CASE WHEN excluded.mal_id != '' THEN excluded.mal_id ELSE series_history.mal_id END,
			description = CASE WHEN excluded.description != '' THEN excluded.description ELSE series_history.description END,
			authors = CASE WHEN excluded.authors != '' THEN excluded.authors ELSE series_history.authors END,
			tags = CASE WHEN excluded.tags != '' THEN excluded.tags ELSE series_history.tags END,
			status = CASE WHEN excluded.status != '' THEN excluded.status ELSE series_history.status END,
			publication_year = CASE WHEN excluded.publication_year != '' THEN excluded.publication_year ELSE series_history.publication_year END,
			published_at = CASE WHEN excluded.published_at != '' THEN excluded.published_at ELSE series_history.published_at END,
			publisher = CASE WHEN excluded.publisher != '' THEN excluded.publisher ELSE series_history.publisher END,
			thumbnail_path = CASE WHEN excluded.thumbnail_path != '' THEN excluded.thumbnail_path ELSE series_history.thumbnail_path END,
			last_read_chapter_num = CASE WHEN excluded.last_read_chapter_num > 0 THEN excluded.last_read_chapter_num ELSE series_history.last_read_chapter_num END,
			read_chapters_json = CASE WHEN excluded.read_chapters_json != '' AND excluded.read_chapters_json != '[]' THEN excluded.read_chapters_json ELSE series_history.read_chapters_json END,
			user_id = CASE WHEN excluded.user_id != '' THEN excluded.user_id ELSE series_history.user_id END,
			updated_at = datetime('now')
	`
	_, err := db.Exec(
		query,
		history.ID, history.LibraryID, history.Title, history.OriginalTitle, history.OriginalTitles, history.Path,
		history.AnilistID, history.MalID, history.Description, history.Authors, history.Tags, history.Status,
		history.PublicationYear, history.PublishedAt, history.Publisher, history.ThumbnailPath,
		history.LastReadChapterNum, history.ReadChaptersJSON, history.UserID,
	)
	return err
}

// FindMatch AniList ID, MAL ID, 경로, 제목 순으로 기존 히스토리 매칭 검색
func (r *SeriesHistoryRepository) FindMatch(db database.Queryer, anilistID, malID, path, title string) (*model.SeriesHistory, error) {
	db = database.GetQueryer(db)

	baseSelect := `
		SELECT id, library_id, title, original_title, original_titles, path,
		       anilist_id, mal_id, description, authors, tags, status,
		       publication_year, published_at, publisher, thumbnail_path,
		       last_read_chapter_num, read_chapters_json, user_id, updated_at
		FROM series_history
	`

	var row *sql.Row

	if strings.TrimSpace(anilistID) != "" {
		row = db.QueryRow(baseSelect+` WHERE anilist_id = ? ORDER BY updated_at DESC LIMIT 1`, strings.TrimSpace(anilistID))
		if h, err := r.scanRow(row); err == nil {
			return h, nil
		}
	}

	if strings.TrimSpace(malID) != "" {
		row = db.QueryRow(baseSelect+` WHERE mal_id = ? ORDER BY updated_at DESC LIMIT 1`, strings.TrimSpace(malID))
		if h, err := r.scanRow(row); err == nil {
			return h, nil
		}
	}

	if strings.TrimSpace(path) != "" {
		row = db.QueryRow(baseSelect+` WHERE path = ? ORDER BY updated_at DESC LIMIT 1`, strings.TrimSpace(path))
		if h, err := r.scanRow(row); err == nil {
			return h, nil
		}
	}

	if strings.TrimSpace(title) != "" {
		cleanTitle := strings.TrimSpace(title)
		row = db.QueryRow(baseSelect+` WHERE LOWER(title) = LOWER(?) OR LOWER(original_title) = LOWER(?) ORDER BY updated_at DESC LIMIT 1`, cleanTitle, cleanTitle)
		if h, err := r.scanRow(row); err == nil {
			return h, nil
		}
	}

	return nil, nil
}

func (r *SeriesHistoryRepository) scanRow(row *sql.Row) (*model.SeriesHistory, error) {
	var h model.SeriesHistory
	var lastRead sql.NullFloat64
	err := row.Scan(
		&h.ID, &h.LibraryID, &h.Title, &h.OriginalTitle, &h.OriginalTitles, &h.Path,
		&h.AnilistID, &h.MalID, &h.Description, &h.Authors, &h.Tags, &h.Status,
		&h.PublicationYear, &h.PublishedAt, &h.Publisher, &h.ThumbnailPath,
		&lastRead, &h.ReadChaptersJSON, &h.UserID, &h.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	if lastRead.Valid {
		h.LastReadChapterNum = lastRead.Float64
	}
	return &h, nil
}

// RecordProgress 사용자가 챕터를 읽었을 때 series_history에 진행도 기록
func (r *SeriesHistoryRepository) RecordProgress(db database.Queryer, userID, seriesID string, chapterNum float64) error {
	db = database.GetQueryer(db)

	var (
		libraryID, title, path, thumbnailPath                              string
		origTitle, origTitles, anilistID, malID, desc, authors, tags, stat string
		pubYear, pubAt, publisher                                          string
	)

	err := db.QueryRow(`
		SELECT s.library_id, s.title, s.path, COALESCE(s.thumbnail_path, ''),
		       COALESCE(sm.original_title, ''), COALESCE(sm.original_titles, ''),
		       COALESCE(sm.anilist_id, ''), COALESCE(sm.mal_id, ''),
		       COALESCE(sm.description, ''), COALESCE(sm.authors, ''),
		       COALESCE(sm.tags, ''), COALESCE(sm.status, ''),
		       COALESCE(sm.publication_year, ''), COALESCE(sm.published_at, ''),
		       COALESCE(sm.publisher, '')
		FROM series s
		LEFT JOIN series_metadata sm ON s.id = sm.series_id
		WHERE s.id = ?
	`, seriesID).Scan(
		&libraryID, &title, &path, &thumbnailPath,
		&origTitle, &origTitles,
		&anilistID, &malID,
		&desc, &authors,
		&tags, &stat,
		&pubYear, &pubAt,
		&publisher,
	)
	if err != nil {
		return fmt.Errorf("find series for history: %w", err)
	}

	match, _ := r.FindMatch(db, anilistID, malID, path, title)
	var historyID string
	var readNums []float64

	if match != nil {
		historyID = match.ID
		if match.ReadChaptersJSON != "" && match.ReadChaptersJSON != "[]" {
			_ = json.Unmarshal([]byte(match.ReadChaptersJSON), &readNums)
		}
	} else {
		historyID = uuid.New().String()
	}

	// 챕터 번호 추가 (중복 방지)
	exists := false
	for _, n := range readNums {
		if n == chapterNum {
			exists = true
			break
		}
	}
	if !exists {
		readNums = append(readNums, chapterNum)
		sort.Float64s(readNums)
	}

	readJSONBytes, _ := json.Marshal(readNums)
	readJSON := string(readJSONBytes)

	lastRead := chapterNum
	if match != nil && match.LastReadChapterNum > lastRead {
		lastRead = match.LastReadChapterNum
	}

	h := &model.SeriesHistory{
		ID:                 historyID,
		LibraryID:          libraryID,
		Title:              title,
		OriginalTitle:      origTitle,
		OriginalTitles:     origTitles,
		Path:               path,
		AnilistID:          anilistID,
		MalID:              malID,
		Description:        desc,
		Authors:            authors,
		Tags:               tags,
		Status:             stat,
		PublicationYear:    pubYear,
		PublishedAt:        pubAt,
		Publisher:          publisher,
		ThumbnailPath:      thumbnailPath,
		LastReadChapterNum: lastRead,
		ReadChaptersJSON:   readJSON,
		UserID:             userID,
	}

	return r.UpsertHistory(db, h)
}

// SaveSnapshotFromSeries 시리즈 삭제 전 또는 갱신 시 상태를 snapshot으로 히스토리에 보존
func (r *SeriesHistoryRepository) SaveSnapshotFromSeries(db database.Queryer, seriesID string) error {
	db = database.GetQueryer(db)

	var (
		libraryID, title, path, thumbnailPath                              string
		origTitle, origTitles, anilistID, malID, desc, authors, tags, stat string
		pubYear, pubAt, publisher                                          string
	)

	err := db.QueryRow(`
		SELECT s.library_id, s.title, s.path, COALESCE(s.thumbnail_path, ''),
		       COALESCE(sm.original_title, ''), COALESCE(sm.original_titles, ''),
		       COALESCE(sm.anilist_id, ''), COALESCE(sm.mal_id, ''),
		       COALESCE(sm.description, ''), COALESCE(sm.authors, ''),
		       COALESCE(sm.tags, ''), COALESCE(sm.status, ''),
		       COALESCE(sm.publication_year, ''), COALESCE(sm.published_at, ''),
		       COALESCE(sm.publisher, '')
		FROM series s
		LEFT JOIN series_metadata sm ON s.id = sm.series_id
		WHERE s.id = ?
	`, seriesID).Scan(
		&libraryID, &title, &path, &thumbnailPath,
		&origTitle, &origTitles,
		&anilistID, &malID,
		&desc, &authors,
		&tags, &stat,
		&pubYear, &pubAt,
		&publisher,
	)
	if err != nil {
		return err // series not found or other db error
	}

	// 완료된 챕터 번호들 수집
	rows, err := db.Query(`
		SELECT DISTINCT c.chapter_number
		FROM chapters c
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ?
		  AND (
		      c.id IN (SELECT chapter_id FROM chapter_completions)
		      OR c.id IN (SELECT chapter_id FROM reading_progress WHERE progress_percent >= 0.95)
		  )
		ORDER BY c.chapter_number ASC
	`, seriesID)

	var readNums []float64
	if err == nil {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			var num float64
			if err := rows.Scan(&num); err == nil {
				readNums = append(readNums, num)
			}
		}
	}

	// 최근 읽은 챕터 및 사용자
	var lastChapterNum sql.NullFloat64
	var lastUserID sql.NullString
	_ = db.QueryRow(`
		SELECT c.chapter_number, rp.user_id
		FROM reading_progress rp
		JOIN chapters c ON rp.chapter_id = c.id
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ?
		ORDER BY rp.updated_at DESC
		LIMIT 1
	`, seriesID).Scan(&lastChapterNum, &lastUserID)

	match, _ := r.FindMatch(db, anilistID, malID, path, title)
	var historyID string
	if match != nil {
		historyID = match.ID
		if len(readNums) == 0 && match.ReadChaptersJSON != "" && match.ReadChaptersJSON != "[]" {
			_ = json.Unmarshal([]byte(match.ReadChaptersJSON), &readNums)
		}
	} else {
		historyID = uuid.New().String()
	}

	readJSONBytes, _ := json.Marshal(readNums)
	readJSON := string(readJSONBytes)

	var finalLastRead float64
	if lastChapterNum.Valid {
		finalLastRead = lastChapterNum.Float64
	} else if match != nil {
		finalLastRead = match.LastReadChapterNum
	}

	var finalUserID string
	if lastUserID.Valid && lastUserID.String != "" {
		finalUserID = lastUserID.String
	} else if match != nil {
		finalUserID = match.UserID
	}

	h := &model.SeriesHistory{
		ID:                 historyID,
		LibraryID:          libraryID,
		Title:              title,
		OriginalTitle:      origTitle,
		OriginalTitles:     origTitles,
		Path:               path,
		AnilistID:          anilistID,
		MalID:              malID,
		Description:        desc,
		Authors:            authors,
		Tags:               tags,
		Status:             stat,
		PublicationYear:    pubYear,
		PublishedAt:        pubAt,
		Publisher:          publisher,
		ThumbnailPath:      thumbnailPath,
		LastReadChapterNum: finalLastRead,
		ReadChaptersJSON:   readJSON,
		UserID:             finalUserID,
	}

	return r.UpsertHistory(db, h)
}
