package chapterlabel

import "testing"

func TestIsFractional(t *testing.T) {
	for _, tc := range []struct {
		name, chapterTitle, chapterPath, volumeTitle, volumePath, unit string
		want                                                           bool
	}{
		{name: "fractional chapter file renumbered by scanner", chapterTitle: "Chapter 1", volumeTitle: "Chapter 27.05", volumePath: "/comics/Chapter 27.05.cbz", unit: "chapter", want: true},
		{name: "fractional chapter title", chapterTitle: "Chapter 27.05", volumeTitle: "Volume 3", unit: "volume", want: true},
		{name: "fractional episode", chapterTitle: "Episode 27.05", volumeTitle: "Volume 3", unit: "volume", want: true},
		{name: "fractional abbreviated chapter", chapterTitle: "Ch. 27.05", volumeTitle: "Volume 3", unit: "volume", want: true},
		{name: "bare decimal chapter file", chapterTitle: "Chapter 1", volumeTitle: "27.05", volumePath: "/comics/27.05.cbz", unit: "chapter", want: true},
		{name: "whole chapter", chapterTitle: "Chapter 28", volumeTitle: "Chapter 28", volumePath: "/comics/Chapter 28.cbz", unit: "chapter", want: false},
		{name: "version in ordinary book title", chapterTitle: "Chapter 1", volumeTitle: "Edition 2.05", volumePath: "/books/Edition 2.05.cbz", unit: "volume", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsFractional(tc.chapterTitle, tc.chapterPath, tc.volumeTitle, tc.volumePath, tc.unit); got != tc.want {
				t.Fatalf("IsFractional() = %t, want %t", got, tc.want)
			}
			number, ok := TruncatedNumber(tc.chapterTitle, tc.chapterPath, tc.volumeTitle, tc.volumePath, tc.unit)
			if ok != tc.want || (ok && number != 27 && tc.name != "version in ordinary book title") {
				t.Fatalf("TruncatedNumber() = %d, %t", number, ok)
			}
		})
	}
}
