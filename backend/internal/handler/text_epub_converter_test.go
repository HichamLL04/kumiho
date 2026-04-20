package handler

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

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
