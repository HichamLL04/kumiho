import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  useExitFullscreenOnViewerUnmount,
  useRestoreFullscreenAfterChapterSwitch,
} from "./useFullscreenChapterSwitch";

const { mocks } = vi.hoisted(() => {
  const getFullscreenSwitchStateMock = vi.fn();
  const finishChapterSwitchingMock = vi.fn();
  const isFullscreenMock = vi.fn();
  const enterFullscreenMock = vi.fn();
  const exitFullscreenMock = vi.fn();

  return {
    mocks: {
      getFullscreenSwitchStateMock,
      finishChapterSwitchingMock,
      isFullscreenMock,
      enterFullscreenMock,
      exitFullscreenMock,
    },
  };
});

vi.mock("../../../stores/fullscreenSwitchStore", () => ({
  getFullscreenSwitchState: () => mocks.getFullscreenSwitchStateMock(),
  finishChapterSwitching: (...args: unknown[]) => mocks.finishChapterSwitchingMock(...args),
}));

vi.mock("../../../utils/fullscreen", () => ({
  isFullscreen: () => mocks.isFullscreenMock(),
  enterFullscreen: (...args: unknown[]) => mocks.enterFullscreenMock(...args),
  exitFullscreen: (...args: unknown[]) => mocks.exitFullscreenMock(...args),
}));

describe("useFullscreenChapterSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enterFullscreenMock.mockResolvedValue(undefined);
    mocks.exitFullscreenMock.mockResolvedValue(undefined);
  });

  it("restores fullscreen when switch flag is set and always finishes switching", async () => {
    mocks.getFullscreenSwitchStateMock.mockReturnValue({
      isChapterSwitching: true,
      shouldRestoreFullscreenAfterSwitch: true,
    });
    mocks.isFullscreenMock.mockReturnValue(false);

    renderHook(() => useRestoreFullscreenAfterChapterSwitch("chapter-2"));

    await waitFor(() => {
      expect(mocks.enterFullscreenMock).toHaveBeenCalledTimes(1);
      expect(mocks.finishChapterSwitchingMock).toHaveBeenCalledTimes(1);
    });
  });

  it("exits fullscreen on unmount when viewer is leaving without chapter switching", () => {
    mocks.getFullscreenSwitchStateMock.mockReturnValue({
      isChapterSwitching: false,
      shouldRestoreFullscreenAfterSwitch: false,
    });
    mocks.isFullscreenMock.mockReturnValue(true);

    const { unmount } = renderHook(() => useExitFullscreenOnViewerUnmount());
    unmount();

    expect(mocks.exitFullscreenMock).toHaveBeenCalledTimes(1);
  });
});
