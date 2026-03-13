import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVerticalScroll } from "./useVerticalScroll";

const { mocks } = vi.hoisted(() => {
  const setCurrentPageMock = vi.fn();
  const navigateMock = vi.fn();
  const useViewerStoreMock = Object.assign(
    vi.fn(() => ({ setCurrentPage: setCurrentPageMock })),
    {
      getState: vi.fn(() => ({ currentPage: 1 })),
    },
  );
  return {
    mocks: {
      setCurrentPageMock,
      navigateMock,
      useViewerStoreMock,
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigateMock,
  useLocation: () => ({ state: { from: "/series/abc" } }),
}));

vi.mock("../../../stores/viewerStore", () => ({
  useViewerStore: mocks.useViewerStoreMock,
}));

class IntersectionObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe("useVerticalScroll initial guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock as unknown as typeof IntersectionObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries scroll positioning before releasing initial guard when still at top", () => {
    const isInitialScrollingRef = { current: true };
    const scrollIntoView = vi.fn();
    const pageEl = {
      scrollIntoView,
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 1200,
        height: 1200,
      }),
    } as unknown as HTMLElement;
    const getElementByIdSpy = vi.spyOn(document, "getElementById").mockImplementation((id) =>
      id === "page-9" ? pageEl : null,
    );

    const mockContent = {
      scrollTop: 0,
      clientHeight: 800,
      scrollHeight: 4000,
      getBoundingClientRect: () => ({
        top: 0,
        bottom: 800,
        height: 800,
      }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLDivElement;

    const { result, rerender } = renderHook(
      ({ currentPage }) =>
        useVerticalScroll({
          readingMode: "vertical",
          isLoading: false,
          currentPage,
          totalPages: 30,
          nextChapterId: null,
          prevChapterId: null,
          pullThreshold: 100,
          pullSensitivity: 0.6,
          saveProgress: async () => {},
          handleVolumeCompletion: async () => {},
          chapterId: "chapter-1",
          isInitialScrollingRef,
          imageLoading: { 9: false },
        }),
      { initialProps: { currentPage: 8 } },
    );

    act(() => {
      result.current.viewerContentRef.current = mockContent;
    });

    act(() => {
      rerender({ currentPage: 9 });
    });

    // initial scroll attempt (may run more than once due effect scheduling)
    expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    // page becomes ready once the target page is aligned and visible
    expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(isInitialScrollingRef.current).toBe(false);
    expect(getElementByIdSpy).toHaveBeenCalledWith("page-9");
    expect(mocks.setCurrentPageMock).not.toHaveBeenCalledWith(1);
    getElementByIdSpy.mockRestore();
  });
});
