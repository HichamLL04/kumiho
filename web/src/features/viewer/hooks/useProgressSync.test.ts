import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProgressSync } from "./useProgressSync";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const startChapterSwitchingMock = vi.fn();
  const finishChapterSwitchingMock = vi.fn();
  const volumeGetMock = vi.fn();
  const compareProgressMock = vi.fn();

  return {
    mocks: {
      navigateMock,
      startChapterSwitchingMock,
      finishChapterSwitchingMock,
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
  finishChapterSwitching: (...args: unknown[]) => mocks.finishChapterSwitchingMock(...args),
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
          anchor_page: 7,
          offset_ratio: 0,
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
    expect(mocks.finishChapterSwitchingMock).not.toHaveBeenCalled();
    expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/chapter-sync?page=7&anchor=7&offset=0", {
      replace: true,
      state: { from: "/series/1" },
    });
  });

  it("does not keep chapter-switch flag when sync target chapter is same", async () => {
    mocks.volumeGetMock.mockResolvedValue({
      data: { volume_number: 1 },
    });
    mocks.compareProgressMock.mockResolvedValue({
      data: {
        server_ahead: true,
        server_progress: {
          volume_number: 1,
          chapter_number: 1,
          current_page: 8,
          anchor_page: 8,
          offset_ratio: 0,
          chapter_id: "chapter-1",
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

    expect(mocks.startChapterSwitchingMock).not.toHaveBeenCalled();
    expect(mocks.finishChapterSwitchingMock).toHaveBeenCalledTimes(1);
    expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/chapter-1?page=8&anchor=8&offset=0", {
      replace: true,
      state: { from: "/series/1", skipSyncCheck: true },
    });
  });

  it("does not open sync modal when server page matches current page", async () => {
    mocks.volumeGetMock.mockResolvedValue({
      data: { volume_number: 1 },
    });
    mocks.compareProgressMock.mockResolvedValue({
      data: {
        server_ahead: true,
        server_progress: {
          volume_number: 1,
          chapter_number: 1,
          current_page: 6,
          anchor_page: 6,
          offset_ratio: 0,
          chapter_id: "chapter-1",
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
        currentPage: 6,
        isLoading: false,
      }),
    );

    await waitFor(() => {
      expect(mocks.compareProgressMock).toHaveBeenCalledTimes(1);
    });

    expect(result.current.showSyncModal).toBe(false);
  });

  it("does not compare progress before restore is settled", async () => {
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
        isRestoreSettled: false,
      }),
    );

    await waitFor(() => {
      expect(mocks.compareProgressMock).not.toHaveBeenCalled();
    });

    expect(result.current.showSyncModal).toBe(false);
  });

  it("compares progress only after restore settles", async () => {
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
          anchor_page: 7,
          offset_ratio: 0,
          chapter_id: "chapter-sync",
          volume_id: "volume-1",
        },
      },
    });

    const chapter = {
      id: "chapter-1",
      volume_id: "volume-1",
      title: "chapter",
      chapter_number: 1,
      page_count: 10,
    };

    const { result, rerender } = renderHook(
      ({ isRestoreSettled }) =>
        useProgressSync({
          seriesId: "series-1",
          chapter,
          currentPage: 3,
          isLoading: false,
          isRestoreSettled,
        }),
      {
        initialProps: { isRestoreSettled: false },
      },
    );

    await waitFor(() => {
      expect(mocks.compareProgressMock).not.toHaveBeenCalled();
    });

    rerender({ isRestoreSettled: true });

    await waitFor(() => {
      expect(mocks.compareProgressMock).toHaveBeenCalledTimes(1);
      expect(result.current.showSyncModal).toBe(true);
    });
  });
});
