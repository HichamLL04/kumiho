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
	if err := os.MkdirAll(filepath.Dir(managedPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(managedPath, []byte("cover"), 0o644); err != nil {
		t.Fatalf("WriteFile(managedPath) error = %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(unmanagedPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(unmanagedPath, []byte("cover"), 0o644); err != nil {
		t.Fatalf("WriteFile(unmanagedPath) error = %v", err)
	}

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

func TestIsManagedAssetPathRejectsSymlinkEscape(t *testing.T) {
	dataDir := t.TempDir()
	managedDir := filepath.Join(dataDir, "thumbnails")
	if err := os.MkdirAll(managedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	outsideDir := t.TempDir()
	linkPath := filepath.Join(managedDir, "escape")
	if err := os.Symlink(outsideDir, linkPath); err != nil {
		t.Skipf("Symlink not supported: %v", err)
	}

	candidate := filepath.Join(linkPath, "cover.jpg")
	if IsManagedAssetPath(dataDir, candidate) {
		t.Fatalf("IsManagedAssetPath(%q) = true, want false", candidate)
	}
}

func TestRemoveManagedAssetDeletesResolvedManagedPath(t *testing.T) {
	dataDir := t.TempDir()
	realManagedDir := filepath.Join(dataDir, "thumbnails", "real")
	if err := os.MkdirAll(realManagedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	managedPath := filepath.Join(realManagedDir, "cover.jpg")
	if err := os.WriteFile(managedPath, []byte("cover"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	aliasDir := filepath.Join(dataDir, "thumbnails", "alias")
	if err := os.Symlink(realManagedDir, aliasDir); err != nil {
		t.Skipf("Symlink not supported: %v", err)
	}

	removed, err := RemoveManagedAsset(dataDir, filepath.Join(aliasDir, "cover.jpg"))
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if !removed {
		t.Fatal("RemoveManagedAsset() did not remove symlink-resolved managed path")
	}
	if _, statErr := os.Stat(managedPath); !os.IsNotExist(statErr) {
		t.Fatalf("resolved managed file should be removed, stat error = %v", statErr)
	}
}

func TestRemoveManagedAssetTreatsMissingManagedPathAsHandled(t *testing.T) {
	dataDir := t.TempDir()
	managedDir := filepath.Join(dataDir, "thumbnails", "series")
	if err := os.MkdirAll(managedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	missingPath := filepath.Join(managedDir, "missing-cover.jpg")
	removed, err := RemoveManagedAsset(dataDir, missingPath)
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if !removed {
		t.Fatal("RemoveManagedAsset() should treat missing managed path as handled")
	}
}

func TestRemoveManagedAssetTreatsMissingManagedPathWithMissingParentAsHandled(t *testing.T) {
	dataDir := t.TempDir()
	managedDir := filepath.Join(dataDir, "thumbnails", "series", "nested")
	if err := os.MkdirAll(managedDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.RemoveAll(managedDir); err != nil {
		t.Fatalf("RemoveAll() error = %v", err)
	}

	missingPath := filepath.Join(managedDir, "missing-cover.jpg")
	removed, err := RemoveManagedAsset(dataDir, missingPath)
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if !removed {
		t.Fatal("RemoveManagedAsset() should treat missing managed path with missing parent as handled")
	}
}

func TestIsManagedAssetPathRejectsManagedRoot(t *testing.T) {
	dataDir := t.TempDir()
	managedRoot := filepath.Join(dataDir, "thumbnails")
	if err := os.MkdirAll(managedRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	if IsManagedAssetPath(dataDir, managedRoot) {
		t.Fatalf("IsManagedAssetPath(%q) = true, want false", managedRoot)
	}
}

func TestRemoveManagedAssetSkipsManagedRootDirectory(t *testing.T) {
	dataDir := t.TempDir()
	managedRoot := filepath.Join(dataDir, "characters")
	if err := os.MkdirAll(managedRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	removed, err := RemoveManagedAsset(dataDir, managedRoot)
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if removed {
		t.Fatal("RemoveManagedAsset() should not remove managed root directory")
	}
}

func TestRemoveManagedAssetTreatsMissingManagedPathWithMissingRootAsHandled(t *testing.T) {
	dataDir := t.TempDir()
	managedRoot := filepath.Join(dataDir, "thumbnails")
	if err := os.MkdirAll(managedRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.RemoveAll(managedRoot); err != nil {
		t.Fatalf("RemoveAll() error = %v", err)
	}

	missingPath := filepath.Join(managedRoot, "series", "missing-cover.jpg")
	removed, err := RemoveManagedAsset(dataDir, missingPath)
	if err != nil {
		t.Fatalf("RemoveManagedAsset() error = %v", err)
	}
	if !removed {
		t.Fatal("RemoveManagedAsset() should treat missing managed path with missing root as handled")
	}
}
