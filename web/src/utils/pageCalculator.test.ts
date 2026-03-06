import { describe, expect, it } from "vitest";
import { getInitialSubPage, getNextNavState, getPrevNavState } from "./pageCalculator";
import type { PageMeta } from "../features/viewer/types";

const createPageMeta = (pageNumber: number, isWide: boolean): PageMeta => ({
  pageNumber,
  isWide,
  width: isWide ? 2600 : 1200,
  height: 1600,
});

const createPageMetaMap = (widePages: number[]): Map<number, PageMeta> =>
  new Map(widePages.map((page) => [page, createPageMeta(page, true)]));

describe("pageCalculator split navigation", () => {
  it("returns null for non-wide page initial subPage", () => {
    const pageMetaMap = createPageMetaMap([]);
    expect(getInitialSubPage(1, pageMetaMap, "ltr")).toBeNull();
  });

  it("returns first subPage based on reading direction for wide page", () => {
    const pageMetaMap = createPageMetaMap([2]);
    expect(getInitialSubPage(2, pageMetaMap, "ltr")).toBe("left");
    expect(getInitialSubPage(2, pageMetaMap, "rtl")).toBe("right");
  });

  it("moves within wide page first on next navigation", () => {
    const pageMetaMap = createPageMetaMap([2]);
    expect(getNextNavState(2, 5, "left", pageMetaMap, "ltr")).toEqual({
      page: 2,
      subPage: "right",
    });
    expect(getNextNavState(2, 5, "right", pageMetaMap, "rtl")).toEqual({
      page: 2,
      subPage: "left",
    });
  });

  it("returns null on chapter end in next navigation", () => {
    const pageMetaMap = createPageMetaMap([3]);
    expect(getNextNavState(3, 3, "right", pageMetaMap, "ltr")).toBeNull();
  });

  it("sets initial subPage when entering next wide page", () => {
    const pageMetaMap = createPageMetaMap([3]);
    expect(getNextNavState(2, 5, null, pageMetaMap, "ltr")).toEqual({
      page: 3,
      subPage: "left",
    });
    expect(getNextNavState(2, 5, null, pageMetaMap, "rtl")).toEqual({
      page: 3,
      subPage: "right",
    });
  });

  it("moves within wide page first on previous navigation", () => {
    const pageMetaMap = createPageMetaMap([2]);
    expect(getPrevNavState(2, "right", pageMetaMap, "ltr")).toEqual({
      page: 2,
      subPage: "left",
    });
    expect(getPrevNavState(2, "left", pageMetaMap, "rtl")).toEqual({
      page: 2,
      subPage: "right",
    });
  });

  it("returns null on chapter start in previous navigation", () => {
    const pageMetaMap = createPageMetaMap([1]);
    expect(getPrevNavState(1, "left", pageMetaMap, "ltr")).toBeNull();
  });

  it("sets last subPage when entering previous wide page", () => {
    const pageMetaMap = createPageMetaMap([2]);
    expect(getPrevNavState(3, null, pageMetaMap, "ltr")).toEqual({
      page: 2,
      subPage: "right",
    });
    expect(getPrevNavState(3, null, pageMetaMap, "rtl")).toEqual({
      page: 2,
      subPage: "left",
    });
  });
});
