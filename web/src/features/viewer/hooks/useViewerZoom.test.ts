import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewerZoom } from "./useViewerZoom";

const { mocks } = vi.hoisted(() => {
  const toggleUIMock = vi.fn();
  return {
    mocks: {
      toggleUIMock,
    },
  };
});

vi.mock("../../../stores/viewerStore", () => ({
  useViewerStore: {
    getState: () => ({
      toggleUI: mocks.toggleUIMock,
    }),
  },
}));

describe("useViewerZoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a center single click after a completed mouse double click", () => {
    const onVerticalZoomToggle = vi.fn();
    const { result } = renderHook(() =>
      useViewerZoom({
        clickDirection: "ltr",
        onNext: vi.fn(),
        onPrev: vi.fn(),
        isVerticalMode: true,
        onVerticalZoomToggle,
        deferSingleTapForDoubleTap: true,
        doubleTapZoomZone: "center",
      }),
    );

    const createMouseClickEvent = (detail: number) =>
      ({
        nativeEvent: new MouseEvent("click", { detail, clientX: 640, clientY: 360 }),
        clientX: 640,
        clientY: 360,
        target: document.createElement("div"),
      }) as unknown as React.MouseEvent;

    act(() => {
      result.current.handleContentClick(createMouseClickEvent(1), { current: null });
      result.current.handleContentClick(createMouseClickEvent(2), { current: null });
      result.current.handleContentClick(createMouseClickEvent(1), { current: null });
    });

    expect(onVerticalZoomToggle).toHaveBeenCalledTimes(1);
    expect(mocks.toggleUIMock).toHaveBeenCalledTimes(2);
  });
});
