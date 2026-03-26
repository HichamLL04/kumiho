import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEpubInjectedStyle } from "./styleBuilder";
import { applyOldIOSSafariPointerEventFallback } from "./iosTouchFallback";
import { applyEpubLineHeightScale } from "./lineHeightScale";

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

describe("buildEpubInjectedStyle", () => {
  it("원본 기본 상태에서는 글꼴, 글자 크기, 줄 간격을 EPUB 원본 그대로 둔다", () => {
    const style = buildEpubInjectedStyle(
      {
        fontSize: 100,
        fontFamily: "original",
        lineHeight: 1.6,
        theme: "light",
        renderMode: "auto",
        flow: "paginated",
        spread: "auto",
        wheelDirection: "down",
        keyboardDirection: "right",
        clickDirection: "right",
      },
      "book",
    );

    expect(style).not.toContain("font-family:");
    expect(style).not.toContain("font-size: 100% !important;");
    expect(style).not.toContain("line-height: 1.6 !important;");
  });

  it("다른 글꼴 선택 시 글꼴만 바꾸고 기본 크기와 줄 간격은 EPUB 원본으로 둔다", () => {
    const style = buildEpubInjectedStyle(
      {
        fontSize: 100,
        fontFamily: "serif",
        lineHeight: 1.6,
        theme: "light",
        renderMode: "auto",
        flow: "paginated",
        spread: "auto",
        wheelDirection: "down",
        keyboardDirection: "right",
        clickDirection: "right",
      },
      "book",
    );

    expect(style).toContain("font-family: Georgia, 'Times New Roman', serif !important;");
    expect(style).toContain("body p,");
    expect(style).not.toContain("font-size: 100% !important;");
    expect(style).not.toContain("line-height: 1.6 !important;");
  });

  it("크기와 줄 간격을 조절하면 원본 상태에서만 해당 값들을 override한다", () => {
    const style = buildEpubInjectedStyle(
      {
        fontSize: 112,
        fontFamily: "serif",
        lineHeight: 1.1,
        theme: "light",
        renderMode: "auto",
        flow: "paginated",
        spread: "auto",
        wheelDirection: "down",
        keyboardDirection: "right",
        clickDirection: "right",
      },
      "book",
    );

    expect(style).toContain("font-family: Georgia, 'Times New Roman', serif !important;");
    expect(style).toContain("font-size: 112% !important;");
    expect(style).not.toContain("line-height:");
  });
});

describe("applyEpubLineHeightScale", () => {
  it("원본 배율에서는 줄 간격 inline override를 추가하지 않는다", () => {
    document.body.innerHTML = `<p style="line-height: 20px;">본문</p>`;
    const paragraph = document.querySelector("p") as HTMLParagraphElement;

    applyEpubLineHeightScale(document, 1);

    expect(paragraph.style.getPropertyValue("line-height")).toBe("20px");
  });

  it("배율 조절 시 현재 계산된 줄 간격에 배율을 곱해 적용한다", () => {
    document.body.innerHTML = `<p style="line-height: 20px;">본문</p>`;
    const paragraph = document.querySelector("p") as HTMLParagraphElement;

    applyEpubLineHeightScale(document, 1.1);

    expect(paragraph.style.getPropertyValue("line-height")).toBe("22px");
  });

  it("원본으로 되돌리면 기존 inline 줄 간격을 복원한다", () => {
    document.body.innerHTML = `<p style="line-height: 20px;">본문</p>`;
    const paragraph = document.querySelector("p") as HTMLParagraphElement;

    applyEpubLineHeightScale(document, 1.1);
    applyEpubLineHeightScale(document, 1);

    expect(paragraph.style.getPropertyValue("line-height")).toBe("20px");
  });
});
