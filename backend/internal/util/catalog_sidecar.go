package util

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// ReadCatalogPreferredTitle returns clean_title, falling back to title, from
// a metadata.json beside a series folder or archive.
func ReadCatalogPreferredTitle(seriesPath string) string {
	baseDir := seriesPath
	if info, err := os.Stat(seriesPath); err == nil && !info.IsDir() {
		baseDir = filepath.Dir(seriesPath)
	}
	data, err := os.ReadFile(filepath.Join(baseDir, "metadata.json"))
	if err != nil {
		return ""
	}
	var values struct {
		CleanTitle string `json:"clean_title"`
		Title      string `json:"title"`
	}
	if json.Unmarshal(data, &values) != nil {
		return ""
	}
	if title := strings.TrimSpace(values.CleanTitle); title != "" {
		return title
	}
	return strings.TrimSpace(values.Title)
}
