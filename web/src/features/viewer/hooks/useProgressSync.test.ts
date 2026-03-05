import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProgressSync } from "./useProgressSync";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const startChapterSwitchingMock = vi.fn();
  const volumeGetMock = vi.fn();
  const compareProgressMock = vi.fn();

  return {
    mocks: {
      navigateMock,
      startChapterSwitchingMock,
      volumeGetMock,
      compareProgressMock,
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigateMock,
  useLocation: () => ({ state: { from: "/series/1" } }),
}));

vi.mock("../../../stores/fullscreenSwitchStore", () => ({
  startChapterSwitching: (...args: unknown[]) => mocks.startChapterSwitchingMock(...args),
}));

vi.mock("../../../utils/fullscreen", () => ({
  isFullscreen: () => true,
}));

vi.mock("../../../api/client", () => ({
  seriesAPI: {
    compareProgress: (...args: unknown[]) => mocks.compareProgressMock(...args),
  },
  volumeAPI: {
    get: (...args: unknown[]) => mocks.volumeGetMock(...args),
  },
}));

describe("useProgressSync fullscreen switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets chapter switching before sync navigation", async () => {
    mocks.volumeGetMock.mockResolvedValue({
      data: { volume_number: 1 },
    });
    mocks.compareProgressMock.mockResolvedValue({
      data: {
        server_ahead: true,
        server_progress: {
          volume_number: 1,
          chapter_number: 2,
          current_page: 7,
          chapter_id: "chapter-sync",
          volume_id: "volume-1",
        },
      },
    });

    const { result } = renderHook(() =>
      useProgressSync({
        seriesId: "series-1",
        chapter: {
          id: "chapter-1",
          volume_id: "volume-1",
          title: "chapter",
          chapter_number: 1,
          page_count: 10,
        },
        currentPage: 3,
        isLoading: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.showSyncModal).toBe(true);
    });

    act(() => {
      result.current.handleConfirmSync();
    });

    expect(mocks.startChapterSwitchingMock).toHaveBeenCalledWith(true);
    expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/chapter-sync?page=7", {
      replace: true,
      state: { from: "/series/1" },
    });
  });
});
