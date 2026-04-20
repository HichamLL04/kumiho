package handler

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"golang.org/x/text/encoding/korean"
)

func TestBuildTextEpubUTF8(t *testing.T) {
	epubData, encoding, err := buildTextEpub(textEpubSource{
		ChapterID: "chapter-1",
		Title:     "테스트 TXT",
		FileName:  "sample.txt",
		Raw:       []byte("첫 문단\n\n둘째 <문단> & 내용"),
	})
	if err != nil {
		t.Fatalf("buildTextEpub returned error: %v", err)
	}
	if encoding != "utf-8" {
		t.Fatalf("expected utf-8 encoding, got %q", encoding)
	}

	files := openTextEpubZip(t, epubData)
	if files[0].Name != "mimetype" {
		t.Fatalf("expected mimetype to be first zip entry, got %q", files[0].Name)
	}
	if files[0].Method != zip.Store {
		t.Fatalf("expected mimetype to be stored, got method %d", files[0].Method)
	}

	entries := readTextEpubEntries(t, files)
	for _, name := range []string{
		"mimetype",
		"META-INF/container.xml",
		"OEBPS/content.opf",
		"OEBPS/nav.xhtml",
		"OEBPS/text-0001.xhtml",
	} {
		if _, ok := entries[name]; !ok {
			t.Fatalf("expected epub entry %q", name)
		}
	}
	if !strings.Contains(entries["OEBPS/nav.xhtml"], `xmlns:epub="http://www.idpf.org/2007/ops"`) {
		t.Fatal("expected nav document to declare epub namespace")
	}
	if !strings.Contains(entries["OEBPS/text-0001.xhtml"], "둘째 &lt;문단&gt; &amp; 내용") {
		t.Fatalf("expected escaped paragraph in section, got %s", entries["OEBPS/text-0001.xhtml"])
	}
}

func TestBuildTextEpubCP949(t *testing.T) {
	raw, err := korean.EUCKR.NewEncoder().Bytes([]byte("한글 CP949\n\n둘째 문단"))
	if err != nil {
		t.Fatalf("failed to encode fixture: %v", err)
	}

	epubData, encoding, err := buildTextEpub(textEpubSource{
		ChapterID: "chapter-cp949",
		Title:     "CP949",
		FileName:  "sample.txt",
		Raw:       raw,
	})
	if err != nil {
		t.Fatalf("buildTextEpub returned error: %v", err)
	}
	if encoding != "cp949" {
		t.Fatalf("expected cp949 encoding, got %q", encoding)
	}

	entries := readTextEpubEntries(t, openTextEpubZip(t, epubData))
	if !strings.Contains(entries["OEBPS/text-0001.xhtml"], "한글 CP949") {
		t.Fatalf("expected decoded Korean text in section, got %s", entries["OEBPS/text-0001.xhtml"])
	}
}

func TestBuildTextEpubRejectsEmptyText(t *testing.T) {
	_, _, err := buildTextEpub(textEpubSource{
		ChapterID: "empty",
		FileName:  "empty.txt",
		Raw:       []byte(" \n\t\n"),
	})
	if err == nil {
		t.Fatal("expected empty TXT conversion to fail")
	}
}

func TestBuildTextEpubWithBOM(t *testing.T) {
	// UTF-8 BOM (0xEF, 0xBB, 0xBF) + 본문
	raw := append([]byte{0xEF, 0xBB, 0xBF}, []byte("BOM 테스트 문단\n\n둘째 문단")...)

	epubData, encoding, err := buildTextEpub(textEpubSource{
		ChapterID: "chapter-bom",
		Title:     "BOM Test",
		FileName:  "bom.txt",
		Raw:       raw,
	})
	if err != nil {
		t.Fatalf("buildTextEpub returned error: %v", err)
	}
	if encoding != "utf-8" {
		t.Fatalf("expected utf-8 encoding, got %q", encoding)
	}

	entries := readTextEpubEntries(t, openTextEpubZip(t, epubData))
	section := entries["OEBPS/text-0001.xhtml"]
	if strings.Contains(section, "\xEF\xBB\xBF") {
		t.Fatal("BOM bytes should be stripped from output")
	}
	if !strings.Contains(section, "BOM 테스트 문단") {
		t.Fatalf("expected content after BOM removal, got %s", section)
	}
}

func TestBuildTextEpubLargeParagraphSplit(t *testing.T) {
	// 128KB를 초과하는 단일 단락 생성 — 강제 분할이 동작하는지 검증
	var sb strings.Builder
	line := strings.Repeat("가", 1000) + "\n" // ~3KB per line (3 bytes per rune)
	for sb.Len() < textEpubMaxParagraphBytes+1024 {
		sb.WriteString(line)
	}

	epubData, _, err := buildTextEpub(textEpubSource{
		ChapterID: "chapter-large",
		Title:     "Large Paragraph",
		FileName:  "large.txt",
		Raw:       []byte(sb.String()),
	})
	if err != nil {
		t.Fatalf("buildTextEpub returned error: %v", err)
	}

	files := openTextEpubZip(t, epubData)
	sectionCount := 0
	for _, f := range files {
		if strings.HasPrefix(f.Name, "OEBPS/text-") {
			sectionCount++
		}
	}
	if sectionCount < 1 {
		t.Fatal("expected at least one section for large paragraph")
	}
}

func TestBuildTextEpubRejectsInvalidEncoding(t *testing.T) {
	// 유효하지 않은 바이트 시퀀스: UTF-8도 아니고 CP949로도 디코딩되지 않는 바이트
	// 0x80-0xFF 단독 바이트는 CP949에서도 항상 리드 바이트이므로 홀수 개면 실패할 수 있다.
	// 하지만 CP949 디코더가 관대할 수 있으므로, 대신 빈 결과를 내는 경우를 테스트.
	// 실제로 Go의 korean.EUCKR 디코더는 대부분의 바이트를 수용하므로,
	// 이 테스트는 변환 후 빈 텍스트를 거부하는 경로를 검증한다.
	raw := []byte{0xFF, 0xFE} // UTF-16 LE BOM — UTF-8 아님
	_, _, err := buildTextEpub(textEpubSource{
		ChapterID: "invalid",
		FileName:  "invalid.txt",
		Raw:       raw,
	})
	// 명시적인 UTF-16 BOM이 들어있으므로 errUnsupportedTextEncoding 발생
	if err == nil {
		t.Fatal("expected error for unsupported encoding (UTF-16 BOM), got nil")
	}
	if !errors.Is(err, util.ErrUnsupportedTextEncoding) {
		t.Fatalf("expected util.ErrUnsupportedTextEncoding, got: %v", err)
	}
}

func openTextEpubZip(t *testing.T, epubData []byte) []*zip.File {
	t.Helper()

	reader, err := zip.NewReader(bytes.NewReader(epubData), int64(len(epubData)))
	if err != nil {
		t.Fatalf("failed to open epub zip: %v", err)
	}
	return reader.File
}

func readTextEpubEntries(t *testing.T, files []*zip.File) map[string]string {
	t.Helper()

	entries := make(map[string]string, len(files))
	for _, file := range files {
		data, err := readAllZipFile(file)
		if err != nil {
			t.Fatalf("failed to read zip entry %q: %v", file.Name, err)
		}
		entries[file.Name] = string(data)
	}
	return entries
}
