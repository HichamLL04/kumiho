package chapterlabel

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var fractionalLabel = regexp.MustCompile(`(?i)(?:^|[^[:alnum:]])(?:chapter|chap|ch\.?|c|episode|ep\.?|e)\s*#?\s*\d+\.\d+|\d+\.\d+\s*(?:화|회)`)
var bareFractionalLabel = regexp.MustCompile(`^\s*\d+\.\d+(?:\s|$|[-_])`)
var decimalNumber = regexp.MustCompile(`\d+\.\d+`)

// TruncatedNumber recovers the chapter's integer part from its original name.
// A scanner may store Chapter 27.05 as integer 28 to keep a distinct sort key.
func TruncatedNumber(chapterTitle, chapterPath, volumeTitle, volumePath, unit string) (int, bool) {
	labels := []string{chapterTitle, filepath.Base(chapterPath), volumeTitle, filepath.Base(volumePath)}
	for _, label := range labels {
		if fractionalLabel.MatchString(label) || (strings.EqualFold(strings.TrimSpace(unit), "chapter") && bareFractionalLabel.MatchString(label)) {
			parts := decimalNumber.FindString(label)
			integer, err := strconv.Atoi(strings.SplitN(parts, ".", 2)[0])
			if err == nil {
				return integer, true
			}
		}
	}
	return 0, false
}

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
