package chapterlabel

import (
	"path/filepath"
	"regexp"
	"strings"
)

var fractionalLabel = regexp.MustCompile(`(?i)(?:^|[^[:alnum:]])(?:chapter|chap|ch\.?|c|episode|ep\.?|e)\s*#?\s*\d+\.\d+|\d+\.\d+\s*(?:화|회)`)
var bareFractionalLabel = regexp.MustCompile(`^\s*\d+\.\d+(?:\s|$|[-_])`)

// IsFractional detects a chapter number lost when a reader stores only an
// integer chapter index. Original titles and paths remain authoritative even
// if the scanner assigned a different integer to preserve sort order.
func IsFractional(chapterTitle, chapterPath, volumeTitle, volumePath, unit string) bool {
	for _, label := range []string{chapterTitle, volumeTitle, filepath.Base(chapterPath), filepath.Base(volumePath)} {
		if fractionalLabel.MatchString(label) {
			return true
		}
	}
	if strings.EqualFold(strings.TrimSpace(unit), "chapter") {
		for _, label := range []string{volumeTitle, strings.TrimSuffix(filepath.Base(volumePath), filepath.Ext(volumePath))} {
			if bareFractionalLabel.MatchString(label) {
				return true
			}
		}
	}
	return false
}
