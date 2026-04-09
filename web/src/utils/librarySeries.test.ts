import { describe, expect, it } from "vitest";

import type { Series } from "../types/series";
import { compareSeriesByDisplayName, getSeriesDisplayContext, getSeriesDisplayName, getSeriesGroupKey } from "./librarySeries";

function createSeries(overrides: Partial<Series>): Series {
  return {
    id: "series-id",
    library_id: "library-id",
    title: "기본 제목",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("librarySeries helpers", () => {
  it("builds parent path context relative to the longest library root", () => {
    const context = getSeriesDisplayContext(
      "/books/만화(정발)/1.단편/[ ㄱ ]/가면라이더",
      ["/books", "/books/만화(정발)"],
    );

    expect(context).toBe("1.단편 / [ ㄱ ]");
  });

  it("returns empty context for direct children of the library root", () => {
    const context = getSeriesDisplayContext("/books/가면라이더", ["/books"]);
    expect(context).toBe("");
  });

  it("prefers display_title over title for display name", () => {
    const name = getSeriesDisplayName(
      createSeries({
        title: "Part 1",
        display_title: "초인의 시대 / Part 1",
      }),
    );

    expect(name).toBe("초인의 시대 / Part 1");
  });

  it("uses natural sorting for display names", () => {
    const items = [
      createSeries({ id: "3", title: "Part 10" }),
      createSeries({ id: "1", title: "Part 1" }),
      createSeries({ id: "2", title: "Part 2" }),
    ];

    items.sort(compareSeriesByDisplayName);

    expect(items.map((item) => item.title)).toEqual(["Part 1", "Part 2", "Part 10"]);
  });

  it("groups names by chosung, latin initial, and digits", () => {
    expect(getSeriesGroupKey("가면라이더")).toBe("ㄱ");
    expect(getSeriesGroupKey("Part 2")).toBe("P");
    expect(getSeriesGroupKey("86 - Eighty Six")).toBe("0-9");
  });
});
