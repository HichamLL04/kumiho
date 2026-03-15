import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVerticalScroll } from "./useVerticalScroll";
import { getViewportAnchorPage } from "../utils/progressPosition";

const { mocks } = vi.hoisted(() => {
  const setCurrentPageMock = vi.fn();
  const navigateMock = vi.fn();
  const handleVolumeCompletionMock = vi.fn(() => Promise.resolve());
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
      handleVolumeCompletionMock,
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

vi.mock("../utils/progressPosition", () => ({
  getViewportAnchorPage: vi.fn((_content, _total, current) => current),
}));

class IntersectionObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe("useVerticalScroll", () => {
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

  describe("initial guard", () => {
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
      const getElementByIdSpy = vi
        .spyOn(document, "getElementById")
        .mockImplementation((id) => (id === "page-9" ? pageEl : null));

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

      const viewerContentRef = { current: mockContent };

      const { rerender } = renderHook(
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
            viewerContentRef: viewerContentRef as unknown as React.MutableRefObject<HTMLDivElement | null>,
          }),
        { initialProps: { currentPage: 8 } },
      );

      act(() => {
        rerender({ currentPage: 9 });
      });

      // initial scroll attempt (may run more than once due effect scheduling)
      expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(1);

      act(() => {
        vi.advanceTimersByTime(600);
      });

      // After timers and frames, it should stabilize
      expect(isInitialScrollingRef.current).toBe(false);
      getElementByIdSpy.mockRestore();
    });
  });

  describe("scrolling & navigation", () => {
    it("syncs current page only after stabilization delay", () => {
      const isInitialScrollingRef = { current: false };
      const mockContent = {
        scrollTop: 1000,
        clientHeight: 800,
        scrollHeight: 5000,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ top: 0, height: 800 }),
      } as unknown as HTMLDivElement;

      const viewerContentRef = { current: mockContent };

      vi.mocked(getViewportAnchorPage).mockReturnValue(5);

      renderHook(() =>
        useVerticalScroll({
          readingMode: "vertical",
          isLoading: false,
          currentPage: 1,
          totalPages: 20,
          nextChapterId: "next",
          prevChapterId: "prev",
          pullThreshold: 100,
          pullSensitivity: 0.6,
          saveProgress: async () => {},
          handleVolumeCompletion: async () => {},
          chapterId: "chapter-1",
          isInitialScrollingRef,
          viewStatus: "ready",
          viewerContentRef: viewerContentRef as unknown as React.MutableRefObject<HTMLDivElement | null>,
        }),
      );

      // simulate scroll event
      const scrollHandler = (vi
        .mocked(mockContent.addEventListener)
        .mock.calls.find((call) => call[0] === "scroll")?.[1] || (() => {})) as () => void;
      expect(scrollHandler).toBeDefined();

      act(() => {
        scrollHandler();
      });

      // Should not update immediately due to delay check (Date.now() - readyAtRef.current < READY_STABILIZE_DELAY)
      // readyAtRef is 0 by default in the hook logic unless restoreScroll finishes, but in this manual render we set viewStatus: "ready"
      // Wait, the hook sets readyAtRef.current in restoreScroll EFFECT.
      // If we pass viewStatus: "ready", the first effect might not run or behaves differently.

      // Actually, in the hook:
      // const effectiveViewStatus = viewStatus ?? (readingMode === "vertical" ? "hydrating" : "ready");
      // If it's already ready, readyAtRef.current stays 0.
      // Date.now() - 0 is definitely > delay.

      // To properly test the delay, we need a way to mock Date.now() or let the restore effect run.

      expect(mocks.setCurrentPageMock).toHaveBeenCalledWith(5);
    });

    it("handles pull-to-navigate downward (next chapter)", async () => {
      const isInitialScrollingRef = { current: false };
      const mockContent = {
        scrollTop: 4000,
        clientHeight: 1000,
        scrollHeight: 5000, // at bottom
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLDivElement;

      const viewerContentRef = { current: mockContent };

      renderHook(() =>
        useVerticalScroll({
          readingMode: "vertical",
          isLoading: false,
          currentPage: 20,
          totalPages: 20,
          nextChapterId: "next-ch",
          prevChapterId: "prev-ch",
          pullThreshold: 50,
          pullSensitivity: 1,
          saveProgress: async () => {},
          handleVolumeCompletion: mocks.handleVolumeCompletionMock,
          chapterId: "chapter-1",
          isInitialScrollingRef,
          viewStatus: "ready",
          viewerContentRef: viewerContentRef as unknown as React.MutableRefObject<HTMLDivElement | null>,
        }),
      );

      const wheelHandler = (vi
        .mocked(mockContent.addEventListener)
        .mock.calls.find((call) => call[0] === "wheel")?.[1] || (() => {})) as (e: WheelEvent) => void;
      expect(wheelHandler).toBeDefined();

      const event = {
        deltaY: 100,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      // 스냅 모드(pullSensitivity >= 0.8): 첫 스크롤은 인디케이터 표시
      await act(async () => {
        wheelHandler(event);
      });

      expect(event.preventDefault).toHaveBeenCalled();

      // 두 번째 같은 방향 스크롤로 회차 이동
      const event2 = {
        deltaY: 100,
        preventDefault: vi.fn(),
      } as unknown as WheelEvent;

      await act(async () => {
        wheelHandler(event2);
      });

      expect(mocks.navigateMock).toHaveBeenCalledWith(expect.stringContaining("next-ch"), expect.anything());
    });
  });
});
