export function normalizeAppLanguage(value: unknown): string {
  if (typeof value !== "string") return "ko";

  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("ko")) return "ko";
  if (normalized.startsWith("en")) return "en";
  if (normalized.startsWith("ja")) return "ja";
  return "ko";
}
