package handler

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type FilesystemHandler struct{}

var (
	quickPathsCacheMu        sync.RWMutex
	quickPathsCache          []DirectoryEntry
	quickPathsCacheExpiresAt time.Time
)

const quickPathsCacheTTL = 30 * time.Second

func NewFilesystemHandler() *FilesystemHandler {
	return &FilesystemHandler{}
}

type DirectoryEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func filesystemErrorStatus(err error) (int, string) {
	switch {
	case os.IsNotExist(err):
		return fiber.StatusNotFound, "path does not exist"
	case os.IsPermission(err):
		return fiber.StatusForbidden, "permission denied"
	default:
		return fiber.StatusInternalServerError, "failed to access path"
	}
}

func shouldSkipDirectory(name string) bool {
	hiddenPrefixes := []string{".", "@", "#"}
	for _, prefix := range hiddenPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

func listQuickPaths() []DirectoryEntry {
	now := time.Now()
	quickPathsCacheMu.RLock()
	if now.Before(quickPathsCacheExpiresAt) {
		cached := append(make([]DirectoryEntry, 0, len(quickPathsCache)), quickPathsCache...)
		quickPathsCacheMu.RUnlock()
		return cached
	}
	quickPathsCacheMu.RUnlock()

	rootEntries, err := os.ReadDir("/")
	if err != nil {
		return make([]DirectoryEntry, 0)
	}

	systemDirs := map[string]bool{
		"bin": true, "boot": true, "dev": true, "etc": true, "lib": true, "lib64": true,
		"proc": true, "root": true, "run": true, "sbin": true, "srv": true, "sys": true,
		"tmp": true, "usr": true, "var": true, "lost+found": true,
		"bin.usr-is-merged": true, "lib.usr-is-merged": true,
	}

	quickPaths := make([]DirectoryEntry, 0)
	for _, entry := range rootEntries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if shouldSkipDirectory(name) || systemDirs[name] {
			continue
		}
		quickPaths = append(quickPaths, DirectoryEntry{
			Name: name,
			Path: filepath.Join("/", name),
		})
	}

	sort.Slice(quickPaths, func(i, j int) bool {
		return strings.ToLower(quickPaths[i].Name) < strings.ToLower(quickPaths[j].Name)
	})

	quickPathsCacheMu.Lock()
	quickPathsCache = append(make([]DirectoryEntry, 0, len(quickPaths)), quickPaths...)
	quickPathsCacheExpiresAt = now.Add(quickPathsCacheTTL)
	quickPathsCacheMu.Unlock()

	return quickPaths
}

// Browse 디렉토리 목록 조회
// GET /api/v1/filesystem?path=/
func (h *FilesystemHandler) Browse(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	dirPath := c.Query("path", "/")

	// 경로 정리 (traversal 방지)
	dirPath = filepath.Clean(dirPath)
	if !filepath.IsAbs(dirPath) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "absolute path required",
		})
	}

	// 심볼릭 링크 해석 후 실제 경로 확인
	realPath, err := filepath.EvalSymlinks(dirPath)
	if err != nil {
		status, message := filesystemErrorStatus(err)
		return c.Status(status).JSON(fiber.Map{
			"error": message,
		})
	}

	info, err := os.Stat(realPath)
	if err != nil {
		status, message := filesystemErrorStatus(err)
		return c.Status(status).JSON(fiber.Map{
			"error": message,
		})
	}
	if !info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "path is not a directory",
		})
	}

	entries, err := os.ReadDir(realPath)
	if err != nil {
		status, message := filesystemErrorStatus(err)
		return c.Status(status).JSON(fiber.Map{
			"error": message,
		})
	}

	dirs := make([]DirectoryEntry, 0)
	quickPaths := listQuickPaths()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if shouldSkipDirectory(name) {
			continue
		}

		dirs = append(dirs, DirectoryEntry{
			Name: name,
			Path: filepath.Join(dirPath, name),
		})
	}

	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})

	// 상위 디렉토리 경로
	var parent *string
	if dirPath != "/" {
		p := filepath.Dir(dirPath)
		parent = &p
	}

	return c.JSON(fiber.Map{
		"current":     dirPath,
		"parent":      parent,
		"quick_paths": quickPaths,
		"directories": dirs,
	})
}
