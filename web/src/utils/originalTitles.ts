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

export function localizedOriginalTitle(value: OriginalTitlesValue, locale: string, fallback = ""): string {
  const titles = parseOriginalTitles(value);
  const normalizedFallback = fallback.trim();

  if (normalizedFallback && !Object.values(titles).some((current) => current.trim() === normalizedFallback)) {
    return normalizedFallback;
  }

  const primary = preferredLanguage(locale);
  const order: Array<"ko" | "ja" | "en"> =
    primary === "ko" ? ["ko", "en", "ja"] : primary === "ja" ? ["ja", "en", "ko"] : ["en", "ja", "ko"];

  for (const key of order) {
    const current = titles[key]?.trim();
    if (current) {
      return current;
    }
  }

  return normalizedFallback;
}
