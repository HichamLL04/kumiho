package handler

import (
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
	authService  *service.AuthService
}

func NewBookmarkHandler(
	bookmarkRepo *repository.BookmarkRepository,
	seriesRepo *repository.SeriesRepository,
	authService *service.AuthService,
) *BookmarkHandler {
	return &BookmarkHandler{
		bookmarkRepo: bookmarkRepo,
		seriesRepo:   seriesRepo,
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
		return nil, c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return nil, c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permissions"})
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
		}
	}

	return series, nil
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
		return nil // checkSeriesAccess가 이미 응답을 보냄
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
		return nil
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
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
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
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
	}

	if err := h.bookmarkRepo.Delete(nil, id, userID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete bookmark"})
	}

	return c.JSON(fiber.Map{"message": "bookmark deleted"})
}
