export type OriginalTitlesValue = Record<string, string> | string | null | undefined;
export type OriginalTitleLanguage = "ko" | "ja" | "en" | "unknown";

const MANUAL_ORIGINAL_TITLE_KEY = "_manual_title";

function normalizeOriginalTitles(
  value: Record<string, unknown>,
): Partial<Record<Exclude<OriginalTitleLanguage, "unknown">, string>> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if ((key !== "ko" && key !== "ja" && key !== "en") || typeof entry !== "string") {
        return [];
      }

      const normalized = entry.trim();
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

function parseOriginalTitles(value: OriginalTitlesValue): Partial<Record<Exclude<OriginalTitleLanguage, "unknown">, string>> {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return {};
    }
    return normalizeOriginalTitles(value);
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeOriginalTitles(parsed);
    }
  } catch {
    return {};
  }

  return {};
}

function parseManualOriginalTitle(value: OriginalTitlesValue): string {
  if (!value) {
    return "";
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return "";
    }
    const manual = value[MANUAL_ORIGINAL_TITLE_KEY];
    return typeof manual === "string" ? manual.trim() : "";
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const manual = (parsed as Record<string, unknown>)[MANUAL_ORIGINAL_TITLE_KEY];
      return typeof manual === "string" ? manual.trim() : "";
    }
  } catch {
    return "";
  }

  return "";
}

function preferredLanguage(locale: string): "ko" | "ja" | "en" {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith("ko")) {
    return "ko";
  }
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  return "en";
}

function preferredLanguageOrder(locale: string): Array<"ko" | "ja" | "en"> {
  const primary = preferredLanguage(locale);
  return primary === "ko" ? ["ko", "en", "ja"] : primary === "ja" ? ["ja", "en", "ko"] : ["en", "ja", "ko"];
}

export function localizedOriginalTitle(value: OriginalTitlesValue, locale: string, fallback = ""): string {
  const manualTitle = parseManualOriginalTitle(value);
  const normalizedFallback = fallback.trim();
  if (manualTitle && normalizedFallback && manualTitle === normalizedFallback) {
    return normalizedFallback;
  }

  const titles = parseOriginalTitles(value);
  const order = preferredLanguageOrder(locale);

  for (const key of order) {
    const current = titles[key]?.trim();
    if (current) {
      return current;
    }
  }

  return normalizedFallback;
}

export function orderedOriginalTitles(
  value: OriginalTitlesValue,
  locale: string,
  fallback = "",
): Array<{ language: OriginalTitleLanguage; title: string }> {
  const titles = parseOriginalTitles(value);
  const order = preferredLanguageOrder(locale);
  const items: Array<{ language: OriginalTitleLanguage; title: string }> = [];
  const seen = new Set<string>();

  for (const language of order) {
    const title = titles[language]?.trim();
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);
    items.push({ language, title });
  }

  const normalizedFallback = fallback.trim();
  if (normalizedFallback && !seen.has(normalizedFallback)) {
    items.push({ language: "unknown", title: normalizedFallback });
  }

  return items;
}
