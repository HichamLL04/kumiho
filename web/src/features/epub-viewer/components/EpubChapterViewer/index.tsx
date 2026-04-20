import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import Epub from "epubjs";
import type { Book, Contents, Rendition } from "epubjs";
import type { EpubViewerSettings } from "../../../../stores/epubViewerStore";
import { calculateGlobalProgress } from "../../utils/epubUtils";
import {
  detectLayoutFromDocument,
  detectLayoutFromPackageMetadata,
  detectLayoutFromSpine,
  resolveEffectiveLayout,
  type EpubRenderLayout,
} from "../../utils/layoutMode";
import { buildEpubInjectedStyle, getEpubThemeStyle } from "./styleBuilder";
import styles from "./EpubChapterViewer.module.css";
import { applyOldIOSSafariPointerEventFallback } from "./iosTouchFallback";
import { applyEpubLineHeightScale } from "./lineHeightScale";

export type { EpubRenderLayout } from "../../utils/layoutMode";

export interface EpubChapterViewerHandles {
  next: () => Promise<boolean>;
  prev: () => Promise<boolean>;
  goToCFI: (cfi: string) => void;
  goToProgress: (ratio: number) => void;
  goToPage: (page: number) => void;
}

export type EpubInitialOpenMode = "default" | "last";

export interface EpubTOCItem {
  id: string;
  label: string;
  href: string;
  navigationCfi?: string;
  progressRatio?: number;
  progressPrecision?: "estimated" | "precise";
  subitems?: EpubTOCItem[];
}

interface EpubChapterViewerProps {
  epubUrl: string;
  chapterId: string;
  chapterTitle: string;
  chapterPage: number;
  chapterTotal: number;
  globalProgressPercent?: number;
  isUIVisible: boolean;
  initialCFI?: string | null;
  initialProgressRatio?: number | null;
  initialOpenMode?: EpubInitialOpenMode;
  settings: EpubViewerSettings;
  onReady?: (totalLocations: number) => void;
  onTOCLoad?: (toc: EpubTOCItem[]) => void;
  onLocationChange?: (location: {
    cfi: string;
    chapterPage: number;
    chapterTotal: number;
    globalRatio: number;
    currentPosition: number;
    totalPositions: number;
    chapterHref: string;
    spineIndex: number;
    spineLength: number;
    atStart?: boolean;
    atEnd?: boolean;
  }) => void;
  onViewerClick?: () => void;
  onInitializationComplete?: () => void;
  onPageNext?: () => void;
  onPagePrev?: () => void;
  onRenderLayoutChange?: (layout: EpubRenderLayout) => void;
  hideChapterPageInfo?: boolean;
}

const EPUB_VIEWER_STYLE_ID = "kumiho-epub-viewer-settings";

// epub.js 관련 내부 타입 정의
interface EpubjsLocation {
  start: {
    cfi: string;
    displayed: {
      page: number;
      total: number;
    };
    percentage: number;
    index: number;
  };
  end: {
    cfi: string;
  };
  atStart?: boolean;
  atEnd?: boolean;
}

interface EpubjsNavigationItem {
  id: string;
  label: string;
  href: string;
  subitems?: EpubjsNavigationItem[];
}

interface EpubjsLocationsExtended {
  length: () => number;
  locationFromCfi?: (cfi: string) => number;
  cfiFromPercentage?: (percentage: number) => string;
  cfiFromLocation?: (location: number) => string;
  save: () => string;
}

interface EpubjsSpine {
  spineItems: Array<{ index: number; href: string }>;
}

interface EpubjsSection {
  cfiBase?: string;
  document?: Document;
  load?: () => Promise<unknown>;
  unload?: () => void;
  cfiFromElement?: (el: Element) => string;
}

interface NavigationSnapshot {
  cfi: string | null;
  page: number;
  index: number;
  scrollLeft: number;
  scrollTop: number;
}

interface EpubManagerSnapshot {
  container?: {
    scrollLeft?: number;
    scrollTop?: number;
    scrollWidth?: number;
    scrollHeight?: number;
    clientWidth?: number;
    clientHeight?: number;
  };
  isPaginated?: boolean;
  settings?: {
    direction?: "ltr" | "rtl";
  };
  layout?: {
    delta?: number;
  };
  updateOffset?: () => void;
}

const EPUB_LOCATION_STRIDE = 6144; // 6KB 단위로 가상 페이지(위치) 정의. backend/internal/util/epub.go의 EpubPositionStride와 일치해야 함.
const toLocationRatio = (position: number, total: number): number => {
  if (!Number.isFinite(position) || !Number.isFinite(total) || total <= 1) return 0;
  return Math.max(0, Math.min(1, position / (total - 1)));
};
const getSafeLocationLength = (locations: unknown): number => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.length !== "function") return 0;

  try {
    const total = locationSet.length();
    return Number.isFinite(total) && total > 0 ? total : 0;
  } catch (err) {
    console.warn("[EpubChapterViewer] location length unavailable:", err);
    return 0;
  }
};
const getSafeLocationFromCfi = (locations: unknown, cfi: string): number | null => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.locationFromCfi !== "function") return null;

  try {
    const position = locationSet.locationFromCfi(cfi);
    return typeof position === "number" && Number.isFinite(position) && position >= 0 ? position : null;
  } catch (err) {
    console.warn("[EpubChapterViewer] locationFromCfi failed:", err);
    return null;
  }
};
const getSafeCfiFromPercentage = (locations: unknown, ratio: number): string | undefined => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.cfiFromPercentage !== "function") return undefined;

  try {
    const cfi = locationSet.cfiFromPercentage(Math.max(0, Math.min(1, ratio)));
    return typeof cfi === "string" && cfi.trim().length > 0 ? cfi : undefined;
  } catch (err) {
    console.warn("[EpubChapterViewer] cfiFromPercentage failed:", err);
    return undefined;
  }
};
const getSafeCfiFromLocation = (locations: unknown, location: number): string | undefined => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.cfiFromLocation !== "function") return undefined;

  try {
    const cfi = locationSet.cfiFromLocation(location);
    return typeof cfi === "string" && cfi.trim().length > 0 ? cfi : undefined;
  } catch (err) {
    console.warn("[EpubChapterViewer] cfiFromLocation failed:", err);
    return undefined;
  }
};
const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const safeDecodeFragment = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const EpubChapterViewer = forwardRef<EpubChapterViewerHandles, EpubChapterViewerProps>(
  (
    {
      epubUrl,
      chapterId,
      chapterTitle,
      chapterPage,
      chapterTotal,
      globalProgressPercent,
      isUIVisible,
      initialCFI,
      initialProgressRatio,
      initialOpenMode = "default",
      settings,
      onReady,
      onTOCLoad,
      onLocationChange,
      onViewerClick,
      onInitializationComplete,
      onPageNext,
      onPagePrev,
      onRenderLayoutChange,
      hideChapterPageInfo = false,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const locationsReadyRef = useRef(false);
    const generatedTotalRef = useRef(0);

    // 최신 콜백을 ref로 유지 (stale closure 방지)
    const onViewerClickRef = useRef(onViewerClick);
    const onLocationChangeRef = useRef(onLocationChange);
    const onReadyRef = useRef(onReady);
    const onTOCLoadRef = useRef(onTOCLoad);
    const onInitializationCompleteRef = useRef(onInitializationComplete);
    const onPageNextRef = useRef(onPageNext);
    const onPagePrevRef = useRef(onPagePrev);
    const onRenderLayoutChangeRef = useRef(onRenderLayoutChange);
    const settingsRef = useRef(settings);
    const lastWheelNavigationAtRef = useRef(0);
    const detectedLayoutRef = useRef<EpubRenderLayout>("book");
    const effectiveLayoutRef = useRef<EpubRenderLayout>("book");
    const allowContentHeuristicRef = useRef(true);
    const autoLayoutLockedRef = useRef(false);
    const isNavigatingRef = useRef(false);
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const isDraggingRef = useRef(false);
    const touchHandledRef = useRef(false);
    const lastAppliedSpreadRef = useRef<"auto" | "none" | null>(null);
    const contentDisposersRef = useRef<Map<Document, () => void>>(new Map());
    const tocRefreshSeqRef = useRef(0);
    const resizeFrameRef = useRef<number | null>(null);
    const lastContainerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
    const hasStableLocationRef = useRef(false);

    useEffect(() => {
      onViewerClickRef.current = onViewerClick;
    }, [onViewerClick]);
    useEffect(() => {
      onLocationChangeRef.current = onLocationChange;
    }, [onLocationChange]);
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);
    useEffect(() => {
      onTOCLoadRef.current = onTOCLoad;
    }, [onTOCLoad]);
    useEffect(() => {
      onInitializationCompleteRef.current = onInitializationComplete;
    }, [onInitializationComplete]);
    useEffect(() => {
      onPageNextRef.current = onPageNext;
    }, [onPageNext]);
    useEffect(() => {
      onPagePrevRef.current = onPagePrev;
    }, [onPagePrev]);
    useEffect(() => {
      onRenderLayoutChangeRef.current = onRenderLayoutChange;
    }, [onRenderLayoutChange]);
    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

    const reflowRendition = useCallback((forceRedisplay = false) => {
      const container = containerRef.current;
      const rendition = renditionRef.current;
      if (!container || !rendition) return;
      if (!hasStableLocationRef.current) return;

      const width = Math.round(container.clientWidth);
      const height = Math.round(container.clientHeight);
      if (width <= 0 || height <= 0) return;

      const previous = lastContainerSizeRef.current;
      if (!forceRedisplay && previous.width === width && previous.height === height) return;
      lastContainerSizeRef.current = { width, height };

      const anyRendition = rendition as unknown as {
        currentLocation?: () => EpubjsLocation | undefined;
        resize?: (width: number, height: number) => void;
        display: (target?: string) => Promise<unknown>;
      };

      let currentCfi: string | undefined;
      try {
        currentCfi = anyRendition.currentLocation?.()?.start?.cfi;
      } catch {
        return;
      }

      try {
        anyRendition.resize?.(width, height);
      } catch {
        return;
      }

      if (!currentCfi || isNavigatingRef.current) return;

      void anyRendition.display(currentCfi).catch(() => {});
    }, []);

    const snapRenditionToVisualEnd = useCallback((rendition: Rendition): boolean => {
      try {
        const manager = (rendition as unknown as { manager?: EpubManagerSnapshot })?.manager;
        const container = manager?.container;
        if (!manager || !container) return false;

        if (manager.isPaginated === false) {
          container.scrollTop = Math.max(0, (container.scrollHeight ?? 0) - (container.clientHeight ?? 0));
          return true;
        }

        if (manager.isPaginated) {
          const direction = manager.settings?.direction;
          const scrollWidth = container.scrollWidth ?? 0;
          const clientWidth = container.clientWidth ?? 0;
          const delta = manager.layout?.delta || clientWidth;
          if (direction === "rtl") {
            container.scrollLeft = 0;
          } else {
            const maxScroll = Math.max(0, scrollWidth - clientWidth);
            container.scrollLeft = delta > 0 ? Math.floor(maxScroll / delta) * delta : maxScroll;
          }
          manager.updateOffset?.();
          return true;
        }
      } catch (err) {
        console.warn("[EpubChapterViewer] visual end snap failed:", err);
      }

      return false;
    }, []);

    const applyDocumentSettings = useCallback((doc: Document, s: EpubViewerSettings, layout: EpubRenderLayout) => {
      let styleEl = doc.getElementById(EPUB_VIEWER_STYLE_ID) as HTMLStyleElement | null;

      if (!styleEl) {
        const headFromTag = doc.getElementsByTagName("head")[0] as HTMLElement | undefined;
        const containerForStyle =
          (doc.head as HTMLElement | null) || headFromTag || (doc.documentElement as HTMLElement | null);

        if (!containerForStyle) {
          return;
        }

        styleEl = doc.createElement("style");
        styleEl.id = EPUB_VIEWER_STYLE_ID;
        containerForStyle.appendChild(styleEl);
      }

      styleEl.textContent = buildEpubInjectedStyle(s, layout);
      applyEpubLineHeightScale(doc, s.lineHeight);
    }, []);
    // epub.js themes API는 소형 뷰포트·리사이즈 시 스타일이 유실될 수 있으므로
    // CSS 스타일링은 applyDocumentSettings(<style> 직접 주입)에서 일원화한다.
    // 이 함수는 rendition 레벨 설정(spread)과 기존 themes 스타일 정리만 담당한다.
    const applySettings = useCallback(
      (rendition: Rendition, s: EpubViewerSettings, layout: EpubRenderLayout) => {
        const isComic = layout === "comic";

        // 기존 epub.js가 삽입한 기본 테마 스타일시트 제거
        const anyRendition = rendition as unknown as {
          spread?: (value: "auto" | "none") => void;
          getContents?: () => Array<{ document?: Document }>;
        };
        const contents = anyRendition.getContents?.() || [];
        contents.forEach((content) => {
          const doc = content.document;
          if (!doc) return;
          doc.getElementById("epubjs-inserted-css-default")?.remove();
        });

        // spread()는 내부적으로 updateLayout() → contents.columns()를 트리거하여 iframe을 재레이아웃함.
        // 값이 실제로 바뀔 때만 호출해야 blank screen 버그를 방지할 수 있음.
        const desiredSpread: "auto" | "none" = s.flow === "scrolled" || isComic ? "none" : s.spread;
        if (desiredSpread !== lastAppliedSpreadRef.current) {
          anyRendition.spread?.(desiredSpread);
          lastAppliedSpreadRef.current = desiredSpread;
        }

        // 모든 iframe에 직접 <style> 주입
        contents.forEach((content) => {
          if (content.document) {
            applyDocumentSettings(content.document, s, layout);
          }
        });
      },
      [applyDocumentSettings],
    );

    const handleRelocated = useCallback(
      (location: EpubjsLocation) => {
        if (isNavigatingRef.current) return;
        const rendition = renditionRef.current;
        const book = bookRef.current;
        if (!rendition || !book || !location?.start?.cfi) return;

        const cfi = location.start.cfi;
        const wasStable = hasStableLocationRef.current;
        hasStableLocationRef.current = true;
        if (!wasStable) {
          if (resizeFrameRef.current !== null) {
            cancelAnimationFrame(resizeFrameRef.current);
          }
          resizeFrameRef.current = requestAnimationFrame(() => {
            resizeFrameRef.current = null;
            reflowRendition(true);
          });
        }
        console.log("[EpubChapterViewer] relocated:", cfi);

        const currentLocation = rendition.currentLocation() as unknown as EpubjsLocation;
        const start = currentLocation?.start || location.start;
        const displayed = start?.displayed;

        let chapterPage = displayed?.page || 0;
        let chapterTotal = displayed?.total || 0;

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const manager = (rendition as any).manager;
          if (manager && manager.isPaginated && manager.container) {
            const scrollWidth = manager.container.scrollWidth;
            const delta = manager.layout?.delta;
            if (delta > 0 && scrollWidth > 0) {
              const adjustedTotal = Math.ceil((scrollWidth - 3) / delta);
              const newTotal = adjustedTotal > 0 ? adjustedTotal : 1;
              if (newTotal < chapterTotal) {
                // 스프레드 모드에서 epub.js가 총 페이지를 과대계산할 경우 비례 축소한다
                // (단순 clamp 시 여러 스프레드가 같은 페이지 번호를 표시하는 버그 방지)
                const originalTotal = chapterTotal;
                chapterTotal = newTotal;
                chapterPage = Math.max(1, Math.min(Math.ceil((chapterPage * newTotal) / originalTotal), newTotal));
              } else {
                chapterPage = Math.max(1, Math.min(chapterPage, chapterTotal));
              }
            }
          }
        } catch (err) {
          console.warn("[EpubChapterViewer] manager spread correction failed:", err);
        }

        const spine = book.spine as unknown as EpubjsSpine;
        const spineItems = spine.spineItems || [];
        let globalRatio = calculateGlobalProgress({
          percentage: start?.percentage,
          index: start?.index,
          spineLength: spineItems.length,
        });

        let currentPosition = 0;
        const locations = book.locations as unknown as EpubjsLocationsExtended;
        const totalPositions =
          generatedTotalRef.current > 0 ? generatedTotalRef.current : getSafeLocationLength(locations);
        if (locationsReadyRef.current && typeof locations?.locationFromCfi === "function") {
          const pos = getSafeLocationFromCfi(locations, cfi);
          if (pos !== null) {
            currentPosition = pos;
            if (totalPositions > 0) {
              // 진행바 클릭(goToProgress: cfiFromPercentage)과 동일한 축으로 정규화해 시각 위치와 실제 이동을 일치시킴
              globalRatio = toLocationRatio(pos, totalPositions);
            }
          } else if (totalPositions > 0) {
            // 일부 TOC href 점프는 cfi->location 매핑이 실패할 수 있어 globalRatio로 보정한다.
            currentPosition = Math.max(0, Math.min(totalPositions - 1, Math.round(globalRatio * (totalPositions - 1))));
          }
        }

        const spineIndex = start?.index ?? -1;
        const currentSpineItem = spineItems[spineIndex];
        const chapterHref = currentSpineItem?.href || "";

        onLocationChangeRef.current?.({
          cfi,
          chapterPage,
          chapterTotal,
          globalRatio,
          currentPosition,
          totalPositions,
          chapterHref,
          spineIndex,
          spineLength: spineItems.length,
          atStart: location.atStart,
          atEnd: location.atEnd,
        });
      },
      [reflowRendition],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      lastAppliedSpreadRef.current = null; // 새 rendition 생성 시 초기화
      const contentDisposers = contentDisposersRef.current;

      let isDisposed = false;
      const book = Epub(epubUrl, { openAs: "epub" });

      bookRef.current = book;
      locationsReadyRef.current = false;
      allowContentHeuristicRef.current = true;
      autoLayoutLockedRef.current = false;
      hasStableLocationRef.current = false;

      const rendition = book.renderTo(containerRef.current, {
        flow: settings.flow === "scrolled" ? "scrolled-doc" : "paginated",
        spread: settings.renderMode === "comic" ? "none" : settings.spread,
        width: "100%",
        height: "100%",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      lastContainerSizeRef.current = { width: 0, height: 0 };

      applySettings(rendition, settings, effectiveLayoutRef.current);

      const handleContentInput = (content: Contents) => {
        const contentWithDocument = content as unknown as { document?: Document };
        const doc = contentWithDocument.document;
        if (!doc) return;
        if (contentDisposers.has(doc)) return;

        // 구형 iOS Safari: iframe pointer-events를 none으로 설정하여
        // 터치 이벤트가 부모 <main>으로 관통하도록 한다.
        applyOldIOSSafariPointerEventFallback(doc);
        applyDocumentSettings(doc, settingsRef.current, effectiveLayoutRef.current);

        const currentSettings = settingsRef.current;
        if (currentSettings.renderMode === "auto") {
          if (!autoLayoutLockedRef.current && allowContentHeuristicRef.current) {
            const docLayout = detectLayoutFromDocument(doc) || "book";
            if (docLayout !== effectiveLayoutRef.current) {
              console.log(
                `[EpubChapterViewer] auto layout switched by content heuristic: ${effectiveLayoutRef.current} -> ${docLayout}`,
              );
              detectedLayoutRef.current = docLayout;
              effectiveLayoutRef.current = docLayout;
              onRenderLayoutChangeRef.current?.(docLayout);
              applySettings(rendition, currentSettings, docLayout);
            }
            autoLayoutLockedRef.current = true;
          } else if (!allowContentHeuristicRef.current) {
            autoLayoutLockedRef.current = true;
          }
        } else {
          autoLayoutLockedRef.current = true;
        }

        const wheelHandler = (event: WheelEvent) => {
          const currentSettings = settingsRef.current;
          if (Math.abs(event.deltaY) < 12) return;

          const isNextDirection = currentSettings.wheelDirection === "down" ? event.deltaY > 0 : event.deltaY < 0;
          if (currentSettings.flow !== "paginated") {
            const manager = (renditionRef.current as unknown as { manager?: EpubManagerSnapshot })?.manager;
            if (!manager || manager.isPaginated !== false || !manager.container) return;
            const scrollTop = manager.container.scrollTop ?? 0;
            const scrollHeight = manager.container.scrollHeight ?? 0;
            const clientHeight = manager.container.clientHeight ?? 0;
            const atStart = scrollTop <= 2;
            const atEnd = scrollHeight <= clientHeight || scrollTop + clientHeight >= scrollHeight - 2;
            if ((isNextDirection && !atEnd) || (!isNextDirection && !atStart)) return;
          }

          const now = Date.now();
          if (now - lastWheelNavigationAtRef.current < 300) return;
          lastWheelNavigationAtRef.current = now;

          event.preventDefault();
          if (isNextDirection) {
            onPageNextRef.current?.();
          } else {
            onPagePrevRef.current?.();
          }
        };

        const keydownHandler = (event: KeyboardEvent) => {
          const currentSettings = settingsRef.current;
          const target = event.target as HTMLElement | null;
          const tagName = target?.tagName?.toLowerCase();
          const isEditable =
            tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
          if (isEditable) return;

          const nextArrowKey = currentSettings.keyboardDirection === "right" ? "ArrowRight" : "ArrowLeft";
          const prevArrowKey = currentSettings.keyboardDirection === "right" ? "ArrowLeft" : "ArrowRight";

          if (event.key === nextArrowKey || event.key === "PageDown") {
            event.preventDefault();
            onPageNextRef.current?.();
          } else if (event.key === prevArrowKey || event.key === "PageUp") {
            event.preventDefault();
            onPagePrevRef.current?.();
          }
        };

        // zone 판별 헬퍼: 뷰어 컨테이너 기준 좌(0~30%) / 중앙(30~70%) / 우(70~100%)
        const resolveZone = (clientX: number): "left" | "center" | "right" => {
          const containerRect = containerRef.current?.getBoundingClientRect();
          const ratio =
            containerRect && containerRect.width > 0
              ? (clientX - containerRect.left) / containerRect.width
              : clientX / Math.max(window.innerWidth, 1);
          const clampedRatio = Math.max(0, Math.min(1, ratio));
          if (clampedRatio < 0.3) return "left";
          if (clampedRatio > 0.7) return "right";
          return "center";
        };

        // zone에 따라 UI 토글 또는 페이지 이동 실행
        const executeZoneAction = (zone: "left" | "center" | "right") => {
          const currentSettings = settingsRef.current;
          if (zone === "center") {
            onViewerClickRef.current?.();
            return;
          }
          const isRTL = currentSettings.clickDirection === "left";
          if (zone === "left") {
            if (isRTL) onPageNextRef.current?.();
            else onPagePrevRef.current?.();
          } else {
            if (isRTL) onPagePrevRef.current?.();
            else onPageNextRef.current?.();
          }
        };

        // 마우스 드래그 감지용 (텍스트 선택과 클릭 구분)
        const mouseDownHandler = (event: MouseEvent) => {
          pointerDownPosRef.current = { x: event.clientX, y: event.clientY };
          isDraggingRef.current = false;
        };

        const mouseMoveHandler = (event: MouseEvent) => {
          if (!pointerDownPosRef.current) return;
          const dx = event.clientX - pointerDownPosRef.current.x;
          const dy = event.clientY - pointerDownPosRef.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > 5) {
            isDraggingRef.current = true;
          }
        };

        // iframe 내부 클릭 → zone 기반 UI 토글 / 페이지 이동
        const clickHandler = (event: MouseEvent) => {
          if (touchHandledRef.current) {
            touchHandledRef.current = false;
            return;
          }

          // 드래그(텍스트 선택) 후 클릭은 무시
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            pointerDownPosRef.current = null;
            return;
          }
          pointerDownPosRef.current = null;

          // 텍스트가 선택된 상태면 클릭 무시 (선택 유지)
          const iframeWindow = doc.defaultView;
          const selection = iframeWindow?.getSelection();
          if (selection && !selection.isCollapsed) return;

          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
          if (anchor) {
            const href = anchor.getAttribute("href") || "";
            if (!href) return;
            const isExternal = /^https?:\/\//i.test(href);
            if (isExternal) {
              event.preventDefault();
              event.stopPropagation();
              window.open(href, "_blank", "noopener,noreferrer");
            }
            return;
          }

          const interactiveTarget = target?.closest("button, input, select, textarea, [contenteditable='true']");
          if (interactiveTarget) return;

          // iframe 내부 클릭 좌표를 최상위 window 기준으로 변환
          const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
          const iframeRect = iframe?.getBoundingClientRect();
          const absoluteX = (iframeRect?.left ?? 0) + event.clientX;

          executeZoneAction(resolveZone(absoluteX));
        };

        // iframe 내부 터치 → zone 기반 UI 토글 / 페이지 이동
        const touchStartHandler = (event: TouchEvent) => {
          const touch = event.touches[0];
          if (!touch) return;
          pointerDownPosRef.current = { x: touch.clientX, y: touch.clientY };
          isDraggingRef.current = false;
          touchHandledRef.current = false;
        };

        const touchMoveHandler = (event: TouchEvent) => {
          if (!pointerDownPosRef.current) return;
          const touch = event.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - pointerDownPosRef.current.x;
          const dy = touch.clientY - pointerDownPosRef.current.y;
          if (Math.sqrt(dx * dx + dy * dy) > 8) {
            isDraggingRef.current = true;
          }
        };

        const touchEndHandler = (event: TouchEvent) => {
          touchHandledRef.current = true;
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            const startPos = pointerDownPosRef.current;
            pointerDownPosRef.current = null;

            // 스와이프 감지: 수평 이동이 임계값(50px) 이상이고 수직보다 클 때
            if (startPos) {
              const touch = event.changedTouches[0];
              if (touch) {
                const dx = touch.clientX - startPos.x;
                const dy = touch.clientY - startPos.y;
                const SWIPE_THRESHOLD = 50;
                if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
                  const currentSettings = settingsRef.current;
                  const isRTL = currentSettings.clickDirection === "left";
                  // 왼쪽으로 스와이프(dx < 0) = LTR에서 다음 페이지
                  const isSwipeLeft = dx < 0;
                  if (isSwipeLeft) {
                    if (isRTL) onPagePrevRef.current?.();
                    else onPageNextRef.current?.();
                  } else {
                    if (isRTL) onPageNextRef.current?.();
                    else onPagePrevRef.current?.();
                  }
                }
              }
            }
            return;
          }

          // 터치 좌표를 최상위 window 기준으로 변환
          const touch = event.changedTouches[0];
          const clientX = touch?.clientX ?? pointerDownPosRef.current?.x ?? 0;
          const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
          const iframeRect = iframe?.getBoundingClientRect();
          const absoluteX = (iframeRect?.left ?? 0) + clientX;

          pointerDownPosRef.current = null;
          executeZoneAction(resolveZone(absoluteX));
        };

        doc.addEventListener("wheel", wheelHandler, { passive: false });
        doc.addEventListener("keydown", keydownHandler);
        doc.addEventListener("mousedown", mouseDownHandler);
        doc.addEventListener("mousemove", mouseMoveHandler);
        doc.addEventListener("click", clickHandler);
        doc.addEventListener("touchstart", touchStartHandler, { passive: true });
        doc.addEventListener("touchmove", touchMoveHandler, { passive: true });
        doc.addEventListener("touchend", touchEndHandler);

        contentDisposers.set(doc, () => {
          const eventTarget = doc as Document | undefined;
          if (typeof eventTarget?.removeEventListener !== "function") return;

          eventTarget.removeEventListener("wheel", wheelHandler);
          eventTarget.removeEventListener("keydown", keydownHandler);
          eventTarget.removeEventListener("mousedown", mouseDownHandler);
          eventTarget.removeEventListener("mousemove", mouseMoveHandler);
          eventTarget.removeEventListener("click", clickHandler);
          eventTarget.removeEventListener("touchstart", touchStartHandler);
          eventTarget.removeEventListener("touchmove", touchMoveHandler);
          eventTarget.removeEventListener("touchend", touchEndHandler);
        });
      };

      rendition.on("relocated", handleRelocated as unknown as (...args: unknown[]) => void);
      rendition.hooks.content.register(handleContentInput as unknown as (...args: unknown[]) => void);

      // === 초기화 헬퍼: 위치 복원 후 초기화 완료 처리 ===
      const waitForLayoutFrame = () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });

      const finalizeInit = async (snapToEnd = initialOpenMode === "last") => {
        if (isDisposed) return;
        if (snapToEnd) {
          await waitForLayoutFrame();
          if (isDisposed) return;
          snapRenditionToVisualEnd(rendition);
          await waitForLayoutFrame();
          if (isDisposed) return;
          snapRenditionToVisualEnd(rendition);
        }
        onReadyRef.current?.(generatedTotalRef.current);
        onInitializationCompleteRef.current?.();
        const loc = rendition.currentLocation() as unknown as EpubjsLocation;
        if (loc) handleRelocated(loc);
      };
      const displayWithFallback = (targetCFI?: string, ratioFallback?: number) => {
        const fallbackCFI =
          typeof ratioFallback === "number" && ratioFallback > 0.01
            ? getSafeCfiFromPercentage(book.locations, ratioFallback)
            : undefined;

        const displayBeginning = () =>
          rendition
            .display(undefined)
            .then(() => finalizeInit())
            .catch((fallbackErr: unknown) => {
              console.error("[EpubChapterViewer] Initial display fallback failed:", fallbackErr);
              return finalizeInit();
            });

        const displayRatioFallback = () => {
          if (!fallbackCFI || fallbackCFI === targetCFI) return displayBeginning();
          return rendition.display(fallbackCFI).then(() => finalizeInit()).catch(displayBeginning);
        };

        return rendition
          .display(targetCFI)
          .then(() => finalizeInit())
          .catch((err: unknown) => {
            console.warn("[EpubChapterViewer] Initial display failed, falling back:", err);
            return displayRatioFallback();
          });
      };

      book.ready
        .then(() => {
          const detectedFromMetadata = detectLayoutFromPackageMetadata(book);
          const detectedFromSpine = detectLayoutFromSpine(book);
          allowContentHeuristicRef.current = !(detectedFromMetadata || detectedFromSpine);
          detectedLayoutRef.current = detectedFromMetadata || detectedFromSpine || "book";
          effectiveLayoutRef.current = resolveEffectiveLayout(settings.renderMode, detectedLayoutRef.current);
          console.log(
            `[EpubChapterViewer] layout resolved: metadata=${detectedFromMetadata ?? "none"}, spine=${detectedFromSpine ?? "none"}, mode=${settings.renderMode}, effective=${effectiveLayoutRef.current}`,
          );
          onRenderLayoutChangeRef.current?.(effectiveLayoutRef.current);

          applySettings(rendition, settings, effectiveLayoutRef.current);

          // TOC 로드 헬퍼 함수들 (book.ready 스코프 내에서 한 번만 정의)
          const normalizeHref = (href: string) => {
            const base = href.split("#")[0] || "";
            const decoded = safeDecodeURIComponent(base).replace(/^\.\//, "");
            return decoded;
          };

          const spine = book.spine as unknown as EpubjsSpine;
          const spineItems = spine.spineItems || [];
          const lastSpineHref = spineItems[spineItems.length - 1]?.href;
          const spineHrefMap = new Map<string, number>();
          spineItems.forEach((item, idx) => {
            spineHrefMap.set(normalizeHref(item.href), idx);
          });

          const resolveSpineIndex = (href: string): number | null => {
            const normalized = normalizeHref(href);
            if (spineHrefMap.has(normalized)) {
              return spineHrefMap.get(normalized) ?? null;
            }
            const found = spineItems.findIndex((item) => {
              const itemHref = normalizeHref(item.href);
              return itemHref.endsWith(normalized) || normalized.endsWith(itemHref);
            });
            return found >= 0 ? found : null;
          };

          const ratioFromSpineIndex = (spineIndex: number | null): number | undefined => {
            if (spineIndex === null) return undefined;
            if (spineItems.length <= 0) return 0;
            // calculateGlobalProgress와 일관성을 위해 spineItems.length로 나눔 (N-1 아님)
            return Math.max(0, Math.min(1, spineIndex / spineItems.length));
          };

          const mapTOCItem = (item: EpubjsNavigationItem): EpubTOCItem => {
            const spineIndex = resolveSpineIndex(item.href);
            return {
              id: item.id,
              label: item.label ? item.label.trim() : "",
              href: item.href,
              progressRatio: ratioFromSpineIndex(spineIndex),
              progressPrecision: "estimated",
              subitems: item.subitems?.map(mapTOCItem),
            };
          };

          const assignEstimatedRatios = (items: EpubTOCItem[]): EpubTOCItem[] => {
            const flatIds: string[] = [];
            const collect = (nodes: EpubTOCItem[]) => {
              nodes.forEach((node) => {
                flatIds.push(node.id);
                if (node.subitems?.length) collect(node.subitems);
              });
            };
            collect(items);

            const total = flatIds.length;
            if (total === 0) return items;
            const ratioMap = new Map<string, number>();
            flatIds.forEach((id, index) => {
              ratioMap.set(id, (index + 1) / (total + 1));
            });

            const update = (nodes: EpubTOCItem[]): EpubTOCItem[] =>
              nodes.map((node) => ({
                ...node,
                progressRatio: ratioMap.get(node.id) ?? node.progressRatio,
                progressPrecision: "estimated",
                subitems: node.subitems ? update(node.subitems) : undefined,
              }));

            return update(items);
          };

          // === 정밀 위치 정보 업데이트 헬퍼 ===
          // locations가 준비된 후 TOC 항목들을 다시 훑어 CFI 기반 정밀 위치를 계산함
          const resolveAnchorElement = (doc: Document, fragment: string): Element | null => {
            const decoded = safeDecodeFragment(fragment);
            const candidates = Array.from(
              new Set(
                [
                  fragment,
                  fragment.replace(/^#/, ""),
                  decoded ?? undefined,
                  decoded ? decoded.replace(/^#/, "") : undefined,
                ]
                  .map((value) => (value ?? "").trim())
                  .filter((value) => Boolean(value)),
              ),
            );

            for (const key of candidates) {
              const byId = doc.getElementById(key);
              if (byId) return byId;
            }

            for (const key of candidates) {
              const byName = doc.getElementsByName(key)[0];
              if (byName) return byName;
            }

            return null;
          };

          const resolveCfiFromHref = async (href: string): Promise<string | null> => {
            const hashIndex = href.indexOf("#");
            const baseHref = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).trim();
            const section = book.spine.get(baseHref) as unknown as EpubjsSection;
            if (!section?.cfiBase) return null;

            const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1).trim() : "";
            if (!fragment) {
              return section.cfiBase;
            }

            try {
              await section.load?.();
              const doc = section.document;
              if (!doc) return section.cfiBase;

              const anchorElement = resolveAnchorElement(doc, fragment);
              if (!anchorElement) return section.cfiBase;

              return section.cfiFromElement?.(anchorElement) || section.cfiBase;
            } catch {
              return section.cfiBase;
            } finally {
              section.unload?.();
            }
          };

          const refreshTOCWithPreciseRatios = () => {
            if (!locationsReadyRef.current || !book.locations || !book.navigation?.toc) return;
            const currentSeq = ++tocRefreshSeqRef.current;

            const updateWithPreciseRatio = async (items: EpubTOCItem[]): Promise<EpubTOCItem[]> => {
              const result: EpubTOCItem[] = [];
              for (const item of items) {
                let resolvedCfi: string | null = null;
                let validNavigationCfi: string | undefined;
                let preciseRatio = item.progressRatio;
                try {
                  // href의 앵커까지 반영한 CFI를 계산해 같은 파일 내 여러 TOC 항목이 합쳐지는 문제를 줄임
                  resolvedCfi = await resolveCfiFromHref(item.href);

                  if (resolvedCfi) {
                    const locations = book.locations as unknown as EpubjsLocationsExtended;
                    const pos = getSafeLocationFromCfi(locations, resolvedCfi);
                    const total = getSafeLocationLength(locations);
                    if (pos !== null && total > 0) {
                      preciseRatio = toLocationRatio(pos, total);
                      validNavigationCfi = resolvedCfi;
                    }
                  }
                } catch {
                  // 실패 시 기존 비율 유지
                }

                result.push({
                  ...item,
                  // 유효성(위치 인덱스) 검증이 된 CFI만 이동 타겟으로 사용한다.
                  navigationCfi: validNavigationCfi,
                  progressRatio: preciseRatio,
                  progressPrecision: validNavigationCfi ? "precise" : (item.progressPrecision ?? "estimated"),
                  subitems: item.subitems ? await updateWithPreciseRatio(item.subitems) : undefined,
                });
              }
              return result;
            };

            const preciseTOC: EpubTOCItem[] = (book.navigation.toc as EpubjsNavigationItem[]).map(mapTOCItem);
            void updateWithPreciseRatio(preciseTOC).then((updated) => {
              if (tocRefreshSeqRef.current !== currentSeq) return;
              onTOCLoadRef.current?.(updated);
            });
          };

          // 초기 TOC 로드 (대략적인 위치)
          if (book.navigation && book.navigation.toc) {
            const formattedTOC: EpubTOCItem[] = (book.navigation.toc as EpubjsNavigationItem[]).map(mapTOCItem);
            onTOCLoadRef.current?.(assignEstimatedRatios(formattedTOC));
          }

          // === locations 로드: 캐시 우선, 없으면 백그라운드 생성 ===
          const CACHE_KEY = `epub-locations-${chapterId}`;
          const cachedLocations = localStorage.getItem(CACHE_KEY);

          if (cachedLocations) {
            // 캐시 히트 → 즉시 로드 + 최적화된 초기 디스플레이
            console.log("[EpubChapterViewer] Loading cached locations");
            try {
              book.locations.load(cachedLocations);
              locationsReadyRef.current = true;
              generatedTotalRef.current = getSafeLocationLength(book.locations);
              if (generatedTotalRef.current <= 0) {
                throw new Error("cached locations are empty or unreadable");
              }

              // 캐시 로드 후 정밀 TOC 업데이트
              refreshTOCWithPreciseRatios();

              const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;
              let targetCFI: string | undefined = initialCFI || undefined;

              // CFI가 없고 진행률만 있는 경우, locations 정보를 이용해 즉시 targetCFI 계산
              if (!targetCFI && expectedRatio > 0.01) {
                targetCFI =
                  initialOpenMode === "last" && lastSpineHref
                    ? lastSpineHref
                    : getSafeCfiFromPercentage(book.locations, expectedRatio);
              }

              console.log("[EpubChapterViewer] Displaying final position (cached):", targetCFI || "beginning");
              void displayWithFallback(targetCFI, expectedRatio);
              return;
            } catch (err) {
              console.warn("[EpubChapterViewer] Cached locations invalid, regenerating:", err);
              localStorage.removeItem(CACHE_KEY);
              locationsReadyRef.current = false;
              generatedTotalRef.current = 0;
            }
          }

          // 캐시 미스 → 기본 디스플레이 시도 + 백그라운드 생성
          console.log("[EpubChapterViewer] No cached locations, initial display then background generate");
          const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;
          const initialDisplayTarget = initialOpenMode === "last" && lastSpineHref ? lastSpineHref : (initialCFI ?? undefined);

          void displayWithFallback(initialDisplayTarget, expectedRatio).then(() => {
            if (isDisposed) return;
            void book.locations
              .generate(EPUB_LOCATION_STRIDE)
              .then(() => {
                if (isDisposed) return;
                // 생성 결과 캐시
                const locationsObj = book.locations as unknown as EpubjsLocationsExtended;
                try {
                  const serialized = locationsObj.save();
                  localStorage.setItem(CACHE_KEY, serialized);
                  console.log("[EpubChapterViewer] Locations generated and cached");
                } catch (err) {
                  console.warn("[EpubChapterViewer] Failed to cache locations:", err);
                }

                locationsReadyRef.current = true;
                generatedTotalRef.current = getSafeLocationLength(book.locations);
                onReadyRef.current?.(generatedTotalRef.current);

                // locations.generate 완료 후 정밀 TOC 업데이트
                refreshTOCWithPreciseRatios();

                // locations.generate 완료 후 현재 위치 보정 (사용자에게 보일 수 있음 - 캐시 없는 첫 방문 시)
                const currentLoc = rendition.currentLocation() as unknown as EpubjsLocation;
                const currentPct = currentLoc?.start?.percentage ?? 0;
                const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;
                const shouldCorrectFromProgress = initialOpenMode !== "last" && !initialCFI && expectedRatio > 0.01;

                if (currentPct < 0.01 && shouldCorrectFromProgress) {
                  try {
                    const cfiFromRatio = getSafeCfiFromPercentage(book.locations, expectedRatio);
                    if (cfiFromRatio) {
                      rendition.display(cfiFromRatio).then(() => {
                        const correctedLoc = rendition.currentLocation() as unknown as EpubjsLocation;
                        if (correctedLoc) handleRelocated(correctedLoc);
                      });
                    }
                  } catch (err) {
                    console.warn("[EpubChapterViewer] Background position correction failed:", err);
                  }
                }
              })
              .catch((err) => {
                console.warn("[EpubChapterViewer] Locations generation failed:", err);
              });
          });
        })
        .catch((err: Error) => {
          console.error("[EpubChapterViewer] Initialization failed:", err);
          onInitializationCompleteRef.current?.();
        });

      return () => {
        isDisposed = true;
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        rendition.off("relocated", handleRelocated as unknown as (...args: unknown[]) => void);
        const contentHook = rendition.hooks.content as unknown as {
          deregister?: (fn: (...args: unknown[]) => void) => void;
        };
        contentHook.deregister?.(handleContentInput as unknown as (...args: unknown[]) => void);
        contentDisposers.forEach((dispose) => {
          try {
            dispose();
          } catch (err) {
            console.warn("[EpubChapterViewer] content disposer failed:", err);
          }
        });
        contentDisposers.clear();
        try {
          book.destroy();
        } catch (err) {
          console.warn("[EpubChapterViewer] book destroy failed:", err);
        }
        bookRef.current = null;
        renditionRef.current = null;
        locationsReadyRef.current = false;
        generatedTotalRef.current = 0;
        hasStableLocationRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      epubUrl,
      chapterId,
      handleRelocated,
      applySettings,
      initialCFI,
      initialOpenMode,
      initialProgressRatio,
      snapRenditionToVisualEnd,
      settings.renderMode,
      settings.flow,
    ]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const scheduleReflow = () => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
        }
        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          reflowRendition();
        });
      };

      scheduleReflow();

      let observer: ResizeObserver | null = null;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          scheduleReflow();
        });
        observer.observe(container);
      }

      window.addEventListener("resize", scheduleReflow);

      return () => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        observer?.disconnect();
        window.removeEventListener("resize", scheduleReflow);
      };
    }, [reflowRendition]);

    // settings 변경 시 재생성 없이 현재 rendition에 스타일만 다시 적용한다.

    useEffect(() => {
      if (!renditionRef.current) return;
      const effectiveLayout = resolveEffectiveLayout(settings.renderMode, detectedLayoutRef.current);
      effectiveLayoutRef.current = effectiveLayout;
      onRenderLayoutChangeRef.current?.(effectiveLayout);
      applySettings(renditionRef.current, settings, effectiveLayout);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        reflowRendition(true);
      });
    }, [settings, applySettings, reflowRendition]);

    useImperativeHandle(ref, () => {
      const getNavigationSnapshot = (): NavigationSnapshot => {
        const rendition = renditionRef.current;
        const currentLocation = rendition?.currentLocation() as EpubjsLocation | undefined;
        const manager = rendition as unknown as {
          manager?: EpubManagerSnapshot;
        };

        return {
          cfi: currentLocation?.start?.cfi ?? null,
          page: currentLocation?.start?.displayed?.page ?? 0,
          index: currentLocation?.start?.index ?? -1,
          scrollLeft: manager.manager?.container?.scrollLeft ?? 0,
          scrollTop: manager.manager?.container?.scrollTop ?? 0,
        };
      };

      const didNavigationMove = (before: NavigationSnapshot, after: NavigationSnapshot): boolean => {
        return (
          before.cfi !== after.cfi ||
          before.page !== after.page ||
          before.index !== after.index ||
          Math.abs(before.scrollLeft - after.scrollLeft) > 2 ||
          Math.abs(before.scrollTop - after.scrollTop) > 2
        );
      };

      const isScrolledManagerAtEnd = (): boolean => {
        const manager = (renditionRef.current as unknown as { manager?: EpubManagerSnapshot })?.manager;
        if (!manager || manager.isPaginated !== false || !manager.container) return false;
        const scrollTop = manager.container.scrollTop ?? 0;
        const scrollHeight = manager.container.scrollHeight ?? 0;
        const clientHeight = manager.container.clientHeight ?? 0;
        if (scrollHeight <= clientHeight) return true;
        return scrollTop + clientHeight >= scrollHeight - 2;
      };

      const isScrolledManagerAtStart = (): boolean => {
        const manager = (renditionRef.current as unknown as { manager?: EpubManagerSnapshot })?.manager;
        if (!manager || manager.isPaginated !== false || !manager.container) return false;
        return (manager.container.scrollTop ?? 0) <= 2;
      };

      const withNavigation = async (action: () => Promise<boolean | void> | boolean | void): Promise<boolean> => {
        if (isNavigatingRef.current) return false;
        const before = getNavigationSnapshot();
        isNavigatingRef.current = true;
        if (containerRef.current) containerRef.current.style.opacity = "0";
        let explicitMovement: boolean | undefined;
        try {
          const result = await action();
          if (typeof result === "boolean") {
            explicitMovement = result;
          }
        } catch (err) {
          console.error("[EpubChapterViewer] Navigation error:", err);
        } finally {
          isNavigatingRef.current = false;
          if (containerRef.current) containerRef.current.style.opacity = "1";
          const loc = renditionRef.current?.currentLocation() as unknown as EpubjsLocation;
          if (loc) handleRelocated(loc);
        }

        if (explicitMovement !== undefined) {
          return explicitMovement;
        }

        const after = getNavigationSnapshot();
        return didNavigationMove(before, after);
      };

      return {
        next: async () => {
          if (!renditionRef.current) return false;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const manager = (renditionRef.current as any).manager;
            if (manager && manager.isPaginated && manager.container) {
              const dir = manager.settings?.direction;
              const scrollLeft = manager.container.scrollLeft;
              const scrollWidth = manager.container.scrollWidth;
              const clientWidth = manager.container.clientWidth;
              const delta = manager.layout?.delta || clientWidth;

              if (dir === "ltr") {
                if (scrollLeft + clientWidth < scrollWidth) {
                  const nextLeft = scrollLeft + delta;
                  if (nextLeft + clientWidth > scrollWidth) {
                    const targetLeft = Math.max(0, scrollWidth - clientWidth);
                    if (targetLeft - scrollLeft > 2) {
                      return withNavigation(() => {
                        manager.container.scrollLeft = targetLeft;
                        manager.updateOffset();
                        return true;
                      });
                    }
                  }
                }
              } else {
                if (scrollLeft > 0) {
                  const nextLeft = scrollLeft - delta;
                  if (nextLeft < 0) {
                    const targetLeft = 0;
                    if (scrollLeft - targetLeft > 2) {
                      return withNavigation(() => {
                        manager.container.scrollLeft = targetLeft;
                        manager.updateOffset();
                        return true;
                      });
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[EpubChapterViewer] manager next correction failed:", err);
          }
          const beforeLocation = renditionRef.current.currentLocation() as unknown as EpubjsLocation;
          const beforeIndex = beforeLocation?.start?.index ?? -1;
          const scrolledAtEndBeforeMove = isScrolledManagerAtEnd();
          const moved = await withNavigation(() => renditionRef.current!.next());
          if (moved || !scrolledAtEndBeforeMove) return moved;

          const book = bookRef.current;
          const spine = book?.spine as unknown as EpubjsSpine | undefined;
          const nextSpineItem = beforeIndex >= 0 ? spine?.spineItems?.[beforeIndex + 1] : undefined;
          if (!nextSpineItem?.href) return false;

          return withNavigation(() => renditionRef.current!.display(nextSpineItem.href));
        },
        prev: async () => {
          if (!renditionRef.current) return false;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const manager = (renditionRef.current as any).manager;
            if (manager && manager.isPaginated && manager.container) {
              const dir = manager.settings?.direction;
              const scrollLeft = manager.container.scrollLeft;
              const scrollWidth = manager.container.scrollWidth;
              const clientWidth = manager.container.clientWidth;
              const delta = manager.layout?.delta || clientWidth;

              if (dir === "ltr") {
                if (scrollLeft > 0) {
                  const prevLeft = scrollLeft - delta;
                  if (prevLeft < 0) {
                    const targetLeft = 0;
                    if (scrollLeft - targetLeft > 2) {
                      return withNavigation(() => {
                        manager.container.scrollLeft = targetLeft;
                        manager.updateOffset();
                        return true;
                      });
                    }
                  }
                }
              } else {
                if (scrollLeft + clientWidth < scrollWidth) {
                  const prevLeft = scrollLeft + delta;
                  if (prevLeft + clientWidth > scrollWidth) {
                    const targetLeft = Math.max(0, scrollWidth - clientWidth);
                    if (targetLeft - scrollLeft > 2) {
                      return withNavigation(() => {
                        manager.container.scrollLeft = targetLeft;
                        manager.updateOffset();
                        return true;
                      });
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[EpubChapterViewer] manager prev correction failed:", err);
          }
          // 섹션 경계를 넘는 prev()는 이전 섹션의 끝이 아닌 중간 위치로 이동하는
          // epub.js 버그가 있어, 섹션 변경 감지 후 마지막 페이지로 스크롤을 보정한다.
          const beforeLocation = renditionRef.current.currentLocation() as unknown as EpubjsLocation;
          const beforeIndex = beforeLocation?.start?.index ?? -1;
          const scrolledAtStartBeforeMove = isScrolledManagerAtStart();
          const moved = await withNavigation(async () => {
            await renditionRef.current!.prev();

            const afterLoc = renditionRef.current!.currentLocation() as unknown as EpubjsLocation;
            const afterIndex = afterLoc?.start?.index;
            if (beforeIndex !== undefined && afterIndex !== undefined && beforeIndex !== afterIndex) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const mgr = (renditionRef.current as any).manager;
                if (mgr?.isPaginated && mgr.container) {
                  const d = mgr.settings?.direction;
                  const sw = mgr.container.scrollWidth;
                  const cw = mgr.container.clientWidth;
                  const dt = mgr.layout?.delta || cw;
                  if (d === "rtl") {
                    mgr.container.scrollLeft = 0;
                  } else {
                    const maxScroll = Math.max(0, sw - cw);
                    mgr.container.scrollLeft = Math.floor(maxScroll / dt) * dt;
                  }
                  mgr.updateOffset?.();
                }
              } catch (err) {
                console.warn("[EpubChapterViewer] manager prev-section correction failed:", err);
              }
            }
          });
          if (moved || !scrolledAtStartBeforeMove) return moved;

          const book = bookRef.current;
          const spine = book?.spine as unknown as EpubjsSpine | undefined;
          const prevSpineItem = beforeIndex > 0 ? spine?.spineItems?.[beforeIndex - 1] : undefined;
          if (!prevSpineItem?.href) return false;

          const movedToPrev = await withNavigation(() => renditionRef.current!.display(prevSpineItem.href));
          try {
            const manager = (renditionRef.current as unknown as { manager?: EpubManagerSnapshot })?.manager;
            const container = manager?.container;
            if (manager?.isPaginated === false && container) {
              container.scrollTop = Math.max(0, (container.scrollHeight ?? 0) - (container.clientHeight ?? 0));
              const loc = renditionRef.current?.currentLocation() as unknown as EpubjsLocation;
              if (loc) handleRelocated(loc);
            }
          } catch (err) {
            console.warn("[EpubChapterViewer] manager prev-scrolled fallback failed:", err);
          }
          return movedToPrev;
        },
        goToCFI: (cfi: string) => {
          if (!renditionRef.current) return;
          withNavigation(() => renditionRef.current!.display(cfi));
        },
        goToProgress: (ratio: number) => {
          const rendition = renditionRef.current;
          const book = bookRef.current;
          if (!rendition || !book) return;

          const clamped = Math.max(0, Math.min(1, ratio));
          const locations = book.locations as unknown as EpubjsLocationsExtended;
          const total = getSafeLocationLength(locations);
          let cfi: string | undefined = undefined;
          if (total > 0) {
            const targetIndex = Math.max(0, Math.min(total - 1, Math.round(clamped * (total - 1))));
            cfi = getSafeCfiFromLocation(locations, targetIndex);
          }
          if (!cfi) {
            cfi = getSafeCfiFromPercentage(locations, clamped);
          }
          if (!cfi) return;

          withNavigation(() => rendition.display(cfi));
        },
        goToPage: (page: number) => {
          const rendition = renditionRef.current;
          const book = bookRef.current;
          if (!rendition || !book) return;

          const total = getSafeLocationLength(book.locations);
          if (total <= 0) return;

          const clampedPage = Math.max(1, Math.min(total, page));
          const cfi = getSafeCfiFromLocation(book.locations, clampedPage - 1);
          if (!cfi) return;

          withNavigation(() => rendition.display(cfi));
        },
      };
    });

    return (
      <div
        className={`${styles.container} ${settings.flow === "scrolled" ? styles.scrolled : ""}`}
        style={{ background: getEpubThemeStyle(settings.theme).background }}
      >
        <div
          ref={containerRef}
          className={styles.viewer}
          style={{ transition: "opacity 0.15s ease-out" }}
        />
        {!hideChapterPageInfo && (
          <div className={`${styles.chapterPageInfo} ${isUIVisible ? styles.hidden : ""}`}>
            {chapterTitle} - {Math.max(1, chapterPage || 1)}/{Math.max(1, chapterTotal || 1)}
            {globalProgressPercent != null && ` | ${globalProgressPercent}%`}
          </div>
        )}
      </div>
    );
  },
);

EpubChapterViewer.displayName = "EpubChapterViewer";
export { EpubChapterViewer };
