import type { EpubViewerSettings } from "../../../../stores/epubViewerStore";
import type { EpubRenderLayout } from "../../utils/layoutMode";

export const EPUB_TEXT_STYLE_SELECTOR = `
  body p,
  body div,
  body span,
  body li,
  body dd,
  body dt,
  body blockquote,
  body figcaption,
  body th,
  body td,
  body a:not([href]),
  body h1,
  body h2,
  body h3,
  body h4,
  body h5,
  body h6
`;

const FONT_FAMILY_MAP: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  "sans-serif": "Arial, Helvetica, sans-serif",
};

const THEME_STYLES: Record<string, Record<string, string>> = {
  light: { background: "#ffffff", color: "#1a1a1a" },
  dark: { background: "#1a1a1a", color: "#e0e0e0" },
  sepia: { background: "#f4ecd8", color: "#3b2f2f" },
};

export function getEpubThemeStyle(theme: EpubViewerSettings["theme"]): Record<string, string> {
  return THEME_STYLES[theme] || THEME_STYLES.light;
}

export function buildEpubInjectedStyle(settings: EpubViewerSettings, layout: EpubRenderLayout): string {
  const theme = getEpubThemeStyle(settings.theme);
  const isOriginal = settings.fontFamily === "original";
  const isComic = layout === "comic";
  const fontFamily = FONT_FAMILY_MAP[settings.fontFamily] || "inherit";
  const linkColor = settings.theme === "dark" ? "#7eb8f7" : "#1a6bb5";
  const hasFontSizeOverride = settings.fontSize !== 100;

  if (isComic) {
    return `
      html, body {
        background: ${theme.background} !important;
      }
    `;
  }

  const htmlTypographyRule = hasFontSizeOverride ? `font-size: ${settings.fontSize}% !important;` : "";
  const bodyTypographyRule = `
      ${isOriginal ? "" : `font-family: ${fontFamily} !important;`}
    `;
  const textFontFamilyRule = isOriginal ? "" : `font-family: ${fontFamily} !important;`;

  return `
    html, body {
      background: ${theme.background} !important;
      color: ${theme.color} !important;
    }

    html {
      ${htmlTypographyRule}
    }

    body {
      ${bodyTypographyRule}
      column-fill: auto !important;
      padding-top: 0 !important;
      padding-bottom: 0 !important;
      padding-left: 8px !important;
      padding-right: 8px !important;
    }

    ${EPUB_TEXT_STYLE_SELECTOR} {
      ${textFontFamilyRule}
      color: ${theme.color} !important;
    }

    body a[href] {
      color: ${linkColor} !important;
    }

    [epub\\:type~="titlepage"] h1,
    [epub\\:type~="titlepage"] p,
    [epub\\:type~="titlepage"] hgroup,
    [epub\\:type~="colophon"] h2,
    [epub\\:type~="imprint"] h2,
    [epub\\:type~="halftitlepage"] h1,
    [epub\\:type~="dedication"] h1,
    [epub\\:type~="epigraph"] h1,
    .epub-type-contains-word-titlepage h1,
    .epub-type-contains-word-titlepage p,
    .epub-type-contains-word-colophon h2,
    .epub-type-contains-word-imprint h2,
    .epub-type-contains-word-halftitlepage h1,
    .epub-type-contains-word-dedication h1 {
      position: static !important;
      left: auto !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      visibility: hidden !important;
      display: none !important;
    }

    section, .epub-type-contains-word-section {
      display: block !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      overflow: visible !important;
      height: auto !important;
    }

    .box_brown, .box_white, .box_grey {
      break-inside: avoid !important;
      -webkit-break-inside: avoid !important;
      page-break-inside: avoid !important;
      min-height: 100% !important;
    }

    ${settings.theme !== "dark" ? `
    img[epub\\:type~='se:image.color-depth.black-on-transparent'],
    img.epub-type-contains-word-se-image-color-depth-black-on-transparent {
      filter: none !important;
      background: transparent !important;
    }` : ""}
  `;
}
