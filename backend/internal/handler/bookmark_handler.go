package handler

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type BookmarkHandler struct {
	bookmarkRepo *repository.BookmarkRepository
	seriesRepo   *repository.SeriesRepository
	volumeRepo   *repository.VolumeRepository
	chapterRepo  *repository.ChapterRepository
	authService  *service.AuthService
}

var (
	errBookmarkSeriesNotFound    = errors.New("series not found")
	errBookmarkAccessDenied      = errors.New("access denied")
	errBookmarkPermissionFailure = errors.New("permission check failed")
)

func NewBookmarkHandler(
	bookmarkRepo *repository.BookmarkRepository,
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	authService *service.AuthService,
) *BookmarkHandler {
	return &BookmarkHandler{
		bookmarkRepo: bookmarkRepo,
		seriesRepo:   seriesRepo,
		volumeRepo:   volumeRepo,
		chapterRepo:  chapterRepo,
		authService:  authService,
	}
}

type CreateBookmarkRequest struct {
	SeriesID        string   `json:"series_id"`
	VolumeID        *string  `json:"volume_id,omitempty"`
	ChapterID       *string  `json:"chapter_id,omitempty"`
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	PageNumber      int      `json:"page_number"`
	CurrentPosition int      `json:"current_position"`
	CurrentCFI      *string  `json:"current_cfi,omitempty"`
	CurrentTime     *float64 `json:"current_time,omitempty"`
}

type UpdateBookmarkRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

// checkSeriesAccess 시리즈 존재 확인 + 라이브러리 접근 권한 확인
func (h *BookmarkHandler) checkSeriesAccess(c *fiber.Ctx, seriesID, userID string) (*model.Series, error) {
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil || series == nil {
		return nil, errBookmarkSeriesNotFound
	}

	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return nil, errBookmarkPermissionFailure
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, errBookmarkAccessDenied
		}
	}

	return series, nil
}

func (h *BookmarkHandler) writeSeriesAccessError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, errBookmarkSeriesNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	case errors.Is(err, errBookmarkAccessDenied):
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
	default:
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permissions"})
	}
}

func (h *BookmarkHandler) validateBookmarkTargets(seriesID string, volumeID, chapterID *string) error {
	if chapterID != nil && *chapterID != "" {
		chapter, err := h.chapterRepo.FindByID(nil, *chapterID)
		if err != nil || chapter == nil {
			return errors.New("invalid chapter_id")
		}

		volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
		if err != nil || volume == nil {
			return errors.New("invalid chapter_id")
		}
		if volume.SeriesID != seriesID {
			return errors.New("chapter_id does not belong to series_id")
		}
		if volumeID != nil && *volumeID != "" && chapter.VolumeID != *volumeID {
			return errors.New("chapter_id does not belong to volume_id")
		}
	}

	if volumeID != nil && *volumeID != "" {
		volume, err := h.volumeRepo.FindByID(nil, *volumeID)
		if err != nil || volume == nil {
			return errors.New("invalid volume_id")
		}
		if volume.SeriesID != seriesID {
			return errors.New("volume_id does not belong to series_id")
		}
	}

	return nil
}

// CreateBookmark 새 북마크 생성
// POST /api/v1/bookmarks
func (h *BookmarkHandler) CreateBookmark(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	var req CreateBookmarkRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.SeriesID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "series_id is required"})
	}

	// 시리즈 존재 + 라이브러리 접근 권한 확인
	if _, err := h.checkSeriesAccess(c, req.SeriesID, userID); err != nil {
		return h.writeSeriesAccessError(c, err)
	}
	if err := h.validateBookmarkTargets(req.SeriesID, req.VolumeID, req.ChapterID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	bookmark := &model.Bookmark{
		UserID:          userID,
		SeriesID:        req.SeriesID,
		VolumeID:        req.VolumeID,
		ChapterID:       req.ChapterID,
		Title:           req.Title,
		Description:     req.Description,
		PageNumber:      req.PageNumber,
		CurrentPosition: req.CurrentPosition,
		CurrentCFI:      req.CurrentCFI,
		CurrentTime:     req.CurrentTime,
		CreatedAt:       time.Now(),
	}

	if err := h.bookmarkRepo.Create(nil, bookmark); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create bookmark"})
	}

	return c.Status(fiber.StatusCreated).JSON(bookmark)
}

// ListBySeries 시리즈별 북마크 목록 조회
// GET /api/v1/bookmarks/series/:seriesId
func (h *BookmarkHandler) ListBySeries(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	// 시리즈 존재 + 라이브러리 접근 권한 확인
	if _, err := h.checkSeriesAccess(c, seriesID, userID); err != nil {
		return h.writeSeriesAccessError(c, err)
	}

	bookmarks, err := h.bookmarkRepo.FindByUserAndSeries(nil, userID, seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch bookmarks"})
	}

	if bookmarks == nil {
		bookmarks = []*model.Bookmark{}
	}

	return c.JSON(fiber.Map{"bookmarks": bookmarks})
}

// UpdateBookmark 북마크 수정
// PUT /api/v1/bookmarks/:id
func (h *BookmarkHandler) UpdateBookmark(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	id := c.Params("id")

	var req UpdateBookmarkRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	bookmark, err := h.bookmarkRepo.FindByID(nil, id)
	if err != nil || bookmark == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "bookmark not found"})
	}

	if bookmark.UserID != userID {
		// 북마크 ID 존재 여부 노출 방지를 위해 404로 통일
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "bookmark not found"})
	}

	bookmark.Title = req.Title
	bookmark.Description = req.Description

	if err := h.bookmarkRepo.Update(nil, bookmark); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update bookmark"})
	}

	return c.JSON(bookmark)
}

// DeleteBookmark 북마크 삭제
// DELETE /api/v1/bookmarks/:id
func (h *BookmarkHandler) DeleteBookmark(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	id := c.Params("id")

	// 존재 여부 + 소유권 확인
	bookmark, err := h.bookmarkRepo.FindByID(nil, id)
	if err != nil || bookmark == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "bookmark not found"})
	}
	if bookmark.UserID != userID {
		// 북마크 ID 존재 여부 노출 방지를 위해 404로 통일
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "bookmark not found"})
	}

	if err := h.bookmarkRepo.Delete(nil, id, userID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete bookmark"})
	}

	return c.JSON(fiber.Map{"message": "bookmark deleted"})
}
