import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewerNavigation } from "./useViewerNavigation";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const goToPageMock = vi.fn();
  const startChapterSwitchingMock = vi.fn();
  const saveProgressMock = vi.fn(async () => {});

  const useViewerStoreMock = vi.fn(() => ({
    goToPage: goToPageMock,
  }));

  return {
    mocks: {
      navigateMock,
      goToPageMock,
      startChapterSwitchingMock,
      saveProgressMock,
      useViewerStoreMock,
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigateMock,
  useLocation: () => ({ state: { from: "/series/1" } }),
}));

vi.mock("../../../stores/viewerStore", () => ({
  useViewerStore: mocks.useViewerStoreMock,
}));

vi.mock("../../../stores/fullscreenSwitchStore", () => ({
  startChapterSwitching: (...args: unknown[]) => mocks.startChapterSwitchingMock(...args),
}));

vi.mock("../../../utils/fullscreen", () => ({
  isFullscreen: () => true,
}));

describe("useViewerNavigation fullscreen switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets chapter switching before navigating to next chapter", async () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "single",
        clickDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: new Map(),
        nextChapterId: "next-chapter",
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    await act(async () => {
      await result.current.handleNext();
    });
    expect(result.current.showNextHint).toBe(true);
    expect(mocks.navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mocks.saveProgressMock).toHaveBeenCalledTimes(1);
    expect(mocks.startChapterSwitchingMock).toHaveBeenCalledWith(true);
    expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/next-chapter", {
      replace: true,
      state: { from: "/series/1" },
    });
  });
});
