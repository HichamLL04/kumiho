package metadata_engine

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

var (
	releaseTagPattern = regexp.MustCompile(`(?i)(?:\b(ebook|epub|pdf|cbz|zip|txt|webrip|retail|digital|scan|raw)\b|(?:^|[\s._-])완결(?:$|[\s._-]))`)
	bracketNoise      = regexp.MustCompile(`[\[\(\{][^\]\)\}]*[\]\)\}]`)
	spacePattern      = regexp.MustCompile(`\s+`)
	volumePattern     = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:v|vol(?:ume)?|권|part|season)\s*\.?\s*(\d+)(?:$|[\s._-])`)
	chapterPattern    = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:c|ch(?:apter)?|화|회)\s*\.?\s*(\d+(?:\.\d+)?)(?:$|[\s._-])`)
	rangePattern      = regexp.MustCompile(`(?i)(?:^|[\s._-])\d+\s*[~+-]\s*\d+\s*권?(?:$|[\s._-])`)
	trailingVolumeSet = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:전\s*)?\d+\s*권(?:$|[\s._-])`)
	trailingIssueNum  = regexp.MustCompile(`(?i)(?:^|[\s._-])\d{1,3}(?:$|[\s._-])`)
	comicNoisePattern = regexp.MustCompile(`(?i)(?:^|[\s._-])(?:완|완결|웹툰)(?:$|[\s._-])`)
	extraEditionNoise = regexp.MustCompile(`(?i)(?:^|[\s._+-])(?:특별편|특별판|외전|합본|총집편|스페셜|special|omnibus)(?:$|[\s._+-])`)
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
	if strings.TrimSpace(localTitle) == "" || parsed.CanonicalTitle == "" {
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
	base = replaceDotsExceptDecimals(base)
	base = bracketNoise.ReplaceAllString(base, " ")
	base = releaseTagPattern.ReplaceAllString(base, " ")
	base = comicNoisePattern.ReplaceAllString(base, " ")
	base = extraEditionNoise.ReplaceAllString(base, " ")
	base = rangePattern.ReplaceAllString(base, " ")
	base = trailingVolumeSet.ReplaceAllString(base, " ")
	base = spacePattern.ReplaceAllString(base, " ")
	base = strings.TrimSpace(base)
	return stripTrailingIssueNumber(base)
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

func replaceDotsExceptDecimals(value string) string {
	runes := []rune(value)
	for i, r := range runes {
		if r != '.' {
			continue
		}

		prevIsDigit := i > 0 && runes[i-1] >= '0' && runes[i-1] <= '9'
		nextIsDigit := i+1 < len(runes) && runes[i+1] >= '0' && runes[i+1] <= '9'
		if prevIsDigit && nextIsDigit {
			continue
		}
		runes[i] = ' '
	}
	return string(runes)
}

func stripTrailingIssueNumber(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return trimmed
	}

	candidate := trailingIssueNum.ReplaceAllString(trimmed, " ")
	candidate = strings.TrimSpace(spacePattern.ReplaceAllString(candidate, " "))
	if candidate == "" || candidate == trimmed {
		return trimmed
	}

	wordsBefore := len(strings.Fields(candidate))
	wordsAfter := len(strings.Fields(trimmed))
	if wordsBefore >= 2 && wordsAfter-wordsBefore == 1 {
		return candidate
	}
	return trimmed
}
