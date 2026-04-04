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

  it("keeps fallback when it represents a legacy manual original title", () => {
    expect(localizedOriginalTitle({ ko: "현지 제목" }, "ko", "Fallback Title")).toBe("Fallback Title");
    expect(localizedOriginalTitle({}, "ko", "Fallback Title")).toBe("Fallback Title");
  });

  it("prefers configured language order from original_titles when fallback is empty or already matches", () => {
    const originalTitles = {
      ko: "한국어 원제",
      en: "English Title",
      ja: "日本語タイトル",
    };

    expect(localizedOriginalTitle(originalTitles, "ko", "")).toBe("한국어 원제");
    expect(localizedOriginalTitle(originalTitles, "ko", "English Title")).toBe("한국어 원제");
    expect(localizedOriginalTitle({ en: "English Title", ja: "日本語タイトル" }, "ko", "")).toBe(
      "English Title",
    );
    expect(localizedOriginalTitle({ ja: "日本語タイトル" }, "ko", "")).toBe("日本語タイトル");
  });

  it("prefers manually entered original_title when _manual_title marker is present", () => {
    const originalTitles = {
      ko: "한국어 원제",
      en: "English Title",
      _manual_title: "Manual Original Title",
    } as unknown as Record<string, string>;

    expect(localizedOriginalTitle(originalTitles, "ko", "Manual Original Title")).toBe("Manual Original Title");
    expect(localizedOriginalTitle(originalTitles, "ja", "Manual Original Title")).toBe("Manual Original Title");
  });

  it("prefers legacy manual fallback when it does not match original_titles values", () => {
    expect(
      localizedOriginalTitle({ ko: "한국어 원제", en: "English Title" }, "ko", "Legacy Manual Original Title"),
    ).toBe("Legacy Manual Original Title");
    expect(localizedOriginalTitle({ en: "English Title" }, "ko", "Legacy Manual Original Title")).toBe(
      "Legacy Manual Original Title",
    );
    expect(localizedOriginalTitle({}, "ko", "Legacy Manual Original Title")).toBe("Legacy Manual Original Title");
  });
});
