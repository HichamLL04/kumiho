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

const (
	thumbnailStatCacheTTL     = time.Second
	thumbnailStatCacheMaxSize = 1024
)

func purgeExpiredThumbnailStatCacheEntries(now time.Time) {
	for key, entry := range thumbnailStatCache {
		if now.Sub(entry.cachedAt) >= thumbnailStatCacheTTL {
			delete(thumbnailStatCache, key)
		}
	}
}

func thumbnailCacheBuster(path *string, fallback time.Time) int64 {
	if path != nil && *path != "" {
		now := time.Now()
		thumbnailStatCacheMu.RLock()
		entry, ok := thumbnailStatCache[*path]
		thumbnailStatCacheMu.RUnlock()
		if ok && now.Sub(entry.cachedAt) < thumbnailStatCacheTTL {
			if entry.value >= 0 {
				return entry.value
			}
			return fallback.Unix()
		}

		value := int64(-1)
		if info, err := os.Stat(*path); err == nil {
			value = info.ModTime().Unix()
		}

		thumbnailStatCacheMu.Lock()
		if len(thumbnailStatCache) >= thumbnailStatCacheMaxSize {
			purgeExpiredThumbnailStatCacheEntries(now)
			if len(thumbnailStatCache) >= thumbnailStatCacheMaxSize {
				for key := range thumbnailStatCache {
					delete(thumbnailStatCache, key)
					break
				}
			}
		}
		thumbnailStatCache[*path] = thumbnailStatCacheEntry{value: value, cachedAt: now}
		thumbnailStatCacheMu.Unlock()
		if value >= 0 {
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
