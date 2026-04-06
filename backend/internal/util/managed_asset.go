package util

import (
	"errors"
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

func resolveExistingOrMissingPath(path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err == nil {
		return resolved, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}

	current := filepath.Dir(path)
	missingSegments := []string{filepath.Base(path)}
	for {
		resolvedCurrent, currentErr := filepath.EvalSymlinks(current)
		if currentErr == nil {
			resolvedPath := resolvedCurrent
			for i := len(missingSegments) - 1; i >= 0; i-- {
				resolvedPath = filepath.Join(resolvedPath, missingSegments[i])
			}
			return resolvedPath, nil
		}
		if !errors.Is(currentErr, os.ErrNotExist) {
			return "", currentErr
		}

		parent := filepath.Dir(current)
		if parent == current {
			return "", currentErr
		}
		missingSegments = append(missingSegments, filepath.Base(current))
		current = parent
	}
}

func resolveManagedAssetPath(dataDir, candidate string) (string, bool) {
	trimmedCandidate := strings.TrimSpace(candidate)
	if trimmedCandidate == "" {
		return "", false
	}

	absCandidate, err := filepath.Abs(filepath.Clean(trimmedCandidate))
	if err != nil {
		return "", false
	}

	resolvedCandidate, err := resolveExistingOrMissingPath(absCandidate)
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
		if resolvedCandidate == resolvedRoot {
			return "", false
		}
		if strings.HasPrefix(resolvedCandidate, resolvedRoot+string(os.PathSeparator)) {
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
	if info, statErr := os.Lstat(resolvedCandidate); statErr == nil && info.IsDir() {
		return false, nil
	}
	if err := os.Remove(resolvedCandidate); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return true, nil
		}
		return true, err
	}
	return true, nil
}
