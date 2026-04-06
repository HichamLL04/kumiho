package util

import (
	"os"
	"path/filepath"
	"strings"
)

func managedAssetRoots(dataDir string) []string {
	trimmed := strings.TrimSpace(dataDir)
	if trimmed == "" {
		return nil
	}
	return []string{
		filepath.Join(trimmed, "thumbnails"),
		filepath.Join(trimmed, "characters"),
	}
}

func IsManagedAssetPath(dataDir, candidate string) bool {
	trimmed := strings.TrimSpace(candidate)
	if trimmed == "" {
		return false
	}

	absCandidate, err := filepath.Abs(filepath.Clean(trimmed))
	if err != nil {
		return false
	}

	for _, root := range managedAssetRoots(dataDir) {
		absRoot, rootErr := filepath.Abs(filepath.Clean(root))
		if rootErr != nil {
			continue
		}
		if absCandidate == absRoot || strings.HasPrefix(absCandidate, absRoot+string(os.PathSeparator)) {
			return true
		}
	}

	return false
}

func RemoveManagedAsset(dataDir, candidate string) (bool, error) {
	if !IsManagedAssetPath(dataDir, candidate) {
		return false, nil
	}
	if err := os.Remove(strings.TrimSpace(candidate)); err != nil {
		return true, err
	}
	return true, nil
}
