import { afterEach, describe, expect, it, vi } from "vitest";
import { applyOldIOSSafariPointerEventFallback } from "./iosTouchFallback";

const isOldIOSSafariMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../../../utils/browserDetect", () => ({
  isOldIOSSafari: isOldIOSSafariMock,
}));

describe("applyOldIOSSafariPointerEventFallback", () => {
  afterEach(() => {
    isOldIOSSafariMock.mockReset();
  });

  it("sets iframe pointerEvents to none for old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const iframe = document.createElement("iframe");
    const doc = {
      defaultView: {
        frameElement: iframe,
      },
    } as unknown as Document;

    applyOldIOSSafariPointerEventFallback(doc);

    expect(iframe.style.pointerEvents).toBe("none");
  });

  it("does not update iframe styles when browser is not old iOS Safari", () => {
    isOldIOSSafariMock.mockReturnValue(false);
    const iframe = document.createElement("iframe");
    iframe.style.pointerEvents = "auto";
    const doc = {
      defaultView: {
        frameElement: iframe,
      },
    } as unknown as Document;

    applyOldIOSSafariPointerEventFallback(doc);

    expect(iframe.style.pointerEvents).toBe("auto");
  });

  it("exits safely when frameElement is missing", () => {
    isOldIOSSafariMock.mockReturnValue(true);
    const doc = {
      defaultView: {
        frameElement: null,
      },
    } as unknown as Document;

    expect(() => applyOldIOSSafariPointerEventFallback(doc)).not.toThrow();
  });
});
