export type OriginalTitlesValue = Record<string, string> | string | null | undefined;

function parseOriginalTitles(value: OriginalTitlesValue): Record<string, string> {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    return {};
  }

  return {};
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
  const titles = parseOriginalTitles(value);
  const normalizedFallback = fallback.trim();

  if (normalizedFallback && !Object.values(titles).some((current) => current.trim() === normalizedFallback)) {
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
): Array<{ language: "ko" | "ja" | "en"; title: string }> {
  const titles = parseOriginalTitles(value);
  const order = preferredLanguageOrder(locale);
  const items: Array<{ language: "ko" | "ja" | "en"; title: string }> = [];
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
    items.push({ language: order[0], title: normalizedFallback });
  }

  return items;
}
