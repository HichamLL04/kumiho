export type OriginalTitlesValue =
  | Record<string, string>
  | string
  | null
  | undefined;
export type OriginalTitleLanguage = "ko" | "ja" | "en" | "unknown";

const MANUAL_ORIGINAL_TITLE_KEY = "_manual_title";

function normalizeOriginalTitles(
  value: Record<string, unknown>,
): Partial<Record<Exclude<OriginalTitleLanguage, "unknown">, string>> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (
        (key !== "ko" && key !== "ja" && key !== "en") ||
        typeof entry !== "string"
      ) {
        return [];
      }

      const normalized = entry.trim();
      return normalized ? [[key, normalized]] : [];
    }),
  );
}

function parseOriginalTitlesPayload(value: OriginalTitlesValue): {
  titles: Partial<Record<Exclude<OriginalTitleLanguage, "unknown">, string>>;
  manualTitle: string;
} {
  if (!value) {
    return { titles: {}, manualTitle: "" };
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return { titles: {}, manualTitle: "" };
    }
    const manual = value[MANUAL_ORIGINAL_TITLE_KEY];
    return {
      titles: normalizeOriginalTitles(value),
      manualTitle: typeof manual === "string" ? manual.trim() : "",
    };
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const payload = parsed as Record<string, unknown>;
      const manual = payload[MANUAL_ORIGINAL_TITLE_KEY];
      return {
        titles: normalizeOriginalTitles(payload),
        manualTitle: typeof manual === "string" ? manual.trim() : "",
      };
    }
  } catch {
    return { titles: {}, manualTitle: "" };
  }

  return { titles: {}, manualTitle: "" };
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
  return primary === "ko"
    ? ["ko", "en", "ja"]
    : primary === "ja"
      ? ["ja", "en", "ko"]
      : ["en", "ja", "ko"];
}

export function localizedOriginalTitle(
  value: OriginalTitlesValue,
  locale: string,
  fallback = "",
): string {
  const { titles, manualTitle } = parseOriginalTitlesPayload(value);
  const normalizedFallback = fallback.trim();

  if (manualTitle && normalizedFallback && manualTitle === normalizedFallback) {
    return normalizedFallback;
  }

  const matchesFallback = normalizedFallback
    ? Object.values(titles).some(
        (title) => title?.trim() === normalizedFallback,
      )
    : false;

  if (!manualTitle && normalizedFallback && !matchesFallback) {
    return normalizedFallback;
  }

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
  const { titles } = parseOriginalTitlesPayload(value);
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
