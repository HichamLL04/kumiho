package handler

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/mattn/go-sqlite3"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

const (
	libraryDeleteActiveScanErrorCode = "library_delete_active_scan"
	libraryDeleteBusyErrorCode       = "library_delete_busy"
	libraryDeleteInProgressErrorCode = "library_delete_in_progress"
	libraryDeleteFailedErrorCode     = "library_delete_failed"
	libraryDeleteSystemErrorCode     = "library_delete_system_library"
)

type LibraryHandler struct {
	libraryRepo           *repository.LibraryRepository
	authService           *service.AuthService
	scanner               *scanner.Scanner
	appCtx                context.Context
	seriesRepo            *repository.SeriesRepository
	volumeRepo            *repository.VolumeRepository
	chapterRepo           *repository.ChapterRepository
	chapterCompletionRepo *repository.ChapterCompletionRepository
}

func NewLibraryHandler(
	appCtx context.Context,
	libraryRepo *repository.LibraryRepository,
	authService *service.AuthService,
	scanner *scanner.Scanner,
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	chapterCompletionRepo *repository.ChapterCompletionRepository,
) *LibraryHandler {
	return &LibraryHandler{
		libraryRepo:           libraryRepo,
		authService:           authService,
		scanner:               scanner,
		appCtx:                appCtx,
		seriesRepo:            seriesRepo,
		volumeRepo:            volumeRepo,
		chapterRepo:           chapterRepo,
		chapterCompletionRepo: chapterCompletionRepo,
	}
}

// CreateLibraryRequest 라이브러리 생성 요청
type CreateLibraryRequest struct {
	Name                         string   `json:"name"`
	Paths                        []string `json:"paths"`
	DefaultViewMode              string   `json:"default_view_mode"`
	DefaultReadDirection         string   `json:"default_read_direction"`
	DefaultPageTransition        string   `json:"default_page_transition"`
	DefaultEpubRenderMode        string   `json:"default_epub_render_mode"`
	DefaultEpubTheme             string   `json:"default_epub_theme"`
	DefaultEpubSpread            string   `json:"default_epub_spread"`
	DefaultEpubWheelDirection    string   `json:"default_epub_wheel_direction"`
	DefaultEpubKeyboardDirection string   `json:"default_epub_keyboard_direction"`
	DefaultEpubClickDirection    string   `json:"default_epub_click_direction"`
	LibraryType                  string   `json:"library_type"`
	ScanExcludes                 string   `json:"scan_excludes"`
	OriginalTitleOverride        bool     `json:"original_title_override"`
}

func normalizeLibraryType(value string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "book", true
	}
	switch normalized {
	case "book", "audiobook", "comic", "novel":
		return normalized, true
	default:
		return "", false
	}
}

func validateLibraryPaths(paths []string, checkExists func(string) (bool, error)) ([]string, error) {
	seen := make(map[string]struct{}, len(paths))
	normalizedPaths := make([]string, 0, len(paths))
	for _, rawPath := range paths {
		path := strings.TrimSpace(rawPath)
		if path == "" {
			return nil, fiber.NewError(fiber.StatusBadRequest, "empty path is not allowed")
		}

		cleanPath := filepath.Clean(path)
		absPath, err := filepath.Abs(cleanPath)
		if err != nil {
			return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to normalize path: "+cleanPath)
		}
		if !filepath.IsAbs(absPath) {
			return nil, fiber.NewError(fiber.StatusBadRequest, "only absolute paths are allowed: "+absPath)
		}

		info, err := os.Stat(absPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, fiber.NewError(fiber.StatusBadRequest, "path does not exist: "+absPath)
			}
			return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to access path: "+absPath)
		}
		if !info.IsDir() {
			return nil, fiber.NewError(fiber.StatusBadRequest, "path is not a directory: "+absPath)
		}

		resolvedPath, err := filepath.EvalSymlinks(absPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, fiber.NewError(fiber.StatusBadRequest, "path does not exist: "+absPath)
			}
			return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to resolve path: "+absPath)
		}
		resolvedPath = filepath.Clean(resolvedPath)

		if _, ok := seen[resolvedPath]; ok {
			return nil, fiber.NewError(fiber.StatusBadRequest, "duplicate path is not allowed: "+resolvedPath)
		}
		seen[resolvedPath] = struct{}{}

		exists, err := checkExists(resolvedPath)
		if err != nil {
			return nil, fiber.NewError(fiber.StatusInternalServerError, "failed to check existing library")
		}
		if exists {
			return nil, fiber.NewError(fiber.StatusConflict, "path already belongs to another library: "+resolvedPath)
		}

		normalizedPaths = append(normalizedPaths, resolvedPath)
	}

	return normalizedPaths, nil
}

func areNestedLibraryPaths(pathA, pathB string) bool {
	if pathA == pathB {
		return false
	}
	return strings.HasPrefix(pathA, pathB+string(os.PathSeparator)) ||
		strings.HasPrefix(pathB, pathA+string(os.PathSeparator))
}

func validateNoNestedLibraryPaths(paths []string, libraries []model.Library, excludeLibraryID string) error {
	for i := 0; i < len(paths); i++ {
		for j := i + 1; j < len(paths); j++ {
			if areNestedLibraryPaths(paths[i], paths[j]) {
				return fiber.NewError(fiber.StatusBadRequest, "nested library paths are not allowed: "+paths[i]+" and "+paths[j])
			}
		}
	}

	for _, lib := range libraries {
		if lib.ID == excludeLibraryID {
			continue
		}
		for _, existingPath := range lib.Paths {
			for _, path := range paths {
				if areNestedLibraryPaths(path, existingPath) {
					return fiber.NewError(fiber.StatusBadRequest, "nested library paths are not allowed: "+path+" and "+existingPath)
				}
			}
		}
	}

	return nil
}

// List 모든 라이브러리 목록
// GET /api/v1/libraries
func (h *LibraryHandler) List(c *fiber.Ctx) error {
	libraries, err := h.libraryRepo.FindAll(nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch libraries",
		})
	}

	if libraries == nil {
		libraries = []model.Library{}
	}

	// MASTER가 아니면 접근 가능한 라이브러리만 필터링
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		userID := middleware.GetUserID(c)
		allowedIDs, err := h.authService.GetAllowedLibraryIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}

		// ID 맵 생성 (빠른 검색용)
		allowedMap := make(map[string]bool)
		for _, id := range allowedIDs {
			allowedMap[id] = true
		}

		var filtered []model.Library
		for _, lib := range libraries {
			if allowedMap[lib.ID] || lib.Type == "SYSTEM" {
				filtered = append(filtered, lib)
			}
		}
		libraries = filtered
	}

	return c.JSON(fiber.Map{
		"libraries": libraries,
	})
}

// Create 새 라이브러리 생성
// POST /api/v1/libraries
func (h *LibraryHandler) Create(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	var req CreateLibraryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Name == "" || len(req.Paths) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "name and at least one path are required",
		})
	}
	libraryType, ok := normalizeLibraryType(req.LibraryType)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid library_type",
		})
	}

	normalizedPaths, err := validateLibraryPaths(req.Paths, func(path string) (bool, error) {
		return h.libraryRepo.PathExists(nil, path, "")
	})
	if err != nil {
		if fiberErr, ok := err.(*fiber.Error); ok {
			return c.Status(fiberErr.Code).JSON(fiber.Map{
				"error": fiberErr.Message,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to validate library paths",
		})
	}
	libraries, err := h.libraryRepo.FindAll(nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to check existing libraries",
		})
	}
	if err := validateNoNestedLibraryPaths(normalizedPaths, libraries, ""); err != nil {
		if fiberErr, ok := err.(*fiber.Error); ok {
			return c.Status(fiberErr.Code).JSON(fiber.Map{
				"error": fiberErr.Message,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to validate nested library paths",
		})
	}
	req.Paths = normalizedPaths

	// 유효성 검사
	if req.DefaultViewMode != "" {
		switch req.DefaultViewMode {
		case "single", "double", "vertical":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_view_mode",
			})
		}
	}
	if req.DefaultReadDirection != "" {
		switch req.DefaultReadDirection {
		case "ltr", "rtl":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_read_direction",
			})
		}
	}
	if req.DefaultEpubRenderMode != "" {
		switch req.DefaultEpubRenderMode {
		case "auto", "book", "comic":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_epub_render_mode",
			})
		}
	}
	if req.DefaultEpubTheme != "" {
		switch req.DefaultEpubTheme {
		case "light", "dark", "sepia":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_epub_theme",
			})
		}
	}
	if req.DefaultEpubSpread != "" {
		switch req.DefaultEpubSpread {
		case "auto", "none":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_epub_spread",
			})
		}
	}
	if req.DefaultEpubWheelDirection != "" {
		switch req.DefaultEpubWheelDirection {
		case "down", "up":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_epub_wheel_direction",
			})
		}
	}
	if req.DefaultEpubKeyboardDirection != "" {
		switch req.DefaultEpubKeyboardDirection {
		case "right", "left":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_epub_keyboard_direction",
			})
		}
	}
	if req.DefaultEpubClickDirection != "" {
		switch req.DefaultEpubClickDirection {
		case "right", "left":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_epub_click_direction",
			})
		}
	}

	if req.ScanExcludes != "" {
		if err := validateScanExcludes(req.ScanExcludes); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":   "invalid scan_excludes pattern",
				"details": err.Error(),
			})
		}
	}

	// 기본값 보정: 요청에서 생략된 EPUB 기본 설정은 서버 기본값으로 채운다.
	// (빈 문자열을 그대로 저장하면 스키마 DEFAULT가 동작하지 않기 때문)
	if req.DefaultEpubRenderMode == "" {
		req.DefaultEpubRenderMode = "auto"
	}
	if req.DefaultEpubTheme == "" {
		req.DefaultEpubTheme = "light"
	}
	if req.DefaultEpubSpread == "" {
		req.DefaultEpubSpread = "auto"
	}
	if req.DefaultEpubWheelDirection == "" {
		req.DefaultEpubWheelDirection = "down"
	}
	if req.DefaultEpubKeyboardDirection == "" {
		req.DefaultEpubKeyboardDirection = "right"
	}
	if req.DefaultEpubClickDirection == "" {
		req.DefaultEpubClickDirection = "right"
	}

	library := &model.Library{
		Name:                   req.Name,
		Paths:                  req.Paths,
		DefaultViewMode:        req.DefaultViewMode,
		DefaultReadDirection:   req.DefaultReadDirection,
		DefaultPageTransition:  req.DefaultPageTransition,
		DefaultEpubRenderMode:  req.DefaultEpubRenderMode,
		DefaultEpubTheme:       req.DefaultEpubTheme,
		DefaultEpubSpread:      req.DefaultEpubSpread,
		DefaultEpubWheelDir:    req.DefaultEpubWheelDirection,
		DefaultEpubKeyboardDir: req.DefaultEpubKeyboardDirection,
		DefaultEpubClickDir:    req.DefaultEpubClickDirection,
		Type:                   "LOCAL",
		LibraryType:            libraryType,
		ScanExcludes:           req.ScanExcludes,
		OriginalTitleOverride:  req.OriginalTitleOverride,
	}

	if err := h.libraryRepo.Create(nil, library); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create library",
		})
	}

	// 실시간 감시 추가 (LOCAL 타입인 경우)
	if library.Type == "LOCAL" {
		for _, p := range library.Paths {
			_ = h.scanner.AddLibraryWatch(library.ID, p)
		}
	}

	// 자동 스캔 트리거 (비동기)
	go func(lib *model.Library) {
		log.Printf("Starting automatic scan for new library: %s (%s)", lib.Name, lib.ID)
		// AppContext를 사용하여 서버 종료 시 스캔 중단
		if _, err := h.scanner.ScanLibrary(h.appCtx, lib); err != nil {
			log.Printf("Failed to automatically scan library %s: %v", lib.ID, err)
		} else {
			log.Printf("Automatic scan completed for library: %s", lib.Name)
		}
	}(library)

	return c.Status(fiber.StatusCreated).JSON(library)
}

// Get 라이브러리 상세
// GET /api/v1/libraries/:id
func (h *LibraryHandler) Get(c *fiber.Ctx) error {
	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(nil, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	// MASTER가 아니면 접근 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster && library.Type != "SYSTEM" {
		userID := middleware.GetUserID(c)
		allowedIDs, err := h.authService.GetAllowedLibraryIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}

		allowed := false
		for _, aid := range allowedIDs {
			if aid == library.ID {
				allowed = true
				break
			}
		}

		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "access denied",
			})
		}
	}

	return c.JSON(library)
}

// Scan 라이브러리 스캔
// POST /api/v1/libraries/:id/scan
func (h *LibraryHandler) Scan(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(nil, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	result, err := h.scanner.ScanLibrary(h.appCtx, library)
	if err != nil {
		if err == scanner.ErrAlreadyScanning {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "scan already in progress",
			})
		}
		if errors.Is(err, scanner.ErrLibraryDeleting) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":      "library delete is in progress",
				"error_code": libraryDeleteInProgressErrorCode,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "failed to scan library",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"message": "scan completed",
		"result":  result,
	})
}

// ScanAll 모든 라이브러리 스캔
// POST /api/v1/libraries/scan
func (h *LibraryHandler) ScanAll(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	libraries, err := h.libraryRepo.FindAll(nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch libraries",
		})
	}

	triggered := 0
	for _, lib := range libraries {
		if lib.Type == "SYSTEM" {
			continue
		}

		// 각 라이브러리 스캔은 별도 고루틴에서 비동기 실행 (세마포어로 제어됨)
		go func(l model.Library) {
			if _, err := h.scanner.ScanLibrary(h.appCtx, &l); err != nil {
				// 에러 로그는 ScanLibrary 내부에서 처리됨 (상태 업데이트 등)
				if err != scanner.ErrAlreadyScanning {
					log.Printf("Manual full scan error for library %s: %v", l.Name, err)
				}
			}
		}(lib)
		triggered++
	}

	return c.JSON(fiber.Map{
		"message":   "scan triggered for all libraries",
		"triggered": triggered,
	})
}

// CancelScan 라이브러리 스캔 취소
// POST /api/v1/libraries/:id/scan/cancel
func (h *LibraryHandler) CancelScan(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")
	if h.scanner.CancelScan(id) {
		return c.JSON(fiber.Map{
			"message": "scan cancellation requested",
		})
	}

	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
		"error": "no active scan found for this library",
	})
}

// Delete 라이브러리 삭제
// DELETE /api/v1/libraries/:id
func (h *LibraryHandler) Delete(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(nil, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	if library.Type == "SYSTEM" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":      "system libraries cannot be deleted",
			"error_code": libraryDeleteSystemErrorCode,
		})
	}

	if h.scanner != nil {
		if !h.scanner.BeginLibraryDelete(id) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":      "library delete is already in progress",
				"error_code": libraryDeleteInProgressErrorCode,
			})
		}
		defer h.scanner.EndLibraryDelete(id)

		if h.scanner.IsScanning(id) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":      "library scan is in progress",
				"error_code": libraryDeleteActiveScanErrorCode,
			})
		}
	}

	if err := h.libraryRepo.Delete(nil, id); err != nil {
		log.Printf("Failed to delete library %s: %v", id, err)
		if isDatabaseBusyError(err) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error":      "database is busy",
				"error_code": libraryDeleteBusyErrorCode,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":      "failed to delete library",
			"error_code": libraryDeleteFailedErrorCode,
		})
	}

	// 실시간 감시 제거
	if h.scanner != nil {
		h.scanner.RemoveLibraryWatch(id)
	}

	return c.JSON(fiber.Map{
		"message": "library deleted",
	})
}

func isDatabaseBusyError(err error) bool {
	if err == nil {
		return false
	}
	var sqliteErr sqlite3.Error
	if errors.As(err, &sqliteErr) {
		return sqliteErr.Code == sqlite3.ErrBusy || sqliteErr.Code == sqlite3.ErrLocked
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") ||
		strings.Contains(message, "database table is locked") ||
		strings.Contains(message, "database is busy") ||
		strings.Contains(message, "sqlite_busy")
}

// UpdateLibraryRequest 라이브러리 수정 요청
type UpdateLibraryRequest struct {
	Name                         string    `json:"name"`
	Paths                        *[]string `json:"paths,omitempty"`
	DefaultViewMode              string    `json:"default_view_mode"`
	DefaultReadDirection         string    `json:"default_read_direction"`
	DefaultPageTransition        string    `json:"default_page_transition"`
	DefaultEpubRenderMode        string    `json:"default_epub_render_mode"`
	DefaultEpubTheme             string    `json:"default_epub_theme"`
	DefaultEpubSpread            string    `json:"default_epub_spread"`
	DefaultEpubWheelDirection    string    `json:"default_epub_wheel_direction"`
	DefaultEpubKeyboardDirection string    `json:"default_epub_keyboard_direction"`
	DefaultEpubClickDirection    string    `json:"default_epub_click_direction"`
	LibraryType                  string    `json:"library_type"`
	IsVisible                    *bool     `json:"is_visible"` // Optional, pointer to distinguish false vs missing
	ScanExcludes                 *string   `json:"scan_excludes"`
	OriginalTitleOverride        *bool     `json:"original_title_override"`
}

// Update 라이브러리 수정
// PUT /api/v1/libraries/:id
func (h *LibraryHandler) Update(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")
	var req UpdateLibraryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	library, err := h.libraryRepo.FindByID(nil, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	pathsChanged := false

	// SYSTEM 라이브러리는 가시성 외의 수정 불가
	if library.Type == "SYSTEM" {
		if req.Name != "" || req.Paths != nil || req.DefaultViewMode != "" || req.DefaultReadDirection != "" ||
			req.DefaultPageTransition != "" || req.DefaultEpubRenderMode != "" || req.DefaultEpubTheme != "" ||
			req.DefaultEpubSpread != "" || req.DefaultEpubWheelDirection != "" || req.DefaultEpubKeyboardDirection != "" ||
			req.DefaultEpubClickDirection != "" || req.OriginalTitleOverride != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "system libraries cannot use name, paths, or default settings",
			})
		}
		if req.IsVisible != nil {
			library.IsVisible = *req.IsVisible
		}
	} else {
		// 일반 라이브러리 수정
		pendingLibrary := *library
		var pendingPaths *[]string

		if req.Name != "" {
			pendingLibrary.Name = req.Name
		}

		// 경로 변경
		if req.Paths != nil {
			if len(*req.Paths) == 0 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "at least one path is required when updating paths",
				})
			}

			normalizedPaths, err := validateLibraryPaths(*req.Paths, func(path string) (bool, error) {
				return h.libraryRepo.PathExists(nil, path, library.ID)
			})
			if err != nil {
				if fiberErr, ok := err.(*fiber.Error); ok {
					return c.Status(fiberErr.Code).JSON(fiber.Map{
						"error": fiberErr.Message,
					})
				}
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "failed to validate paths",
				})
			}
			libraries, err := h.libraryRepo.FindAll(nil)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "failed to check existing libraries",
				})
			}
			if err := validateNoNestedLibraryPaths(normalizedPaths, libraries, library.ID); err != nil {
				if fiberErr, ok := err.(*fiber.Error); ok {
					return c.Status(fiberErr.Code).JSON(fiber.Map{
						"error": fiberErr.Message,
					})
				}
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "failed to validate nested library paths",
				})
			}
			pendingPaths = &normalizedPaths
			pendingLibrary.Paths = normalizedPaths
			pathsChanged = true
		}

		if req.DefaultViewMode != "" {
			switch req.DefaultViewMode {
			case "single", "double", "vertical":
				pendingLibrary.DefaultViewMode = req.DefaultViewMode
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_view_mode",
				})
			}
		}
		if req.DefaultReadDirection != "" {
			switch req.DefaultReadDirection {
			case "ltr", "rtl":
				pendingLibrary.DefaultReadDirection = req.DefaultReadDirection
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_read_direction",
				})
			}
		}
		if req.DefaultPageTransition != "" {
			switch req.DefaultPageTransition {
			case "none", "fade", "slide":
				pendingLibrary.DefaultPageTransition = req.DefaultPageTransition
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_page_transition",
				})
			}
		}
		if req.DefaultEpubRenderMode != "" {
			switch req.DefaultEpubRenderMode {
			case "auto", "book", "comic":
				pendingLibrary.DefaultEpubRenderMode = req.DefaultEpubRenderMode
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_epub_render_mode",
				})
			}
		}
		if req.DefaultEpubTheme != "" {
			switch req.DefaultEpubTheme {
			case "light", "dark", "sepia":
				pendingLibrary.DefaultEpubTheme = req.DefaultEpubTheme
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_epub_theme",
				})
			}
		}
		if req.DefaultEpubSpread != "" {
			switch req.DefaultEpubSpread {
			case "auto", "none":
				pendingLibrary.DefaultEpubSpread = req.DefaultEpubSpread
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_epub_spread",
				})
			}
		}
		if req.DefaultEpubWheelDirection != "" {
			switch req.DefaultEpubWheelDirection {
			case "down", "up":
				pendingLibrary.DefaultEpubWheelDir = req.DefaultEpubWheelDirection
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_epub_wheel_direction",
				})
			}
		}
		if req.DefaultEpubKeyboardDirection != "" {
			switch req.DefaultEpubKeyboardDirection {
			case "right", "left":
				pendingLibrary.DefaultEpubKeyboardDir = req.DefaultEpubKeyboardDirection
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_epub_keyboard_direction",
				})
			}
		}
		if req.DefaultEpubClickDirection != "" {
			switch req.DefaultEpubClickDirection {
			case "right", "left":
				pendingLibrary.DefaultEpubClickDir = req.DefaultEpubClickDirection
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_epub_click_direction",
				})
			}
		}
		if req.LibraryType != "" {
			libraryType, ok := normalizeLibraryType(req.LibraryType)
			if !ok {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid library_type",
				})
			}
			pendingLibrary.LibraryType = libraryType
		}
		if req.IsVisible != nil {
			pendingLibrary.IsVisible = *req.IsVisible
		}
		if req.ScanExcludes != nil {
			if *req.ScanExcludes != "" {
				if err := validateScanExcludes(*req.ScanExcludes); err != nil {
					return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
						"error":   "invalid scan_excludes pattern",
						"details": err.Error(),
					})
				}
			}
			pendingLibrary.ScanExcludes = *req.ScanExcludes
		}
		overrideChanged := false
		if req.OriginalTitleOverride != nil {
			overrideChanged = pendingLibrary.OriginalTitleOverride != *req.OriginalTitleOverride
			pendingLibrary.OriginalTitleOverride = *req.OriginalTitleOverride
		}

		tx, err := database.DB.BeginTx(c.Context(), nil)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to start library update transaction",
			})
		}
		defer func() { _ = tx.Rollback() }()

		if err := h.libraryRepo.UpdateWithPaths(tx, &pendingLibrary, pendingPaths); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to update library",
			})
		}
		if overrideChanged {
			if err := h.scanner.NormalizeStoredSeriesTitlesForLibraryWithTx(tx, pendingLibrary.ID); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "failed to apply original title override",
				})
			}
		}
		if err := tx.Commit(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to commit library update",
			})
		}
		*library = pendingLibrary
	}

	if library.Type == "SYSTEM" {
		if err := h.libraryRepo.Update(nil, library); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to update library",
			})
		}
	}

	if library.Type == "LOCAL" && pathsChanged {
		h.scanner.RemoveLibraryWatch(library.ID)
		for _, path := range library.Paths {
			if err := h.scanner.AddLibraryWatch(library.ID, path); err != nil {
				log.Printf("Failed to refresh watch for library %s (%s): %v", library.Name, path, err)
			}
		}
	}

	return c.JSON(library)
}

// UpdateOrder 라이브러리 정렬 순서 업데이트
// PUT /api/v1/libraries/order
func (h *LibraryHandler) UpdateOrder(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	var req []string
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body, expected an array of strings",
		})
	}

	// 입력 검증: 전체 라이브러리 개수와 일치하는지 확인 (선택적이지만 권장)
	libraries, err := h.libraryRepo.FindAll(nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch existing libraries",
		})
	}

	if len(req) != len(libraries) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "request body must contain all library IDs",
			"detail": fiber.Map{
				"expected": len(libraries),
				"received": len(req),
			},
		})
	}

	// ID 유효성 및 중복 검사
	orders := make(map[string]int)
	existingIDs := make(map[string]bool)
	for _, lib := range libraries {
		existingIDs[lib.ID] = true
	}

	for i, id := range req {
		if !existingIDs[id] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":      "invalid library id",
				"library_id": id,
			})
		}
		if _, exists := orders[id]; exists {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":      "duplicate library id in request",
				"library_id": id,
			})
		}
		orders[id] = i
	}

	if err := h.libraryRepo.UpdateOrder(nil, orders); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update library order",
		})
	}

	return c.JSON(fiber.Map{
		"message": "library order updated",
	})
}

func validateScanExcludes(excludes string) error {
	patterns := strings.Split(excludes, ",")
	for _, p := range patterns {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := filepath.Match(p, "test"); err != nil {
			return err
		}
	}
	return nil
}

// CleanupChapters deletes chapter files for all volumes in a library except for the last 3 unread chapters per volume.
// POST /api/v1/libraries/:libraryId/cleanup-chapters
func (h *LibraryHandler) CleanupChapters(c *fiber.Ctx) error {
	libraryID := c.Params("id")
	userID := middleware.GetUserID(c)
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	// 1. Fetch library
	library, err := h.libraryRepo.FindByID(nil, libraryID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	// 2. Fetch all series in this library
	seriesList, err := h.seriesRepo.FindByLibraryID(nil, libraryID, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series for library",
		})
	}

	totalDeleted := 0

	// 3. Loop through series
	for _, series := range seriesList {
		// Fetch all chapters for this series (sorted in reading order)
		chapters, err := h.chapterRepo.FindBySeriesID(nil, series.ID)
		if err != nil {
			log.Printf("Library cleanup: failed to fetch chapters for series %s: %v", series.ID, err)
			continue
		}

		// Fetch user's completed chapters for the entire series
		completedMap, err := h.chapterCompletionRepo.FindCompletedChapterIDsBySeries(nil, userID, series.ID)
		if err != nil {
			log.Printf("Library cleanup: failed to fetch completed chapters for series %s: %v", series.ID, err)
			continue
		}

		// Keep all unread chapters, and keep the last 3 read chapters of the series.
		var readChapters []model.Chapter
		keepIDs := make(map[string]bool)
		for _, ch := range chapters {
			if !completedMap[ch.ID] {
				keepIDs[ch.ID] = true
			} else {
				readChapters = append(readChapters, ch)
			}
		}

		readLen := len(readChapters)
		if readLen > 3 {
			for i := readLen - 3; i < readLen; i++ {
				keepIDs[readChapters[i].ID] = true
			}
		} else {
			for _, ch := range readChapters {
				keepIDs[ch.ID] = true
			}
		}

		// Fetch all volumes for this series to get their paths for the safety check
		volumes, err := h.volumeRepo.FindBySeriesID(nil, series.ID)
		if err != nil {
			log.Printf("Library cleanup: failed to fetch volumes for series %s: %v", series.ID, err)
			continue
		}

		protectedPaths := map[string]bool{
			series.Path: true,
		}
		for _, vol := range volumes {
			protectedPaths[vol.Path] = true
		}

		// Delete other chapters (both files and DB records)
		tx, err := database.DB.BeginTx(ctx, nil)
		if err != nil {
			log.Printf("Library cleanup: failed to start tx for series %s: %v", series.ID, err)
			continue
		}

		seriesDeletedCount := 0
		failed := false
		for _, ch := range chapters {
			if keepIDs[ch.ID] {
				continue
			}

			// Safety check to ensure we don't delete the whole volume or series folder
			if ch.Path != "" && !protectedPaths[ch.Path] {
				if removeErr := os.RemoveAll(ch.Path); removeErr != nil {
					log.Printf("Library cleanup: Failed to delete chapter file %s: %v", ch.Path, removeErr)
				}
			}

			// Delete from database
			_, dbErr := tx.Exec(`DELETE FROM chapters WHERE id = ?`, ch.ID)
			if dbErr != nil {
				log.Printf("Library cleanup: Failed to delete chapter %s from DB: %v", ch.Title, dbErr)
				_ = tx.Rollback()
				failed = true
				break
			}
			seriesDeletedCount++
		}

		if failed {
			continue
		}

		// Update chapter count for all volumes in this series
		if _, countErr := tx.Exec(`UPDATE volumes SET chapter_count = (SELECT COUNT(*) FROM chapters WHERE volume_id = volumes.id) WHERE series_id = ?`, series.ID); countErr != nil {
			log.Printf("Library cleanup: Failed to update volume chapter counts for series %s: %v", series.ID, countErr)
			_ = tx.Rollback()
			continue
		}

		if err := tx.Commit(); err != nil {
			log.Printf("Library cleanup: Failed to commit tx for series %s: %v", series.ID, err)
			continue
		}

		totalDeleted += seriesDeletedCount
	}

	return c.JSON(fiber.Map{
		"message":      fmt.Sprintf("Successfully deleted %d chapters across library", totalDeleted),
		"deletedCount": totalDeleted,
	})
}
