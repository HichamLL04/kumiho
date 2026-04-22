import { afterEach, describe, expect, it, vi } from "vitest";
import { getSafeLocationFromCfi, isLikelyEpubCfi } from "./cfiGuards";
import { applyOldIOSSafariPointerEventFallback } from "./iosTouchFallback";
import { applyEpubLineHeightScale } from "./lineHeightScale";
import { buildEpubInjectedStyle } from "./styleBuilder";
import { getWheelNavigationAction } from "./wheelNavigation";
import { getScrolledPullCompletionAction } from "./scrolledPull";
import { EPUB_SCROLLED_PULL_THRESHOLD } from "./constants";

const isOldIOSSafariMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../../../utils/browserDetect", () => ({
  isOldIOSSafari: isOldIOSSafariMock,
}));

const createScrollContainer = ({
  scrollHeight,
  clientHeight,
  scrollTop,
}: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) => {
  const container = document.createElement("div");
  Object.defineProperties(container, {
    scrollHeight: { value: scrollHeight, configurable: true },
    clientHeight: { value: clientHeight, configurable: true },
    scrollTop: { value: scrollTop, configurable: true, writable: true },
  });
  return container;
};

describe("EPUB CFI guards", () => {
  it("rejects href-like values before calling locationFromCfi", () => {
    const locationFromCfi = vi.fn();

    expect(isLikelyEpubCfi("chapter.xhtml#anchor")).toBe(false);
    expect(getSafeLocationFromCfi({ locationFromCfi }, "chapter.xhtml#anchor")).toBeNull();
    expect(locationFromCfi).not.toHaveBeenCalled();
  });

  it("passes trimmed EPUB CFI strings to locationFromCfi", () => {
    const locationFromCfi = vi.fn(() => 3);

    expect(isLikelyEpubCfi(" epubcfi(/6/2!/4/2) ")).toBe(true);
    expect(getSafeLocationFromCfi({ locationFromCfi }, " epubcfi(/6/2!/4/2) ")).toBe(3);
    expect(locationFromCfi).toHaveBeenCalledWith("epubcfi(/6/2!/4/2)");
  });
});

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

  it("모바일 페이지 모드에서는 세로 스크롤 모드와 같은 좌우 여백을 적용한다", () => {
    const style = buildEpubInjectedStyle(
      {
        fontSize: 100,
        fontFamily: "original",
        lineHeight: 1.6,
        theme: "light",
        renderMode: "auto",
        flow: "paginated",
        spread: "none",
        wheelDirection: "down",
        keyboardDirection: "right",
        clickDirection: "right",
      },
      "book",
    );

    expect(style).toContain("@media (max-width: 640px)");
    expect(style).toContain("width: 100%;");
    expect(style).toContain("max-width: 960px;");
    expect(style).toContain("margin-left: auto;");
    expect(style).toContain("margin-right: auto;");
    expect(style).toContain("padding-left: 32px;");
    expect(style).toContain("padding-right: 32px;");
    expect(style).toContain("box-sizing: border-box;");
    expect(style).toContain("overflow-x: hidden;");
  });

  it("세로 스크롤 모드에서는 본문 잘림 방지용 레이아웃 속성을 우선 적용한다", () => {
    const style = buildEpubInjectedStyle(
      {
        fontSize: 100,
        fontFamily: "original",
        lineHeight: 1.6,
        theme: "light",
        renderMode: "auto",
        flow: "scrolled",
        spread: "none",
        wheelDirection: "down",
        keyboardDirection: "right",
        clickDirection: "right",
      },
      "book",
    );

    expect(style).toContain("width: 100% !important;");
    expect(style).toContain("max-width: 960px !important;");
    expect(style).toContain("padding-left: 32px !important;");
    expect(style).toContain("padding-right: 32px !important;");
    expect(style).toContain("overflow-x: hidden !important;");
    expect(style).toContain("max-width: 100% !important;");
  });
});

describe("getWheelNavigationAction", () => {
  it("작은 wheel delta는 트랙패드 미세 입력으로 보고 무시한다", () => {
    const action = getWheelNavigationAction({
      deltaY: 4,
      flow: "paginated",
      wheelDirection: "down",
    });

    expect(action).toBeNull();
  });

  it("세로 스크롤 모드에서 내부 스크롤이 없는 작은 페이지는 다음 페이지 이동을 허용한다", () => {
    const action = getWheelNavigationAction({
      deltaY: 32,
      flow: "scrolled",
      wheelDirection: "down",
      manager: {
        isPaginated: false,
        container: createScrollContainer({
          scrollHeight: 600,
          clientHeight: 600,
          scrollTop: 0,
        }),
      },
    });

    expect(action).toBe("next");
  });

  it("세로 스크롤 모드에서 내부 스크롤 중이면 페이지 이동을 막는다", () => {
    const action = getWheelNavigationAction({
      deltaY: 32,
      flow: "scrolled",
      wheelDirection: "down",
      manager: {
        isPaginated: false,
        container: createScrollContainer({
          scrollHeight: 1200,
          clientHeight: 600,
          scrollTop: 200,
        }),
      },
    });

    expect(action).toBeNull();
  });

  it("세로 스크롤 모드에서 isPaginated가 undefined이면 초기화 중으로 보고 이동을 막는다", () => {
    const action = getWheelNavigationAction({
      deltaY: 32,
      flow: "scrolled",
      wheelDirection: "down",
      manager: {
        isPaginated: undefined,
        container: createScrollContainer({
          scrollHeight: 600,
          clientHeight: 600,
          scrollTop: 0,
        }),
      },
    });

    expect(action).toBeNull();
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

describe("getScrolledPullCompletionAction (스크롤 당김 완료 액션)", () => {
  const T = EPUB_SCROLLED_PULL_THRESHOLD;

  it("임계값 초과 + canPrev=true → nav-prev 반환", () => {
    expect(getScrolledPullCompletionAction(T, true, false)).toBe("nav-prev");
    expect(getScrolledPullCompletionAction(T + 10, true, true)).toBe("nav-prev");
  });

  it("임계값 초과 + canNext=true → nav-next 반환", () => {
    expect(getScrolledPullCompletionAction(-T, false, true)).toBe("nav-next");
    expect(getScrolledPullCompletionAction(-T - 10, false, true)).toBe("nav-next");
  });

  it("임계값 초과해도 canPrev/canNext=false 면 none 반환 (네비게이션 미발생)", () => {
    expect(getScrolledPullCompletionAction(T, false, false)).toBe("none");
    expect(getScrolledPullCompletionAction(-T, false, false)).toBe("none");
    expect(getScrolledPullCompletionAction(T + 20, false, true)).toBe("none");
    expect(getScrolledPullCompletionAction(-T - 20, true, false)).toBe("none");
  });

  it("임계값 미만 + offset != 0 → decay 반환", () => {
    expect(getScrolledPullCompletionAction(T - 1, true, true)).toBe("decay");
    expect(getScrolledPullCompletionAction(-(T - 1), true, true)).toBe("decay");
    expect(getScrolledPullCompletionAction(1, false, false)).toBe("decay");
  });

  it("offset = 0 → none 반환", () => {
    expect(getScrolledPullCompletionAction(0, true, true)).toBe("none");
    expect(getScrolledPullCompletionAction(0, false, false)).toBe("none");
  });

  it("커스텀 임계값으로 동작한다", () => {
    expect(getScrolledPullCompletionAction(50, true, false, 50)).toBe("nav-prev");
    expect(getScrolledPullCompletionAction(49, true, false, 50)).toBe("decay");
  });
});
