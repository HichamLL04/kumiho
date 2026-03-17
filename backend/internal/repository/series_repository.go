package repository

import (
	"database/sql"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type SeriesRepository struct{}

func NewSeriesRepository() *SeriesRepository {
	return &SeriesRepository{}
}

// Create 새 시리즈 생성
func (r *SeriesRepository) Create(db database.Queryer, series *model.Series) error {
	db = database.GetQueryer(db)
	series.ID = uuid.New().String()
	now := time.Now()
	if series.CreatedAt.IsZero() {
		series.CreatedAt = now
	}
	if series.UpdatedAt.IsZero() {
		series.UpdatedAt = now
	}

	// 1. series 테이블 저장
	_, err := db.Exec(
		`INSERT INTO series (id, library_id, title, path, thumbnail_path, extension, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		series.ID, series.LibraryID, series.Title, series.Path, series.ThumbnailPath, series.Extension,
		series.CreatedAt, series.UpdatedAt,
	)
	if err != nil {
		return err
	}

	// 2. series_metadata 테이블 저장
	if series.Metadata == nil {
		series.Metadata = &model.SeriesMetadata{}
	}
	_, err = db.Exec(
		`INSERT INTO series_metadata (
			series_id, description, is_bookmarked, status, authors, tags, publication_year,
			original_title, publisher, published_at, isbn
		)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		series.ID, series.Description, series.IsBookmarked, series.Metadata.Status, series.Metadata.Authors, series.Metadata.Tags, series.Metadata.PublicationYear,
		series.Metadata.OriginalTitle, series.Metadata.Publisher, series.Metadata.PublishedAt, series.Metadata.ISBN,
	)
	return err
}

// FindByLibraryID 라이브러리 ID로 시리즈 목록 조회 (사용자별 북마크 정보 포함)
func (r *SeriesRepository) FindByLibraryID(db database.Queryer, libraryID string, userID string) ([]model.Series, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.extension, s.created_at, s.updated_at,
		        sm.description, (ub.series_id IS NOT NULL) AS is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year,
				sm.original_title, sm.publisher, sm.published_at, sm.isbn,
				l.library_type
		 FROM series s
		 JOIN libraries l ON s.library_id = l.id
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 LEFT JOIN user_bookmarks ub ON s.id = ub.series_id AND ub.user_id = ?
		 WHERE s.library_id = ? ORDER BY s.title`,
		userID, libraryID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var m model.SeriesMetadata
		var thumbnail, ext sql.NullString
		var desc, status, authors, tags, pubYear, originalTitle, publisher, publishedAt, isbn sql.NullString
		var isBookmarked sql.NullBool
		var libraryType sql.NullString

		err := rows.Scan(
			&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &ext, &s.CreatedAt, &s.UpdatedAt,
			&desc, &isBookmarked, &status, &authors, &tags, &pubYear, &originalTitle, &publisher, &publishedAt, &isbn,
			&libraryType,
		)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			s.ThumbnailPath = &thumbnail.String
		}
		if ext.Valid {
			s.Extension = ext.String
		}
		if libraryType.Valid {
			s.LibraryType = libraryType.String
		}

		m.SeriesID = s.ID
		if desc.Valid {
			s.Description = desc.String
			m.Description = desc.String
		}
		if isBookmarked.Valid {
			s.IsBookmarked = isBookmarked.Bool
			m.IsBookmarked = isBookmarked.Bool
		}
		if status.Valid {
			m.Status = status.String
		}
		if authors.Valid {
			m.Authors = authors.String
		}
		if tags.Valid {
			m.Tags = tags.String
		}
		if pubYear.Valid {
			m.PublicationYear = pubYear.String
		}
		if originalTitle.Valid {
			m.OriginalTitle = originalTitle.String
		}
		if publisher.Valid {
			m.Publisher = publisher.String
		}
		if publishedAt.Valid {
			m.PublishedAt = publishedAt.String
		}
		if isbn.Valid {
			m.ISBN = isbn.String
		}
		s.Metadata = &m

		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

// FindBookmarked 북마크된(좋아요) 특정 사용자의 시리즈 목록 조회
func (r *SeriesRepository) FindBookmarked(db database.Queryer, userID string) ([]model.Series, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.extension, s.created_at, s.updated_at,
		        sm.description, 1 AS is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year,
				sm.original_title, sm.publisher, sm.published_at, sm.isbn,
				l.library_type
		 FROM series s
		 JOIN libraries l ON s.library_id = l.id
		 JOIN user_bookmarks ub ON s.id = ub.series_id
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 WHERE ub.user_id = ? ORDER BY s.title`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var m model.SeriesMetadata
		var thumbnail, ext sql.NullString
		var desc, status, authors, tags, pubYear, originalTitle, publisher, publishedAt, isbn sql.NullString
		var isBookmarked sql.NullBool
		var libraryType sql.NullString

		err := rows.Scan(
			&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &ext, &s.CreatedAt, &s.UpdatedAt,
			&desc, &isBookmarked, &status, &authors, &tags, &pubYear, &originalTitle, &publisher, &publishedAt, &isbn,
			&libraryType,
		)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			s.ThumbnailPath = &thumbnail.String
		}
		if ext.Valid {
			s.Extension = ext.String
		}
		if libraryType.Valid {
			s.LibraryType = libraryType.String
		}

		m.SeriesID = s.ID
		if desc.Valid {
			s.Description = desc.String
			m.Description = desc.String
		}
		if isBookmarked.Valid {
			s.IsBookmarked = isBookmarked.Bool
			m.IsBookmarked = isBookmarked.Bool
		}
		if status.Valid {
			m.Status = status.String
		}
		if authors.Valid {
			m.Authors = authors.String
		}
		if tags.Valid {
			m.Tags = tags.String
		}
		if pubYear.Valid {
			m.PublicationYear = pubYear.String
		}
		if originalTitle.Valid {
			m.OriginalTitle = originalTitle.String
		}
		if publisher.Valid {
			m.Publisher = publisher.String
		}
		if publishedAt.Valid {
			m.PublishedAt = publishedAt.String
		}
		if isbn.Valid {
			m.ISBN = isbn.String
		}
		s.Metadata = &m

		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

// FindByID ID로 시리즈 상세 조회 (사용자별 북마크 정보 포함)
func (r *SeriesRepository) FindByID(db database.Queryer, id string, userID string) (*model.Series, error) {
	db = database.GetQueryer(db)
	var s model.Series
	var m model.SeriesMetadata
	var thumbnail, ext sql.NullString
	var desc, status, authors, tags, pubYear, originalTitle, publisher, publishedAt, isbn sql.NullString
	var isBookmarked sql.NullBool

	var libraryType sql.NullString
	err := db.QueryRow(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.extension, s.created_at, s.updated_at,
		        sm.description, (ub.series_id IS NOT NULL) AS is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year,
				sm.original_title, sm.publisher, sm.published_at, sm.isbn,
				l.library_type
		 FROM series s
		 JOIN libraries l ON s.library_id = l.id
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 LEFT JOIN user_bookmarks ub ON s.id = ub.series_id AND ub.user_id = ?
		 WHERE s.id = ?`,
		userID, id,
	).Scan(
		&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &ext, &s.CreatedAt, &s.UpdatedAt,
		&desc, &isBookmarked, &status, &authors, &tags, &pubYear, &originalTitle, &publisher, &publishedAt, &isbn,
		&libraryType,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if thumbnail.Valid {
		s.ThumbnailPath = &thumbnail.String
	}
	if ext.Valid {
		s.Extension = ext.String
	}
	if libraryType.Valid {
		s.LibraryType = libraryType.String
	}

	m.SeriesID = s.ID
	if desc.Valid {
		s.Description = desc.String
		m.Description = desc.String
	}
	if isBookmarked.Valid {
		s.IsBookmarked = isBookmarked.Bool
		m.IsBookmarked = isBookmarked.Bool
	}
	if status.Valid {
		m.Status = status.String
	}
	if authors.Valid {
		m.Authors = authors.String
	}
	if tags.Valid {
		m.Tags = tags.String
	}
	if pubYear.Valid {
		m.PublicationYear = pubYear.String
	}
	if originalTitle.Valid {
		m.OriginalTitle = originalTitle.String
	}
	if publisher.Valid {
		m.Publisher = publisher.String
	}
	if publishedAt.Valid {
		m.PublishedAt = publishedAt.String
	}
	if isbn.Valid {
		m.ISBN = isbn.String
	}
	s.Metadata = &m

	return &s, nil
}

// FindByPath 경로로 시리즈 상세 조회 (사용자별 북마크 정보 포함)
func (r *SeriesRepository) FindByPath(db database.Queryer, path string, userID string) (*model.Series, error) {
	db = database.GetQueryer(db)
	var s model.Series
	var m model.SeriesMetadata
	var thumbnail, ext sql.NullString
	var desc, status, authors, tags, pubYear, originalTitle, publisher, publishedAt, isbn sql.NullString
	var isBookmarked sql.NullBool
	var libraryType sql.NullString

	err := db.QueryRow(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.extension, s.created_at, s.updated_at,
		        sm.description, (ub.series_id IS NOT NULL) AS is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year,
				sm.original_title, sm.publisher, sm.published_at, sm.isbn,
				l.library_type
		 FROM series s
		 JOIN libraries l ON s.library_id = l.id
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 LEFT JOIN user_bookmarks ub ON s.id = ub.series_id AND ub.user_id = ?
		 WHERE s.path = ?`,
		userID, path,
	).Scan(
		&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &ext, &s.CreatedAt, &s.UpdatedAt,
		&desc, &isBookmarked, &status, &authors, &tags, &pubYear, &originalTitle, &publisher, &publishedAt, &isbn,
		&libraryType,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if thumbnail.Valid {
		s.ThumbnailPath = &thumbnail.String
	}
	if ext.Valid {
		s.Extension = ext.String
	}
	if libraryType.Valid {
		s.LibraryType = libraryType.String
	}

	m.SeriesID = s.ID
	if desc.Valid {
		s.Description = desc.String
		m.Description = desc.String
	}
	if isBookmarked.Valid {
		s.IsBookmarked = isBookmarked.Bool
		m.IsBookmarked = isBookmarked.Bool
	}
	if status.Valid {
		m.Status = status.String
	}
	if authors.Valid {
		m.Authors = authors.String
	}
	if tags.Valid {
		m.Tags = tags.String
	}
	if pubYear.Valid {
		m.PublicationYear = pubYear.String
	}
	if originalTitle.Valid {
		m.OriginalTitle = originalTitle.String
	}
	if publisher.Valid {
		m.Publisher = publisher.String
	}
	if publishedAt.Valid {
		m.PublishedAt = publishedAt.String
	}
	if isbn.Valid {
		m.ISBN = isbn.String
	}
	s.Metadata = &m

	return &s, nil
}

// DeleteByLibraryID 라이브러리 ID로 모든 시리즈 삭제
func (r *SeriesRepository) DeleteByLibraryID(db database.Queryer, libraryID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM series WHERE library_id = ?`, libraryID)
	return err
}

// Delete ID로 시리즈 삭제
func (r *SeriesRepository) Delete(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM series WHERE id = ?`, id)
	return err
}

// Update 시리즈 정보 업데이트
func (r *SeriesRepository) Update(db database.Queryer, series *model.Series) error {
	db = database.GetQueryer(db)
	// 1. series 테이블 업데이트
	_, err := db.Exec(
		`UPDATE series SET title = ?, path = ?, thumbnail_path = ?, extension = ?, updated_at = ? WHERE id = ?`,
		series.Title, series.Path, series.ThumbnailPath, series.Extension, series.UpdatedAt, series.ID,
	)
	if err != nil {
		return err
	}

	// 2. series_metadata 테이블 업데이트
	if series.Metadata != nil {
		_, err = db.Exec(
			`UPDATE series_metadata
			 SET description = ?, is_bookmarked = ?, status = ?, authors = ?, tags = ?, publication_year = ?,
			     original_title = ?, publisher = ?, published_at = ?, isbn = ?
			 WHERE series_id = ?`,
			series.Description, series.IsBookmarked, series.Metadata.Status, series.Metadata.Authors, series.Metadata.Tags, series.Metadata.PublicationYear,
			series.Metadata.OriginalTitle, series.Metadata.Publisher, series.Metadata.PublishedAt, series.Metadata.ISBN, series.ID,
		)
		return err
	}

	return nil
}

// UpdateBookmark 사용자별 시리즈 북마크 상태 업데이트
func (r *SeriesRepository) UpdateBookmark(db database.Queryer, userID, seriesID string, isBookmarked bool) error {
	db = database.GetQueryer(db)
	var query string
	if isBookmarked {
		query = `INSERT OR IGNORE INTO user_bookmarks (user_id, series_id) VALUES (?, ?)`
	} else {
		query = `DELETE FROM user_bookmarks WHERE user_id = ? AND series_id = ?`
	}
	_, err := db.Exec(query, userID, seriesID)
	return err
}

// UpdateUpdatedAt 시리즈의 업데이트 시간 수정
func (r *SeriesRepository) UpdateUpdatedAt(db database.Queryer, id string, updatedAt time.Time) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`UPDATE series SET updated_at = ? WHERE id = ?`, updatedAt, id)
	return err
}

// GetFirstPageID 시리즈의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *SeriesRepository) GetFirstPageID(db database.Queryer, seriesID string) (string, error) {
	db = database.GetQueryer(db)
	var pageID string
	err := db.QueryRow(
		`SELECT p.id 
		 FROM pages p
		 JOIN chapters c ON p.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?
		 ORDER BY v.volume_number, c.chapter_number, p.page_number
		 LIMIT 1`,
		seriesID,
	).Scan(&pageID)

	if err != nil {
		return "", err
	}
	return pageID, nil
}

// GetTotalPages 시리즈의 전체 페이지 수 조회
// page_count > 0인 챕터: 실제 page_count
// page_count <= 0 이면서 total_positions > 0인 챕터(예: EPUB): total_positions 반영
func (r *SeriesRepository) GetTotalPages(db database.Queryer, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var totalPages int
	err := db.QueryRow(
		`SELECT COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN c.page_count 
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
				ELSE 0 
			END), 0)
		 FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?`,
		seriesID,
	).Scan(&totalPages)
	return totalPages, err
}

// GetReadPages 사용자가 시리즈에서 읽은 총 페이지 수 조회
// 1. 시리즈 내 모든 완독된 챕터들의 페이지 수 합산
// 2. 시리즈 내 모든 진행 중인(완독되지 않은) 챕터들의 현재 페이지 합산
// 3. EPUB 등 page_count=0인 챕터는 progress_percent 기반 가상 페이지(100 스케일) 사용
func (r *SeriesRepository) GetReadPages(db database.Queryer, userID, seriesID string) (int, error) {
	db = database.GetQueryer(db)

	// 1. 완독된 챕터들의 페이지 수 합계
	// page_count > 0인 챕터: 실제 page_count 사용
	// page_count <= 0인 챕터(EPUB 등): total_positions 사용
	var completedPages int
	err := db.QueryRow(
		`SELECT COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN c.page_count 
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
				ELSE 0 
			END), 0)
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE cc.user_id = ? AND v.series_id = ?`,
		userID, seriesID,
	).Scan(&completedPages)
	if err != nil {
		return 0, err
	}

	// 2. 진행 중인(완독되지 않은) 챕터들의 현재 페이지 합계
	// page_count > 0인 챕터: current_page 사용
	// page_count <= 0인 챕터(EPUB 등): progress_percent를 100 스케일로 변환 (예: 50% → 50)
	var progressPages int
	err = db.QueryRow(
		`SELECT COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN rp.current_page
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN rp.current_page
				ELSE CAST(rp.progress_percent AS INTEGER)
			END
		), 0)
		 FROM reading_progress rp
		 JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? AND rp.series_id = ?
		 AND rp.chapter_id NOT IN (
			 SELECT chapter_id FROM chapter_completions WHERE user_id = ?
		 )`,
		userID, seriesID, userID,
	).Scan(&progressPages)
	if err != nil {
		return 0, err
	}

	return completedPages + progressPages, nil
}

// GetTotalProgressUnits 시리즈 진행률 표시용 총량(용량 기반 단위) 조회
// - total_positions > 0: total_positions 사용 (EPUB/TXT 등)
// - 그 외 page_count > 0: page_count 사용 (이미지/PDF 등)
func (r *SeriesRepository) GetTotalProgressUnits(db database.Queryer, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var total int
	err := db.QueryRow(
		`SELECT COALESCE(SUM(
			CASE
				WHEN c.total_positions > 0 THEN c.total_positions
				WHEN c.page_count > 0 THEN c.page_count
				ELSE 0
			END
		), 0)
		FROM chapters c
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ?`,
		seriesID,
	).Scan(&total)
	return total, err
}

// GetReadProgressUnits 시리즈 진행률 표시용 완료량 조회
// - 완독 챕터: 해당 챕터 총량을 100% 반영
// - 미완독 챕터: 뷰어 진행(current_page/total_pages, fallback: progress_percent) 비율만큼 반영
func (r *SeriesRepository) GetReadProgressUnits(db database.Queryer, userID, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var read int
	err := db.QueryRow(
		`WITH chapter_units AS (
			SELECT
				c.id AS chapter_id,
				CASE
					WHEN c.total_positions > 0 THEN c.total_positions
					WHEN c.page_count > 0 THEN c.page_count
					ELSE 0
				END AS unit_total
			FROM chapters c
			JOIN volumes v ON c.volume_id = v.id
			WHERE v.series_id = ?
		),
		completed_units AS (
			SELECT COALESCE(SUM(cu.unit_total), 0) AS value
			FROM chapter_units cu
			JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id
			WHERE cc.user_id = ?
		),
		inprogress_units AS (
			SELECT COALESCE(SUM(
				CAST(ROUND(
					cu.unit_total * (
						CASE
							WHEN rp.total_pages > 0 THEN MIN(1.0, MAX(0.0, CAST(rp.current_page AS REAL) / CAST(rp.total_pages AS REAL)))
							ELSE MIN(1.0, MAX(0.0, rp.progress_percent / 100.0))
						END
					)
				) AS INTEGER)
			), 0) AS value
			FROM chapter_units cu
			JOIN reading_progress rp ON rp.chapter_id = cu.chapter_id
			LEFT JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id AND cc.user_id = rp.user_id
			WHERE rp.user_id = ?
			  AND rp.series_id = ?
			  AND cc.chapter_id IS NULL
		)
		SELECT completed_units.value + inprogress_units.value
		FROM completed_units, inprogress_units`,
		seriesID, userID, userID, seriesID,
	).Scan(&read)
	return read, err
}

// Search 검색어로 시리즈 조회
func (r *SeriesRepository) Search(db database.Queryer, query string, userID string, allowedLibraryIDs []string, isMaster bool) ([]model.Series, error) {
	db = database.GetQueryer(db)

	// 띄어쓰기 및 특수문자 무시 검색을 위해 검색어 전처리
	var sb strings.Builder
	for _, char := range query {
		if char != ' ' && char != '-' && char != '_' {
			// 입력된 검색어의 %, _ 문자는 이스케이프 처리
			if char == '%' || char == '_' {
				sb.WriteRune('\\')
			}
			sb.WriteRune(char)
		}
	}
	// ESCAPE '\' 구문은 SQLite에서 기본값이 아닐 수 있으므로 쿼리에 명시하거나 기본 동작 확인 필요
	// 여기서는 표준적인 방식(%와 _ 이스케이프)을 적용
	searchPattern := "%" + sb.String() + "%"

	// SQLite에서 공백, 하이픈, 언더바를 모두 제거하고 비교 (중첩 REPLACE)
	sqlStr := `SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.extension, s.created_at, s.updated_at,
		        sm.description, (ub.series_id IS NOT NULL) AS is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year,
				sm.original_title, sm.publisher, sm.published_at, sm.isbn
		 FROM series s
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 LEFT JOIN user_bookmarks ub ON s.id = ub.series_id AND ub.user_id = ?
		 WHERE (REPLACE(REPLACE(REPLACE(s.title, ' ', ''), '-', ''), '_', '') LIKE ? ESCAPE '\'
		    OR REPLACE(REPLACE(REPLACE(sm.description, ' ', ''), '-', ''), '_', '') LIKE ? ESCAPE '\'
		    OR REPLACE(REPLACE(REPLACE(sm.authors, ' ', ''), '-', ''), '_', '') LIKE ? ESCAPE '\'
		    OR REPLACE(REPLACE(REPLACE(sm.tags, ' ', ''), '-', ''), '_', '') LIKE ? ESCAPE '\')`

	args := []interface{}{userID}
	args = append(args, searchPattern, searchPattern, searchPattern, searchPattern)

	if !isMaster {
		// SYSTEM 라이브러리는 항상 접근 가능하다고 가정하거나, 명시적으로 포함해야 함
		// 여기서는 권한이 부여된 라이브러리만 검색하도록 함
		if len(allowedLibraryIDs) == 0 {
			// 권한이 하나도 없음 (SYSTEM 라이브러리가 없는 경우를 위해 보수적으로 처리)
			return []model.Series{}, nil
		}
		sqlStr += " AND (s.library_id IN ("
		for i, id := range allowedLibraryIDs {
			if i > 0 {
				sqlStr += ", "
			}
			sqlStr += "?"
			args = append(args, id)
		}
		sqlStr += ") OR s.library_id IN (SELECT id FROM libraries WHERE type = 'SYSTEM'))"
	}

	sqlStr += " ORDER BY s.title LIMIT 100"

	rows, err := db.Query(sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var m model.SeriesMetadata
		var thumbnail, ext sql.NullString
		var desc, status, authors, tags, pubYear, originalTitle, publisher, publishedAt, isbn sql.NullString
		var isBookmarked sql.NullBool

		err := rows.Scan(
			&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &ext, &s.CreatedAt, &s.UpdatedAt,
			&desc, &isBookmarked, &status, &authors, &tags, &pubYear, &originalTitle, &publisher, &publishedAt, &isbn,
		)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			s.ThumbnailPath = &thumbnail.String
		}
		if ext.Valid {
			s.Extension = ext.String
		}

		m.SeriesID = s.ID
		if desc.Valid {
			s.Description = desc.String
			m.Description = desc.String
		}
		if isBookmarked.Valid {
			s.IsBookmarked = isBookmarked.Bool
			m.IsBookmarked = isBookmarked.Bool
		}
		if status.Valid {
			m.Status = status.String
		}
		if authors.Valid {
			m.Authors = authors.String
		}
		if tags.Valid {
			m.Tags = tags.String
		}
		if pubYear.Valid {
			m.PublicationYear = pubYear.String
		}
		if originalTitle.Valid {
			m.OriginalTitle = originalTitle.String
		}
		if publisher.Valid {
			m.Publisher = publisher.String
		}
		if publishedAt.Valid {
			m.PublishedAt = publishedAt.String
		}
		if isbn.Valid {
			m.ISBN = isbn.String
		}
		s.Metadata = &m

		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

// UpdateExtension 시리즈의 확장자 정보만 업데이트
func (r *SeriesRepository) UpdateExtension(db database.Queryer, seriesID string, extension string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		"UPDATE series SET extension = ? WHERE id = ?",
		extension, seriesID,
	)
	return err
}

// GetExtensionsByIDs 여러 시리즈의 확장자 정보 조회
func (r *SeriesRepository) GetExtensionsByIDs(db database.Queryer, ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return make(map[string]string), nil
	}
	db = database.GetQueryer(db)

	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := "SELECT id, extension FROM series WHERE id IN (" + strings.Join(placeholders, ",") + ")"
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	results := make(map[string]string)
	for rows.Next() {
		var id, ext string
		if err := rows.Scan(&id, &ext); err != nil {
			return nil, err
		}
		results[id] = ext
	}
	return results, nil
}
