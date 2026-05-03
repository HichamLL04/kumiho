package util

import (
	"fmt"
	"os"
	"time"
)

func thumbnailCacheBuster(path *string, fallback time.Time) int64 {
	if path != nil && *path != "" {
		if info, err := os.Stat(*path); err == nil {
			return info.ModTime().Unix()
		}
	}
	return fallback.Unix()
}

func BuildSeriesThumbnailURL(seriesID string, thumbnailPath *string, fallback time.Time) string {
	return fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", seriesID, thumbnailCacheBuster(thumbnailPath, fallback))
}

func BuildVolumeThumbnailURL(volumeID string, thumbnailPath *string, fallback time.Time) string {
	return fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volumeID, thumbnailCacheBuster(thumbnailPath, fallback))
}
