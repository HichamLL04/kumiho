import { describe, expect, it } from "vitest";
import { measureVirtualPaging } from "./textViewerPaging";

type TestScrollContainer = Parameters<typeof measureVirtualPaging>[0] & { clientWidth: number };

describe("textViewerPaging", () => {
  it("측정값이 vertical (1-step)에서 뷰포트 높이 기준으로 계산된다", () => {
    const container: TestScrollContainer = {
      clientHeight: 500,
      scrollWidth: 500,
      scrollHeight: 2200,
      scrollLeft: 0,
      scrollTop: 1000,
      clientWidth: 500,
    };

    const metrics = measureVirtualPaging(container, "vertical");
    expect(metrics.totalPages).toBe(5);
    expect(metrics.currentPage).toBe(3);
    expect(metrics.isAtVisualStart).toBe(false);
    expect(metrics.isAtVisualEnd).toBe(false);
  });

  it("single 모드 (가로) 에서는 뷰포트 너비 기준으로 페이지가 계산된다", () => {
    const container: TestScrollContainer = {
      clientHeight: 800,
      scrollWidth: 3000,
      scrollHeight: 800,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 600,
    };

    const metrics = measureVirtualPaging(container, "single", 1200);
    expect(metrics.totalPages).toBe(5); // 3000 / 600
    expect(metrics.currentPage).toBe(3); // 1200 / 600 + 1
  });

  it("double 모드 (가로 양면) 에서는 뷰포트 너비(2페이지 넓이) 기준으로 페이지가 계산된다", () => {
    const container: TestScrollContainer = {
      clientHeight: 800,
      scrollWidth: 3000,
      scrollHeight: 800,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1000, // 양면이므로 뷰포트가 더 넓음
    };

    const metrics = measureVirtualPaging(container, "double", 1000);
    expect(metrics.totalPages).toBe(6); // 3000 / 1000 * 2
    expect(metrics.currentPage).toBe(3); // (1000 / 1000) * 2 + 1
  });

  it("가로 페이지 모드에서는 마지막 전 페이지를 visual end로 오판하지 않는다", () => {
    const container: TestScrollContainer = {
      clientHeight: 800,
      scrollWidth: 2001,
      scrollHeight: 800,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1000,
    };

    const metrics = measureVirtualPaging(container, "single", 1000);
    expect(metrics.totalPages).toBe(3);
    expect(metrics.currentPage).toBe(2);
    expect(metrics.isAtVisualEnd).toBe(false);
    expect(metrics.maxScrollLeft).toBe(2000);
  });

  it("content width override가 있으면 가로 총 페이지 수가 translate 영향 없이 유지된다", () => {
    const container: TestScrollContainer = {
      clientHeight: 800,
      scrollWidth: 1600,
      scrollHeight: 800,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 1000,
    };

    const metrics = measureVirtualPaging(container, "single", 2000, 5000);
    expect(metrics.totalPages).toBe(5);
    expect(metrics.currentPage).toBe(3);
    expect(metrics.maxScrollLeft).toBe(4000);
  });
});
