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
