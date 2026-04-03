import { describe, expect, it } from "vitest";
import { localizedOriginalTitle, orderedOriginalTitles } from "./originalTitles";

describe("originalTitles utils", () => {
  it("filters non-string object values before reading titles", () => {
    const value = {
      ko: "  한국어 제목  ",
      en: 123,
      ja: null,
      nested: { foo: "bar" },
    } as unknown as Record<string, string>;

    expect(localizedOriginalTitle(value, "ko")).toBe("한국어 제목");
    expect(orderedOriginalTitles(value, "ko")).toEqual([{ language: "ko", title: "한국어 제목" }]);
  });

  it("marks unmatched fallback titles as unknown instead of mislabeling locale language", () => {
    expect(orderedOriginalTitles("{}", "ko", "Original Title")).toEqual([
      { language: "unknown", title: "Original Title" },
    ]);
  });

  it("prefers localized titles before using a fallback title", () => {
    expect(localizedOriginalTitle({ ko: "현지 제목" }, "ko", "Fallback Title")).toBe("현지 제목");
    expect(localizedOriginalTitle({}, "ko", "Fallback Title")).toBe("Fallback Title");
  });
});
