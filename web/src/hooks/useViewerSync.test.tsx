import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { useViewerSync } from "./useViewerSync";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    progressUpdate: vi.fn().mockResolvedValue(undefined),
    viewerStart: vi.fn().mockResolvedValue(undefined),
    viewerResumeCheck: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock("./useSSE", () => ({
  useSSE: () => ({
    subscribe: mocks.subscribe,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../api/client", () => ({
  progressAPI: {
    update: mocks.progressUpdate,
  },
  viewerAPI: {
    start: mocks.viewerStart,
    resumeCheck: mocks.viewerResumeCheck,
  },
}));

describe("useViewerSync", () => {
  beforeEach(() => {
    mocks.progressUpdate.mockClear();
    mocks.viewerStart.mockClear();
    mocks.viewerResumeCheck.mockClear();
    mocks.subscribe.mockClear();
  });

  it("skips first sync for each chapter and syncs from second page event", async () => {
    const { rerender } = renderHook(
      ({ chapterId, currentPage }) =>
        useViewerSync({
          seriesId: "series-1",
          chapterId,
          currentPage,
          isLoading: false,
        }),
      {
        initialProps: {
          chapterId: "chapter-1",
          currentPage: 30,
        },
      },
    );

    await waitFor(() => expect(mocks.progressUpdate).not.toHaveBeenCalled());

    rerender({ chapterId: "chapter-1", currentPage: 31 });

    await waitFor(() => {
      expect(mocks.progressUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.progressUpdate).toHaveBeenLastCalledWith({
        series_id: "series-1",
        chapter_id: "chapter-1",
        current_page: 31,
      });
    });
  });

  it("does not leak previous chapter page during chapter switch/loading", async () => {
    const { rerender } = renderHook(
      ({ chapterId, currentPage, isLoading }) =>
        useViewerSync({
          seriesId: "series-1",
          chapterId,
          currentPage,
          isLoading,
        }),
      {
        initialProps: {
          chapterId: "chapter-1",
          currentPage: 30,
          isLoading: false,
        },
      },
    );

    rerender({ chapterId: "chapter-1", currentPage: 31, isLoading: false });
    await waitFor(() => expect(mocks.progressUpdate).toHaveBeenCalledTimes(1));

    // chapter switched but loader still stabilizing; old page must not be sent to new chapter
    rerender({ chapterId: "chapter-2", currentPage: 31, isLoading: true });
    rerender({ chapterId: "chapter-2", currentPage: 1, isLoading: true });
    await waitFor(() => expect(mocks.progressUpdate).toHaveBeenCalledTimes(1));

    // first stable event for chapter-2 is skipped
    rerender({ chapterId: "chapter-2", currentPage: 1, isLoading: false });
    await waitFor(() => expect(mocks.progressUpdate).toHaveBeenCalledTimes(1));

    // actual movement in chapter-2 gets synced
    rerender({ chapterId: "chapter-2", currentPage: 2, isLoading: false });
    await waitFor(() => {
      expect(mocks.progressUpdate).toHaveBeenCalledTimes(2);
      expect(mocks.progressUpdate).toHaveBeenLastCalledWith({
        series_id: "series-1",
        chapter_id: "chapter-2",
        current_page: 2,
      });
    });
  });

  it("does not sync page progress when disabled", async () => {
    const { rerender } = renderHook(
      ({ currentPage }) =>
        useViewerSync({
          seriesId: "series-1",
          chapterId: "chapter-1",
          currentPage,
          isLoading: false,
          enablePageProgressSync: false,
        }),
      {
        initialProps: {
          currentPage: 10,
        },
      },
    );

    rerender({ currentPage: 11 });
    rerender({ currentPage: 12 });

    await waitFor(() => {
      expect(mocks.progressUpdate).not.toHaveBeenCalled();
    });
  });

  it("notifies viewer start even when seriesId is empty", async () => {
    renderHook(() =>
      useViewerSync({
        seriesId: "",
        chapterId: "chapter-1",
        currentPage: 1,
        isLoading: false,
      }),
    );

    await waitFor(() => {
      expect(mocks.viewerStart).toHaveBeenCalled();
      expect(mocks.viewerStart).toHaveBeenCalledWith({
        series_id: "",
        chapter_id: "chapter-1",
      });
    });
  });

  it("calls resume-check on visibility/focus/pageshow", async () => {
    renderHook(() =>
      useViewerSync({
        seriesId: "series-1",
        chapterId: "chapter-1",
        currentPage: 10,
        isLoading: false,
      }),
    );

    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));

    await waitFor(() => {
      expect(mocks.viewerResumeCheck).toHaveBeenCalled();
    });
  });

  it("opens terminated modal when resume-check returns VIEWER_TAKEN_OVER", async () => {
    mocks.viewerResumeCheck.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: { code: "VIEWER_TAKEN_OVER" },
      },
    });
    vi.spyOn(axios, "isAxiosError").mockReturnValue(true);

    const { result } = renderHook(() =>
      useViewerSync({
        seriesId: "series-1",
        chapterId: "chapter-1",
        currentPage: 10,
        isLoading: false,
      }),
    );

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(result.current.terminatedInfo.isOpen).toBe(true);
      expect(result.current.terminatedInfo.reason).toBe("viewer.session.force_logout_message");
    });
  });
});
