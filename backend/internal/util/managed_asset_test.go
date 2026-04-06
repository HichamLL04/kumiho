package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIsManagedAssetPath(t *testing.T) {
	dataDir := t.TempDir()
	managedPath := filepath.Join(dataDir, "thumbnails", "series", "cover.jpg")
	unmanagedPath := filepath.Join(t.TempDir(), "library", "cover.jpg")

	if !IsManagedAssetPath(dataDir, managedPath) {
		t.Fatalf("IsManagedAssetPath(%q) = false, want true", managedPath)
	}
	if IsManagedAssetPath(dataDir, unmanagedPath) {
		t.Fatalf("IsManagedAssetPath(%q) = true, want false", unmanagedPath)
	}
}

func TestRemoveManagedAssetSkipsUnmanagedPath(t *testing.T) {
	dataDir := t.TempDir()
	libraryDir := t.TempDir()
	unmanagedPath := filepath.Join(libraryDir, "cover.jpg")
	if err := os.WriteFile(unmanagedPath, []byte("cover"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	removed, err := RemoveManagedAsset(dataDir, unmanagedPath)
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if removed {
		t.Fatal("RemoveManagedAsset() removed unmanaged path")
	}
	if _, statErr := os.Stat(unmanagedPath); statErr != nil {
		t.Fatalf("unmanaged file should remain, stat error = %v", statErr)
	}
}

func TestRemoveManagedAssetDeletesManagedPath(t *testing.T) {
	dataDir := t.TempDir()
	managedDir := filepath.Join(dataDir, "thumbnails", "series")
	if err := os.MkdirAll(managedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	managedPath := filepath.Join(managedDir, "cover.jpg")
	if err := os.WriteFile(managedPath, []byte("cover"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	removed, err := RemoveManagedAsset(dataDir, managedPath)
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if !removed {
		t.Fatal("RemoveManagedAsset() did not remove managed path")
	}
	if _, statErr := os.Stat(managedPath); !os.IsNotExist(statErr) {
		t.Fatalf("managed file should be removed, stat error = %v", statErr)
	}
}
