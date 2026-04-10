import type { Series } from "../types/series";

const NATURAL_COLLATOR = new Intl.Collator(["ko", "en"], {
  numeric: true,
  sensitivity: "base",
});

const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function trimSlashes(value: string): string {
  return normalizePathSeparators(value).replace(/^\/+|\/+$/g, "");
}

function normalizeSegment(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function longestMatchingRoot(path: string, roots: string[]): string {
  let matched = "";
  for (const root of roots) {
    const normalizedRoot = trimSlashes(root);
    if (!normalizedRoot) continue;
    if (path === normalizedRoot || path.startsWith(`${normalizedRoot}/`)) {
      if (normalizedRoot.length > matched.length) {
        matched = normalizedRoot;
      }
    }
  }
  return matched;
}

function splitPathSegments(path: string): string[] {
  return trimSlashes(path)
    .split("/")
    .map(normalizeSegment)
    .filter(Boolean);
}

function extractSeriesTitleFromPath(path: string): string {
  const segments = splitPathSegments(path);
  const lastSegment = segments[segments.length - 1] || "";
  const extensionIndex = lastSegment.lastIndexOf(".");
  if (extensionIndex > 0) {
    return lastSegment.slice(0, extensionIndex);
  }
  return lastSegment;
}

export function getSeriesDisplayContext(path: string | undefined, libraryPaths: string[] | undefined): string {
  if (!path || !libraryPaths || libraryPaths.length === 0) {
    return "";
  }

  const normalizedPath = trimSlashes(path);
  if (!normalizedPath) {
    return "";
  }

  const root = longestMatchingRoot(normalizedPath, libraryPaths);
  const relativePath = root
    ? normalizedPath.slice(root.length).replace(/^\/+/, "")
    : normalizedPath;
  const relativeSegments = splitPathSegments(relativePath);
  if (relativeSegments.length <= 1) {
    return "";
  }

  return relativeSegments.slice(0, -1).join(" / ");
}

export function getSeriesDisplayName(series: Series): string {
  const candidate = typeof series.display_title === "string" && series.display_title.trim() !== ""
    ? series.display_title
    : series.title;
  const normalized = normalizeSegment(candidate);
  if (normalized) {
    return normalized;
  }
  return normalizeSegment(extractSeriesTitleFromPath(series.path || ""));
}

export function compareSeriesByDisplayName(a: Series, b: Series): number {
  return NATURAL_COLLATOR.compare(getSeriesDisplayName(a), getSeriesDisplayName(b));
}

export function getSeriesGroupKey(name: string): string {
  const normalized = normalizeSegment(name);
  if (!normalized) {
    return "#";
  }

  const firstChar = normalized[0];
  if (/[0-9]/.test(firstChar)) {
    return "0-9";
  }
  if (/[A-Za-z]/.test(firstChar)) {
    return firstChar.toUpperCase();
  }

  const codePoint = firstChar.charCodeAt(0);
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
    const choseongIndex = Math.floor((codePoint - 0xac00) / 588);
    return CHOSEONG[choseongIndex] || "#";
  }
  if (CHOSEONG.includes(firstChar)) {
    return firstChar;
  }

  // 현재 인덱스는 숫자/영문/한글 초성만 별도 그룹으로 제공한다.
  // 그 외 문자권(가나, 아랍 문자, 특수문자 등)은 의도적으로 '#' 아래에 묶는다.
  return "#";
}
