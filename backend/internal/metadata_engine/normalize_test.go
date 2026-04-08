package metadata_engine

import (
	"testing"

	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

func TestParseTitle(t *testing.T) {
	parsed := ParseTitle("[Scan] Example.Series.v12.cbz")

	if parsed.CanonicalTitle != "Example Series v12" {
		t.Fatalf("CanonicalTitle = %q", parsed.CanonicalTitle)
	}
	if parsed.SeriesName != "Example Series" {
		t.Fatalf("SeriesName = %q", parsed.SeriesName)
	}
	if parsed.VolumeNumber == nil || *parsed.VolumeNumber != 12 {
		t.Fatalf("VolumeNumber = %v", parsed.VolumeNumber)
	}
}

func TestBuildSearchRequestFallsBackToFilename(t *testing.T) {
	req := BuildSearchRequest("", "/library/Novel.Title.ch10.5.epub", sdktypes.ContentTypeNovel, sdktypes.Language("ko"))

	if req.LocalTitle != "Novel Title ch10.5" {
		t.Fatalf("LocalTitle = %q", req.LocalTitle)
	}
	if req.SeriesName != "Novel Title" {
		t.Fatalf("SeriesName = %q", req.SeriesName)
	}
	if req.ChapterNumber == nil || *req.ChapterNumber != 10.5 {
		t.Fatalf("ChapterNumber = %v", req.ChapterNumber)
	}
	if req.ContentType != sdktypes.ContentTypeNovel {
		t.Fatalf("ContentType = %q", req.ContentType)
	}
}

func TestParseTitleRemovesKoreanReleaseTag(t *testing.T) {
	parsed := ParseTitle("작품명.완결.cbz")

	if parsed.CanonicalTitle != "작품명" {
		t.Fatalf("CanonicalTitle = %q", parsed.CanonicalTitle)
	}
	if parsed.SeriesName != "작품명" {
		t.Fatalf("SeriesName = %q", parsed.SeriesName)
	}
}

func TestParseTitleRemovesComicRangeNoise(t *testing.T) {
	parsed := ParseTitle("All you Need Is Kill 1~2권_완")

	if parsed.CanonicalTitle != "All you Need Is Kill" {
		t.Fatalf("CanonicalTitle = %q", parsed.CanonicalTitle)
	}
	if parsed.SeriesName != "All you Need Is Kill" {
		t.Fatalf("SeriesName = %q", parsed.SeriesName)
	}
}

func TestParseTitleRemovesTrailingIssueNumber(t *testing.T) {
	parsed := ParseTitle("Amazing Spider-Man-Venom - Death Spiral 001 (2026) (Digital) (Shan-Empire)")

	if parsed.CanonicalTitle != "Amazing Spider-Man-Venom - Death Spiral" {
		t.Fatalf("CanonicalTitle = %q", parsed.CanonicalTitle)
	}
	if parsed.SeriesName != "Amazing Spider-Man-Venom - Death Spiral" {
		t.Fatalf("SeriesName = %q", parsed.SeriesName)
	}
}

func TestParseTitleRemovesSpecialEditionNoise(t *testing.T) {
	parsed := ParseTitle("20세기 소년 완전판 1~11권+특별편")

	if parsed.CanonicalTitle != "20세기 소년 완전판" {
		t.Fatalf("CanonicalTitle = %q", parsed.CanonicalTitle)
	}
	if parsed.SeriesName != "20세기 소년 완전판" {
		t.Fatalf("SeriesName = %q", parsed.SeriesName)
	}
}
