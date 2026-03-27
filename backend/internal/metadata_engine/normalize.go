package metadata_engine

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

var (
	releaseTagPattern = regexp.MustCompile(`(?i)\b(ebook|epub|pdf|cbz|zip|txt|webrip|webrip|retail|digital|scan|raw|완결)\b`)
	bracketNoise      = regexp.MustCompile(`[\[\(\{][^\]\)\}]*[\]\)\}]`)
	spacePattern      = regexp.MustCompile(`\s+`)
	volumePattern     = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:v|vol(?:ume)?|권|part|season)\s*\.?\s*(\d+)(?:$|[\s._-])`)
	chapterPattern    = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:c|ch(?:apter)?|화|회)\s*\.?\s*(\d+(?:\.\d+)?)(?:$|[\s._-])`)
)

// ParsedTitle is the normalized local interpretation used before plugin search.
type ParsedTitle struct {
	RawTitle       string
	CanonicalTitle string
	SeriesName     string
	VolumeNumber   *int
	ChapterNumber  *float64
}

// ParseTitle normalizes local names and extracts minimal series context.
func ParseTitle(raw string) ParsedTitle {
	cleaned := normalize(raw)
	volume := extractInt(volumePattern, cleaned)
	chapter := extractFloat(chapterPattern, cleaned)
	seriesName := stripOrdinalHints(cleaned)

	return ParsedTitle{
		RawTitle:       raw,
		CanonicalTitle: cleaned,
		SeriesName:     seriesName,
		VolumeNumber:   volume,
		ChapterNumber:  chapter,
	}
}

// BuildSearchRequest converts local scan information into the SDK search input.
func BuildSearchRequest(localTitle string, path string, contentType sdktypes.ContentType, language sdktypes.Language) sdktypes.SearchRequest {
	parsed := ParseTitle(localTitle)
	filename := filepath.Base(path)
	if parsed.RawTitle == "" {
		parsed = ParseTitle(filename)
	}

	return sdktypes.SearchRequest{
		LocalTitle:    parsed.CanonicalTitle,
		Filename:      filename,
		SeriesName:    parsed.SeriesName,
		VolumeNumber:  parsed.VolumeNumber,
		ChapterNumber: parsed.ChapterNumber,
		Language:      language,
		ContentType:   contentType,
	}
}

func normalize(raw string) string {
	base := strings.TrimSpace(raw)
	base = strings.ReplaceAll(base, "_", " ")
	base = strings.ReplaceAll(base, ".", " ")
	base = bracketNoise.ReplaceAllString(base, " ")
	base = releaseTagPattern.ReplaceAllString(base, " ")
	base = spacePattern.ReplaceAllString(base, " ")
	return strings.TrimSpace(base)
}

func stripOrdinalHints(value string) string {
	value = volumePattern.ReplaceAllString(value, " ")
	value = chapterPattern.ReplaceAllString(value, " ")
	value = spacePattern.ReplaceAllString(value, " ")
	return strings.TrimSpace(value)
}

func extractInt(pattern *regexp.Regexp, value string) *int {
	matches := pattern.FindStringSubmatch(value)
	if len(matches) < 2 {
		return nil
	}

	parsed, err := strconv.Atoi(matches[1])
	if err != nil {
		return nil
	}
	return &parsed
}

func extractFloat(pattern *regexp.Regexp, value string) *float64 {
	matches := pattern.FindStringSubmatch(value)
	if len(matches) < 2 {
		return nil
	}

	parsed, err := strconv.ParseFloat(matches[1], 64)
	if err != nil {
		return nil
	}
	return &parsed
}
