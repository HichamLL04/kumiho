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

func resolveManagedAssetPath(dataDir, candidate string) (string, bool) {
	trimmed := strings.TrimSpace(candidate)
	if trimmed == "" {
		return "", false
	}

	absCandidate, err := filepath.Abs(filepath.Clean(trimmed))
	if err != nil {
		return "", false
	}

	resolvedCandidate, err := filepath.EvalSymlinks(absCandidate)
	if err != nil {
		return "", false
	}

	for _, root := range managedAssetRoots(dataDir) {
		absRoot, rootErr := filepath.Abs(filepath.Clean(root))
		if rootErr != nil {
			continue
		}

		resolvedRoot, evalErr := filepath.EvalSymlinks(absRoot)
		if evalErr != nil {
			continue
		}
		if resolvedCandidate == resolvedRoot || strings.HasPrefix(resolvedCandidate, resolvedRoot+string(os.PathSeparator)) {
			return resolvedCandidate, true
		}
	}

	return "", false
}

func IsManagedAssetPath(dataDir, candidate string) bool {
	_, ok := resolveManagedAssetPath(dataDir, candidate)
	return ok
}

func RemoveManagedAsset(dataDir, candidate string) (bool, error) {
	resolvedCandidate, ok := resolveManagedAssetPath(dataDir, candidate)
	if !ok {
		return false, nil
	}
	if err := os.Remove(resolvedCandidate); err != nil {
		return true, err
	}
	return true, nil
}
