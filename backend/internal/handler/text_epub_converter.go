package handler

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"html"
	"io"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/korean"
)

const (
	textEpubTargetSectionBytes = 200 * 1024
	textEpubMaxParagraphBytes  = 128 * 1024
)

var errUnsupportedTextEncoding = errors.New("unsupported text encoding")

type textEpubSource struct {
	ChapterID string
	Title     string
	FileName  string
	Raw       []byte
}

type textEpubSection struct {
	ID       string
	Href     string
	Title    string
	Contents []string
}

func buildTextEpub(source textEpubSource) ([]byte, string, error) {
	normalized, encoding, err := decodeRawTextForEpub(source.Raw)
	if err != nil {
		return nil, "", err
	}

	paragraphs := splitTextParagraphsForEpub(normalized)
	sections := buildTextEpubSections(paragraphs)
	if len(sections) == 0 {
		return nil, "", errors.New("txt has no readable content")
	}

	title := strings.TrimSpace(source.Title)
	if title == "" {
		title = strings.TrimSuffix(filepath.Base(source.FileName), filepath.Ext(source.FileName))
	}
	if title == "" {
		title = "TXT"
	}

	var buf bytes.Buffer
	zipWriter := zip.NewWriter(&buf)

	if err := writeStoredZipFile(zipWriter, "mimetype", []byte("application/epub+zip")); err != nil {
		_ = zipWriter.Close()
		return nil, "", err
	}
	if err := writeDeflatedZipFile(zipWriter, "META-INF/container.xml", []byte(textEpubContainerXML)); err != nil {
		_ = zipWriter.Close()
		return nil, "", err
	}
	if err := writeDeflatedZipFile(zipWriter, "OEBPS/styles.css", []byte(textEpubCSS)); err != nil {
		_ = zipWriter.Close()
		return nil, "", err
	}
	if err := writeDeflatedZipFile(zipWriter, "OEBPS/nav.xhtml", []byte(renderTextEpubNav(title, sections))); err != nil {
		_ = zipWriter.Close()
		return nil, "", err
	}
	if err := writeDeflatedZipFile(zipWriter, "OEBPS/content.opf", []byte(renderTextEpubOPF(source.ChapterID, title, encoding, sections))); err != nil {
		_ = zipWriter.Close()
		return nil, "", err
	}
	for _, section := range sections {
		if err := writeDeflatedZipFile(zipWriter, "OEBPS/"+section.Href, []byte(renderTextEpubSection(title, section))); err != nil {
			_ = zipWriter.Close()
			return nil, "", err
		}
	}

	if err := zipWriter.Close(); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), encoding, nil
}

func decodeRawTextForEpub(raw []byte) (string, string, error) {
	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	if utf8.Valid(raw) {
		return normalizeDecodedTextForEpub(string(raw)), "utf-8", nil
	}

	decoded, err := korean.EUCKR.NewDecoder().Bytes(raw)
	if err != nil {
		return "", "", errUnsupportedTextEncoding
	}
	return normalizeDecodedTextForEpub(string(decoded)), "cp949", nil
}

func normalizeDecodedTextForEpub(content string) string {
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	return strings.ReplaceAll(normalized, "\r", "\n")
}

func splitTextParagraphsForEpub(content string) []string {
	lines := strings.Split(content, "\n")
	paragraphs := make([]string, 0, len(lines)/2)
	current := make([]string, 0, 4)

	flush := func() {
		if len(current) == 0 {
			return
		}
		paragraph := strings.TrimSpace(strings.Join(current, "\n"))
		current = current[:0]
		if paragraph == "" {
			return
		}
		paragraphs = append(paragraphs, splitLongTextParagraph(paragraph)...)
	}

	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		current = append(current, strings.TrimRight(line, " \t"))
	}
	flush()

	return paragraphs
}

func splitLongTextParagraph(paragraph string) []string {
	if len([]byte(paragraph)) <= textEpubMaxParagraphBytes {
		return []string{paragraph}
	}

	lines := strings.Split(paragraph, "\n")
	parts := make([]string, 0, len(lines))
	var builder strings.Builder

	flush := func() {
		text := strings.TrimSpace(builder.String())
		builder.Reset()
		if text != "" {
			parts = append(parts, text)
		}
	}

	for _, line := range lines {
		if builder.Len() > 0 && builder.Len()+len(line)+1 > textEpubMaxParagraphBytes {
			flush()
		}
		if len([]byte(line)) > textEpubMaxParagraphBytes {
			runes := []rune(line)
			for len(runes) > 0 {
				cut := min(len(runes), textEpubMaxParagraphBytes/4)
				if cut <= 0 {
					cut = min(len(runes), 1024)
				}
				if builder.Len() > 0 {
					flush()
				}
				parts = append(parts, strings.TrimSpace(string(runes[:cut])))
				runes = runes[cut:]
			}
			continue
		}
		if builder.Len() > 0 {
			builder.WriteByte('\n')
		}
		builder.WriteString(line)
	}
	flush()

	if len(parts) == 0 {
		return []string{paragraph}
	}
	return parts
}

func buildTextEpubSections(paragraphs []string) []textEpubSection {
	sections := make([]textEpubSection, 0, max(1, len(paragraphs)/128))
	current := make([]string, 0, 128)
	currentBytes := 0

	flush := func() {
		if len(current) == 0 {
			return
		}
		index := len(sections) + 1
		section := textEpubSection{
			ID:       fmt.Sprintf("text-%04d", index),
			Href:     fmt.Sprintf("text-%04d.xhtml", index),
			Title:    fmt.Sprintf("Part %d", index),
			Contents: append([]string(nil), current...),
		}
		sections = append(sections, section)
		current = current[:0]
		currentBytes = 0
	}

	for _, paragraph := range paragraphs {
		paragraphBytes := len([]byte(paragraph))
		if len(current) > 0 && currentBytes+paragraphBytes > textEpubTargetSectionBytes {
			flush()
		}
		current = append(current, paragraph)
		currentBytes += paragraphBytes
	}
	flush()

	return sections
}

func writeStoredZipFile(zipWriter *zip.Writer, name string, data []byte) error {
	header := &zip.FileHeader{
		Name:   name,
		Method: zip.Store,
	}
	header.SetModTime(time.Unix(0, 0))
	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = writer.Write(data)
	return err
}

func writeDeflatedZipFile(zipWriter *zip.Writer, name string, data []byte) error {
	header := &zip.FileHeader{
		Name:   name,
		Method: zip.Deflate,
	}
	header.SetModTime(time.Unix(0, 0))
	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = writer.Write(data)
	return err
}

func renderTextEpubOPF(chapterID string, title string, encoding string, sections []textEpubSection) string {
	var manifest strings.Builder
	var spine strings.Builder

	manifest.WriteString(`    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` + "\n")
	manifest.WriteString(`    <item id="style" href="styles.css" media-type="text/css"/>` + "\n")
	for _, section := range sections {
		manifest.WriteString(fmt.Sprintf(`    <item id="%s" href="%s" media-type="application/xhtml+xml"/>`, section.ID, section.Href))
		manifest.WriteByte('\n')
		spine.WriteString(fmt.Sprintf(`    <itemref idref="%s"/>`, section.ID))
		spine.WriteByte('\n')
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">%s</dc:identifier>
    <dc:title>%s</dc:title>
    <dc:language>ko</dc:language>
    <meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>
    <meta property="kumiho:source-encoding">%s</meta>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
%s  </manifest>
  <spine>
%s  </spine>
</package>
`, html.EscapeString("kumiho-txt-"+chapterID), html.EscapeString(title), html.EscapeString(encoding), manifest.String(), spine.String())
}

func renderTextEpubNav(title string, sections []textEpubSection) string {
	var items strings.Builder
	for _, section := range sections {
		items.WriteString(fmt.Sprintf(`      <li><a href="%s">%s</a></li>`, section.Href, html.EscapeString(section.Title)))
		items.WriteByte('\n')
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ko" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>%s</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>%s</h1>
    <ol>
%s    </ol>
  </nav>
</body>
</html>
`, html.EscapeString(title), html.EscapeString(title), items.String())
}

func renderTextEpubSection(bookTitle string, section textEpubSection) string {
	var body strings.Builder
	for _, paragraph := range section.Contents {
		body.WriteString("    <p>")
		body.WriteString(renderTextEpubParagraph(paragraph))
		body.WriteString("</p>\n")
	}

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ko" xml:lang="ko">
<head>
  <meta charset="utf-8"/>
  <title>%s - %s</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
%s  </section>
</body>
</html>
`, html.EscapeString(bookTitle), html.EscapeString(section.Title), body.String())
}

func renderTextEpubParagraph(paragraph string) string {
	escaped := html.EscapeString(paragraph)
	return strings.ReplaceAll(escaped, "\n", "<br/>")
}

const textEpubContainerXML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

const textEpubCSS = `html, body {
  margin: 0;
  padding: 0;
}

body {
  line-height: 1.7;
  word-break: keep-all;
  overflow-wrap: break-word;
}

p {
  margin: 0 0 1em;
  text-indent: 0;
}
`

func readAllZipFile(file *zip.File) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = reader.Close() }()
	return io.ReadAll(reader)
}
