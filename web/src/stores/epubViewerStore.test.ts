import { describe, expect, it } from "vitest";
import { normalizeEpubLineHeightScale } from "./epubViewerStore";

describe("normalizeEpubLineHeightScale", () => {
  it("기존 절대 줄 간격 1.2를 새 배율 범위로 변환한다", () => {
    expect(normalizeEpubLineHeightScale(1.2)).toBe(0.75);
  });

  it("새 배율 값 1.1은 그대로 유지한다", () => {
    expect(normalizeEpubLineHeightScale(1.1)).toBe(1.1);
  });
});
