package util

import (
	"fmt"
	"os"
	"sync"
	"time"
)

type thumbnailStatCacheEntry struct {
	value    int64
	cachedAt time.Time
}

var (
	thumbnailStatCache   = map[string]thumbnailStatCacheEntry{}
	thumbnailStatCacheMu sync.RWMutex
)

const thumbnailStatCacheTTL = time.Second

func thumbnailCacheBuster(path *string, fallback time.Time) int64 {
	if path != nil && *path != "" {
		now := time.Now()
		thumbnailStatCacheMu.RLock()
		entry, ok := thumbnailStatCache[*path]
		thumbnailStatCacheMu.RUnlock()
		if ok && now.Sub(entry.cachedAt) < thumbnailStatCacheTTL {
			return entry.value
		}

		if info, err := os.Stat(*path); err == nil {
			value := info.ModTime().Unix()
			thumbnailStatCacheMu.Lock()
			thumbnailStatCache[*path] = thumbnailStatCacheEntry{value: value, cachedAt: now}
			thumbnailStatCacheMu.Unlock()
			return value
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
