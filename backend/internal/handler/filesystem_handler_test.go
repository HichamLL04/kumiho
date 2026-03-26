package handler

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func newFilesystemTestApp(role model.Role) *fiber.App {
	app := fiber.New()
	handler := NewFilesystemHandler()

	app.Use(func(c *fiber.Ctx) error {
		c.Locals("role", role)
		return c.Next()
	})
	app.Get("/filesystem", handler.Browse)

	return app
}

func TestFilesystemBrowseRequiresMaster(t *testing.T) {
	t.Parallel()

	app := newFilesystemTestApp(model.RoleUser)

	req := httptest.NewRequest("GET", "/filesystem?path=/", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}

	if resp.StatusCode != fiber.StatusForbidden {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusForbidden)
	}
}

func TestFilesystemBrowseRejectsRelativePath(t *testing.T) {
	t.Parallel()

	app := newFilesystemTestApp(model.RoleMaster)

	req := httptest.NewRequest("GET", "/filesystem?path=relative/path", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestFilesystemBrowseRejectsFilePath(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "sample.txt")
	if err := os.WriteFile(filePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	app := newFilesystemTestApp(model.RoleMaster)

	req := httptest.NewRequest("GET", "/filesystem?path="+filePath, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
}

func TestFilesystemBrowseReturnsArrayFields(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	app := newFilesystemTestApp(model.RoleMaster)

	req := httptest.NewRequest("GET", "/filesystem?path="+tempDir, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("app.Test() error = %v", err)
	}

	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, fiber.StatusOK)
	}

	var body struct {
		QuickPaths  []DirectoryEntry `json:"quick_paths"`
		Directories []DirectoryEntry `json:"directories"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("json decode error = %v", err)
	}

	if body.QuickPaths == nil {
		t.Fatal("quick_paths is nil, want empty array or entries")
	}
	if body.Directories == nil {
		t.Fatal("directories is nil, want empty array or entries")
	}
}
