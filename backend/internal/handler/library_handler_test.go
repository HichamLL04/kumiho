package handler

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/gofiber/fiber/v2"
)

func TestValidateNoNestedLibraryPaths(t *testing.T) {
	tests := []struct {
		name      string
		paths     []string
		libraries []model.Library
		excludeID string
		wantErr   bool
	}{
		{
			name:    "sibling paths are allowed",
			paths:   []string{"/data/comics", "/data/novels"},
			wantErr: false,
		},
		{
			name:    "request nested paths are rejected",
			paths:   []string{"/data", "/data/comics"},
			wantErr: true,
		},
		{
			name:  "nested against existing library is rejected",
			paths: []string{"/data/comics"},
			libraries: []model.Library{
				{ID: "existing", Paths: []string{"/data"}},
			},
			wantErr: true,
		},
		{
			name:  "excluded library paths are ignored",
			paths: []string{"/data/comics"},
			libraries: []model.Library{
				{ID: "same-lib", Paths: []string{"/data"}},
			},
			excludeID: "same-lib",
			wantErr:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateNoNestedLibraryPaths(tt.paths, tt.libraries, tt.excludeID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateNoNestedLibraryPaths() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidateLibraryPathsResolvesSymlinks(t *testing.T) {
	targetDir := t.TempDir()
	linkPath := filepath.Join(t.TempDir(), "linked-library")
	if err := os.Symlink(targetDir, linkPath); err != nil {
		t.Fatalf("os.Symlink() error = %v", err)
	}

	paths, err := validateLibraryPaths([]string{linkPath}, func(path string) (bool, error) {
		if path != targetDir {
			t.Fatalf("checkExists path = %q, want %q", path, targetDir)
		}
		return false, nil
	})
	if err != nil {
		t.Fatalf("validateLibraryPaths() error = %v", err)
	}

	if len(paths) != 1 || paths[0] != targetDir {
		t.Fatalf("normalized paths = %v, want [%q]", paths, targetDir)
	}
}

func TestValidateLibraryPathsRejectsResolvedDuplicates(t *testing.T) {
	targetDir := t.TempDir()
	linkPath := filepath.Join(t.TempDir(), "linked-library")
	if err := os.Symlink(targetDir, linkPath); err != nil {
		t.Fatalf("os.Symlink() error = %v", err)
	}

	_, err := validateLibraryPaths([]string{targetDir, linkPath}, func(string) (bool, error) {
		return false, nil
	})
	if err == nil {
		t.Fatal("validateLibraryPaths() error = nil, want duplicate path error")
	}

	fiberErr, ok := err.(*fiber.Error)
	if !ok {
		t.Fatalf("error type = %T, want *fiber.Error", err)
	}
	if fiberErr.Code != fiber.StatusBadRequest {
		t.Fatalf("error code = %d, want %d", fiberErr.Code, fiber.StatusBadRequest)
	}
}

func TestValidateLibraryPathsRejectsRelativePath(t *testing.T) {
	_, err := validateLibraryPaths([]string{"relative/path"}, func(string) (bool, error) {
		return false, nil
	})
	if err == nil {
		t.Fatal("validateLibraryPaths() error = nil, want relative path error")
	}

	fiberErr, ok := err.(*fiber.Error)
	if !ok {
		t.Fatalf("error type = %T, want *fiber.Error", err)
	}
	if fiberErr.Code != fiber.StatusBadRequest {
		t.Fatalf("error code = %d, want %d", fiberErr.Code, fiber.StatusBadRequest)
	}
}

func TestIsDatabaseBusyError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "database locked", err: errors.New("database is locked"), want: true},
		{name: "table locked", err: errors.New("database table is locked: series"), want: true},
		{name: "busy code", err: errors.New("SQLITE_BUSY: database is busy"), want: true},
		{name: "other", err: errors.New("constraint failed"), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isDatabaseBusyError(tt.err); got != tt.want {
				t.Fatalf("isDatabaseBusyError() = %v, want %v", got, tt.want)
			}
		})
	}
}
