package handler

import (
	"path/filepath"
	"strings"
)

var supportedAudioExts = map[string]bool{
	".mp3":  true,
	".wav":  true,
	".ogg":  true,
	".oga":  true,
	".flac": true,
	".m4a":  true,
	".m4b":  true,
	".aac":  true,
	".wma":  true,
	".opus": true,
	".mp4":  true,
}

func isSupportedAudioPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return supportedAudioExts[ext]
}
