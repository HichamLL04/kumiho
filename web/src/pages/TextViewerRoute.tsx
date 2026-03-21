import React, { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { chapterAPI, seriesAPI } from "../api/client";
import { useViewerStore, type ReadingMode } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { startChapterSwitching } from "../stores/fullscreenSwitchStore";
import { ViewerSettings as ViewerSettingsModal } from "../components/viewer/ViewerSettings";
import {
  UI_HIDE_DELAY,
  useAdjacentChapters,
  useExitFullscreenOnViewerUnmount,
  useProgressSync,
  useRestoreFullscreenAfterChapterSwitch,
  ViewerFooter,
  ViewerHeader,
  PageJumpModal,
  SyncConfirmModal,
  ChapterNavHint,
  PullIndicator,
} from "../features/viewer";
import { useViewerSync } from "../hooks/useViewerSync";
import { useReadingTime } from "../hooks/useReadingTime";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { AlertModal } from "../components/modals/AlertModal";
import { API_BASE_URL } from "../features/viewer/utils/imageUrl";
import { usePreventBrowserZoom } from "../features/viewer/hooks/usePreventBrowserZoom";
import { buildViewerRouteState } from "../utils/viewerRouteState";
import { getTranslationForVirtualPage, measureVirtualPaging } from "./textViewerPaging";
import {
  createViewportAnchor,
  findParagraphForAbsoluteOffset,
  normalizeTextContent,
  parseTextParagraphs,
  resolveSavedAnchorToAbsoluteOffset,
  type SavedTextAnchor,
  type ViewportAnchor,
} from "./textViewerAnchors";
import viewerStyles from "./Viewer.module.css";
import styles from "./TextViewerRoute.module.css";

interface TextViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

interface TextProgressSnapshot {
  chapter_id: string;
  volume_id: string;
  current_page: number;
  total_pages: number;
  current_position: number;
  total_positions: number;
  progress_percent: number;
  current_cfi: string;
}

interface PendingModeTransition {
  fromMode: ReadingMode;
  fromPage: number;
}

const SAVE_INTERVAL = 3000;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resolveApiUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(path, window.location.origin).toString();
  }
  return path;
};

const resolveTextColorFromBackground = (backgroundColor: string): string => {
  const normalized = backgroundColor.trim().toLowerCase();
  if (normalized === "#ffffff") return "#1a1a1a";
  if (normalized === "#f4ecd8") return "#3b2f2f";
  return "#f7f7f7";
};

const resolveTextFontFamily = (fontFamily: "original" | "serif" | "sans-serif"): string => {
  if (fontFamily === "serif") return '"Noto Serif KR", "Times New Roman", serif';
  if (fontFamily === "sans-serif") return '"Pretendard", "Noto Sans KR", sans-serif';
  // "original": 브라우저/시스템 기본 폰트를 그대로 사용
  return "inherit";
};

const parseAnchor = (raw?: string): SavedTextAnchor | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedTextAnchor;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
};

const getNumericStyle = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getAnchorInsetForMode = (mode: ReadingMode): number => {
  if (mode === "double") return 28;
  if (mode === "single") return 8;
  return 8;
};

const getAbsoluteOffsetFromAnchor = (anchor: SavedTextAnchor | null): number | null => {
  if (!anchor) return null;
  if (anchor.kind === "txt_anchor_v2" && "absoluteOffset" in anchor) return anchor.absoluteOffset;
  if ("offset" in anchor && typeof anchor.offset === "number") return anchor.offset;
  return null;
};

const getViewportRectForAnchor = (
  container: HTMLDivElement,
  mode: ReadingMode,
  pagedViewport: HTMLDivElement | null,
) => {
  if (mode === "vertical") {
    const rect = container.getBoundingClientRect();
    const style = window.getComputedStyle(container);
    const paddingLeft = getNumericStyle(style.paddingLeft);
    const paddingTop = getNumericStyle(style.paddingTop);
    return {
      left: rect.left + paddingLeft,
      top: rect.top + paddingTop,
      width: Math.max(1, container.clientWidth - paddingLeft - getNumericStyle(style.paddingRight)),
      height: Math.max(1, container.clientHeight - paddingTop - getNumericStyle(style.paddingBottom)),
    };
  }

  const viewport = pagedViewport ?? container;
  const rect = viewport.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: Math.max(1, rect.width || viewport.clientWidth || container.clientWidth),
    height: Math.max(1, rect.height || viewport.clientHeight || container.clientHeight),
  };
};

const getClosestParagraphElement = (node: Node | null): HTMLElement | null => {
  if (!node) return null;
  if (node instanceof HTMLElement) {
    return node.closest("p[data-paragraph-id]");
  }
  return node.parentElement?.closest("p[data-paragraph-id]") ?? null;
};

const findFirstVisibleParagraph = (container: HTMLElement, mode: ReadingMode): HTMLElement | null => {
  const paragraphs = Array.from(container.querySelectorAll<HTMLElement>("p[data-paragraph-id]"));
  if (paragraphs.length === 0) return null;

  const containerRect = container.getBoundingClientRect();

  for (const paragraph of paragraphs) {
    const rect = paragraph.getBoundingClientRect();
    if (mode === "vertical") {
      if (rect.bottom > containerRect.top + 8) {
        return paragraph;
      }
    } else if (rect.right > containerRect.left + 4 && rect.bottom > containerRect.top + 4) {
      return paragraph;
    }
  }

  return paragraphs[0] ?? null;
};

const getCaretPoint = (x: number, y: number): { node: Node; offset: number } | null => {
  const doc = document as Document & {
    caretPositionFromPoint?: (px: number, py: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (px: number, py: number) => Range | null;
  };

  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    if (position?.offsetNode) {
      return { node: position.offsetNode, offset: position.offset };
    }
  }

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (range?.startContainer) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  }

  return null;
};

const getTextOffsetWithinParagraph = (paragraph: HTMLElement, node: Node, offset: number): number => {
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
};

const createRangeForParagraphOffset = (paragraph: HTMLElement, offsetInParagraph: number): Range | null => {
  const textWalker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let currentNode = textWalker.nextNode();
  while (currentNode) {
    if (currentNode instanceof Text) {
      textNodes.push(currentNode);
    }
    currentNode = textWalker.nextNode();
  }

  if (textNodes.length === 0) return null;

  let remaining = offsetInParagraph;
  for (const textNode of textNodes) {
    const textLength = textNode.textContent?.length ?? 0;
    if (textLength === 0) continue;

    if (remaining < textLength) {
      const range = document.createRange();
      range.setStart(textNode, remaining);
      range.setEnd(textNode, Math.min(textLength, remaining + 1));
      return range;
    }

    remaining -= textLength;
  }

  const lastNode = textNodes[textNodes.length - 1];
  const lastLength = lastNode.textContent?.length ?? 0;
  if (lastLength === 0) return null;

  const range = document.createRange();
  range.setStart(lastNode, Math.max(0, lastLength - 1));
  range.setEnd(lastNode, lastLength);
  return range;
};

const getRangeRect = (range: Range): DOMRect | null => {
  const safeRange = range as Range & {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  const rects = typeof safeRange.getClientRects === "function" ? Array.from(safeRange.getClientRects()) : [];
  const visibleRect = rects.find((rect) => rect.width > 0 || rect.height > 0);
  if (visibleRect) return visibleRect;

  const boundingRect = typeof safeRange.getBoundingClientRect === "function" ? safeRange.getBoundingClientRect() : null;
  if (!boundingRect) return null;
  if (boundingRect.width > 0 || boundingRect.height > 0) {
    return boundingRect;
  }

  return null;
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: "red", padding: "20px", background: "black", height: "100vh" }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.toString()}</pre>
          <pre>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function TextViewerRouteInner({ loaderData }: TextViewerRouteProps) {
  const { chapterId: routeChapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();
  usePreventBrowserZoom(true);

  const { chapter, seriesId, volumeId, isLoading: chapterLoading, error } = loaderData;
  const chapterId = chapter?.id || "";
  const setViewStatus = loaderData.setViewStatus;
  const viewStatus = loaderData.viewStatus;

  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;
  const routeIsIncognito = location.state?.isIncognito === true;

  const {
    currentPage,
    totalPages,
    isUIVisible,
    isSettingsOpen,
    isFullscreen,
    isIncognito,
    settings,
    setCurrentPage,
    setTotalPages,
    showUI,
    hideUI,
    toggleSettings,
    closeSettings,
    setFullscreen,
    setReadingMode,
    togglePageOffset,
  } = useViewerStore();
  const effectiveIncognito = isIncognito || routeIsIncognito;

  const [text, setText] = useState("");
  const [isLoadingText, setIsLoadingText] = useState(true);
  const [showPageJump, setShowPageJump] = useState(false);
  const [restoreAnchor, setRestoreAnchor] = useState<SavedTextAnchor | null>(null);
  const [settledRestoreChapterId, setSettledRestoreChapterId] = useState<string | null>(null);
  const [currentOffsetX, setCurrentOffsetX] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [highlightParagraphId, setHighlightParagraphId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pagedViewportRef = useRef<HTMLDivElement>(null);
  const textBodyRef = useRef<HTMLElement>(null);
  const uiTimerRef = useRef<number | null>(null);
  const uiShownTimeRef = useRef<number>(0);
  const isInteractingRef = useRef(false);
  const lastSaveRef = useRef<number>(0);
  const saveTimerRef = useRef<number | null>(null);
  const currentOffsetXRef = useRef(0);
  const totalPagesRef = useRef(totalPages);
  const currentPageRef = useRef(currentPage);
  const pendingTransitionAnchorRef = useRef<ViewportAnchor | null>(null);
  const pendingModeTransitionRef = useRef<PendingModeTransition | null>(null);
  const lastRestoredPagedPageRef = useRef<number | null>(null);
  const pendingHighlightParagraphRef = useRef<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const isRestoringRef = useRef(false);
  const isRestoreSettled = settledRestoreChapterId === chapterId;

  totalPagesRef.current = totalPages;
  currentPageRef.current = currentPage;

  const parsedParagraphs = useMemo(() => parseTextParagraphs(text), [text]);
  const paragraphMap = useMemo(() => new Map(parsedParagraphs.map((item) => [item.id, item])), [parsedParagraphs]);

  const renderedParagraphs = useMemo(() => {
    return parsedParagraphs.map((paragraph) => (
      <p
        key={paragraph.id}
        data-paragraph-id={paragraph.id}
        className={highlightParagraphId === paragraph.id ? styles.readingHighlight : ""}
      >
        {paragraph.text}
      </p>
    ));
  }, [highlightParagraphId, parsedParagraphs]);

  const { nextChapterId, prevChapterId, nextChapterTitle, prevChapterTitle, isAdjacentResolved } = useAdjacentChapters({
    volumeId,
    chapterId,
    seriesId,
  });

  useReadingTime(seriesId || undefined, !chapterLoading && !isLoadingText && !error, chapterId);

  const [nextHintTriggeredChapterId, setNextHintTriggeredChapterId] = useState<string | null>(null);
  const [prevHintTriggeredChapterId, setPrevHintTriggeredChapterId] = useState<string | null>(null);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pullOffset, setPullOffset] = useState(0);
  const pullOffsetRef = useRef(0);
  const isNavigatingRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);

  const showNextHint = nextHintTriggeredChapterId === chapterId;
  const showPrevHint = prevHintTriggeredChapterId === chapterId;

  const setOffset = useCallback((newOffsetX: number) => {
    currentOffsetXRef.current = Math.max(0, newOffsetX);
    setCurrentOffsetX(Math.max(0, newOffsetX));
  }, []);

  const getContentScrollWidth = useCallback(() => {
    if (settings.readingMode === "vertical") return undefined;
    return textBodyRef.current?.scrollWidth;
  }, [settings.readingMode]);

  const getPagedViewportWidth = useCallback(() => {
    if (settings.readingMode === "vertical") return undefined;
    const viewport = pagedViewportRef.current;
    if (viewport && viewport.clientWidth > 0) {
      return Math.max(1, viewport.clientWidth);
    }
    const container = scrollRef.current;
    if (!container) return undefined;
    const style = window.getComputedStyle(container);
    const horizontalPadding = getNumericStyle(style.paddingLeft) + getNumericStyle(style.paddingRight);
    return Math.max(1, container.clientWidth - horizontalPadding);
  }, [settings.readingMode]);

  const resolveAnchorTarget = useCallback(
    (anchor: SavedTextAnchor | null) => {
      const absoluteOffset = resolveSavedAnchorToAbsoluteOffset(text, parsedParagraphs, anchor);
      if (absoluteOffset === null) return null;

      const paragraph = findParagraphForAbsoluteOffset(parsedParagraphs, absoluteOffset);
      if (!paragraph) return null;

      return {
        absoluteOffset,
        paragraphId: paragraph.id,
        offsetInParagraph: clamp(absoluteOffset - paragraph.startOffset, 0, paragraph.text.length),
      };
    },
    [parsedParagraphs, text],
  );

  const resolveAnchorRange = useCallback(
    (anchor: SavedTextAnchor | null) => {
      const target = resolveAnchorTarget(anchor);
      if (!target) return null;

      const article = textBodyRef.current;
      if (!article) return null;

      const paragraph = article.querySelector<HTMLElement>(`p[data-paragraph-id="${CSS.escape(target.paragraphId)}"]`);
      if (!paragraph) return null;

      const range = createRangeForParagraphOffset(paragraph, target.offsetInParagraph);
      if (!range) return null;

      const rect = getRangeRect(range);
      if (!rect) return null;

      return {
        ...target,
        paragraph,
        range,
        rect,
      };
    },
    [resolveAnchorTarget],
  );

  const buildViewportAnchorSnapshot = useCallback(
    (modeOverride?: ReadingMode): ViewportAnchor | null => {
      if (!text || parsedParagraphs.length === 0) return null;

      const container = scrollRef.current;
      if (!container) return null;

      const mode = modeOverride ?? settings.readingMode;
      const viewportRect = getViewportRectForAnchor(container, mode, pagedViewportRef.current);
      const inset = getAnchorInsetForMode(mode);
      const pointX = viewportRect.left + inset;
      const pointY = viewportRect.top + inset;

      const caret = getCaretPoint(pointX, pointY);
      const paragraphElement = caret
        ? (getClosestParagraphElement(caret.node) ?? findFirstVisibleParagraph(container, mode))
        : findFirstVisibleParagraph(container, mode);

      if (!paragraphElement) {
        const fallbackAnchor = createViewportAnchor(text, parsedParagraphs, parsedParagraphs[0].id, 0);
        if (!fallbackAnchor) return null;
        return {
          ...fallbackAnchor,
          relativeX: inset,
          relativeY: inset,
        };
      }

      const paragraphId = paragraphElement.getAttribute("data-paragraph-id");
      if (!paragraphId) return null;

      const paragraphMeta = paragraphMap.get(paragraphId);
      if (!paragraphMeta) return null;

      const offsetInParagraph =
        caret && getClosestParagraphElement(caret.node) === paragraphElement
          ? clamp(
              getTextOffsetWithinParagraph(paragraphElement, caret.node, caret.offset),
              0,
              paragraphMeta.text.length,
            )
          : 0;

      const anchor = createViewportAnchor(text, parsedParagraphs, paragraphId, offsetInParagraph);
      if (!anchor) return null;

      const range = createRangeForParagraphOffset(paragraphElement, offsetInParagraph);
      const rect = (range && getRangeRect(range)) || paragraphElement.getBoundingClientRect();
      const relativeX = clamp(rect.left - viewportRect.left, 0, Math.max(0, viewportRect.width - 1));
      const relativeY = clamp(rect.top - viewportRect.top, 0, Math.max(0, viewportRect.height - 1));

      return {
        ...anchor,
        relativeX,
        relativeY,
      };
    },
    [paragraphMap, parsedParagraphs, settings.readingMode, text],
  );

  const applyParagraphHighlight = useCallback((paragraphId: string | null) => {
    if (!paragraphId) return;

    setHighlightParagraphId(paragraphId);
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightParagraphId(null);
      highlightTimeoutRef.current = null;
    }, 2000);
  }, []);

  const updateVirtualPage = useCallback(
    (overrideOffsetX?: number) => {
      const container = scrollRef.current;
      if (!container) return;

      const metrics = measureVirtualPaging(
        container,
        settings.readingMode,
        overrideOffsetX ?? currentOffsetXRef.current,
        getContentScrollWidth(),
        getPagedViewportWidth(),
      );

      let nextCurrentPage = metrics.currentPage;

      if (overrideOffsetX === undefined && isRestoringRef.current) {
        if (totalPagesRef.current !== metrics.totalPages) {
          setTotalPages(metrics.totalPages);
        }
        return;
      }

      if (overrideOffsetX === undefined) {
        const anchor = buildViewportAnchorSnapshot();
        const resolvedAnchor = resolveAnchorRange(anchor);

        if (resolvedAnchor) {
          if (settings.readingMode === "vertical") {
            nextCurrentPage = clamp(
              Math.floor(container.scrollTop / metrics.viewportHeight) + 1,
              1,
              metrics.totalPages,
            );
          } else {
            const articleRect = textBodyRef.current?.getBoundingClientRect();
            if (articleRect) {
              const screenIndex = clamp(
                Math.floor((resolvedAnchor.rect.left - articleRect.left) / metrics.viewportWidth),
                0,
                Math.max(0, Math.ceil(metrics.totalPages / (settings.readingMode === "double" ? 2 : 1)) - 1),
              );
              nextCurrentPage = settings.readingMode === "double" ? screenIndex * 2 + 1 : screenIndex + 1;
            }
          }
        }
      }

      if (metrics.isAtVisualEnd) {
        nextCurrentPage = metrics.totalPages;
      }

      if (totalPagesRef.current !== metrics.totalPages) {
        setTotalPages(metrics.totalPages);
      }
      if (currentPageRef.current !== nextCurrentPage) {
        setCurrentPage(nextCurrentPage);
      }
    },
    [
      buildViewportAnchorSnapshot,
      getContentScrollWidth,
      getPagedViewportWidth,
      resolveAnchorRange,
      setCurrentPage,
      setTotalPages,
      settings.readingMode,
    ],
  );

  const getCurrentVisualPage = useCallback(
    (mode: ReadingMode): number => {
      const container = scrollRef.current;
      if (!container) {
        return clamp(currentPageRef.current, 1, Math.max(1, totalPagesRef.current));
      }

      const metrics = measureVirtualPaging(
        container,
        mode,
        currentOffsetXRef.current,
        mode === "vertical" ? undefined : getContentScrollWidth(),
        mode === "vertical" ? undefined : getPagedViewportWidth(),
      );

      return clamp(metrics.currentPage, 1, Math.max(1, metrics.totalPages));
    },
    [getContentScrollWidth, getPagedViewportWidth],
  );

  const buildProgressSnapshot = useCallback((): TextProgressSnapshot | null => {
    if (effectiveIncognito || !chapter || !chapterId || !seriesId || !text) return null;

    const anchor = buildViewportAnchorSnapshot();
    if (!anchor) return null;

    const safeTotalPages = Math.max(1, totalPagesRef.current);
    const safeCurrentPage = clamp(currentPageRef.current, 1, safeTotalPages);

    return {
      chapter_id: chapterId,
      volume_id: chapter.volume_id,
      current_page: safeCurrentPage,
      total_pages: safeTotalPages,
      current_position: anchor.absoluteOffset,
      total_positions: text.length,
      progress_percent: (safeCurrentPage / safeTotalPages) * 100,
      current_cfi: JSON.stringify(anchor),
    };
  }, [buildViewportAnchorSnapshot, chapter, chapterId, effectiveIncognito, seriesId, text]);

  const saveProgress = useCallback(async () => {
    const payload = buildProgressSnapshot();
    if (!payload || !seriesId) return;
    await seriesAPI.updateProgress(seriesId, payload);
  }, [buildProgressSnapshot, seriesId]);

  const flushProgressKeepalive = useCallback(() => {
    if (import.meta.env.MODE === "test") return;

    const payload = buildProgressSnapshot();
    if (!payload) return;

    fetch(resolveApiUrl(`${API_BASE_URL}/series/${seriesId}/progress`), {
      method: "PATCH",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
    }).catch((err) => console.error("[TextViewer] keepalive save failed:", err));
  }, [buildProgressSnapshot, seriesId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const now = Date.now();
    const elapsed = now - lastSaveRef.current;
    if (elapsed >= SAVE_INTERVAL) {
      saveProgress().catch((err) => console.error("[TextViewer] save failed:", err));
      lastSaveRef.current = now;
      return;
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveProgress().catch((err) => console.error("[TextViewer] save failed:", err));
      lastSaveRef.current = Date.now();
    }, SAVE_INTERVAL - elapsed);
  }, [saveProgress]);

  const handleBack = useCallback(() => {
    if (viewerFrom) {
      navigate(viewerFrom);
      return;
    }
    navigate("/");
  }, [navigate, viewerFrom]);

  const handleToggleFullscreen = useCallback(() => {
    try {
      if (!isDocumentFullscreen()) {
        enterFullscreen().catch(() => {});
      } else {
        exitFullscreen().catch(() => {});
      }
    } catch (err) {
      console.error("Fullscreen toggle failed:", err);
    }
  }, []);

  const resetUITimer = useCallback(() => {
    if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
    if (!isSettingsOpen && !isInteractingRef.current) {
      uiTimerRef.current = window.setTimeout(() => {
        hideUI();
      }, UI_HIDE_DELAY);
    }
  }, [hideUI, isSettingsOpen]);

  const handleInteractionStart = useCallback(() => {
    isInteractingRef.current = true;
    if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
  }, []);

  const handleInteractionEnd = useCallback(() => {
    isInteractingRef.current = false;
    if (!isUIVisible) return;
    const elapsed = Date.now() - uiShownTimeRef.current;
    if (elapsed >= UI_HIDE_DELAY) {
      hideUI();
      return;
    }
    resetUITimer();
  }, [hideUI, isUIVisible, resetUITimer]);

  const goToPage = useCallback(
    (page: number) => {
      const container = scrollRef.current;
      if (!container) return;

      const { scrollTop, translateX } = getTranslationForVirtualPage(
        container,
        page,
        settings.readingMode,
        getContentScrollWidth(),
        getPagedViewportWidth(),
      );

      if (settings.readingMode === "vertical") {
        container.scrollTop = scrollTop;
      } else {
        setOffset(translateX);
      }

      updateVirtualPage(translateX);
      scheduleSave();
    },
    [getContentScrollWidth, getPagedViewportWidth, scheduleSave, setOffset, settings.readingMode, updateVirtualPage],
  );

  const handleNext = useCallback(async () => {
    const container = scrollRef.current;
    if (!container) return;

    if (settings.readingMode === "vertical") {
      const metrics = measureVirtualPaging(container, settings.readingMode);
      if (!metrics.isAtVisualEnd) {
        container.scrollTop = Math.min(container.scrollTop + metrics.viewportHeight, metrics.maxScrollTop);
        updateVirtualPage();
        scheduleSave();
        return;
      }
    } else {
      const offsetX = currentOffsetXRef.current;
      const metrics = measureVirtualPaging(
        container,
        settings.readingMode,
        offsetX,
        getContentScrollWidth(),
        getPagedViewportWidth(),
      );

      if (!metrics.isAtVisualEnd) {
        const nextX = offsetX + metrics.viewportWidth;
        setOffset(nextX);
        updateVirtualPage(nextX);
        scheduleSave();
        return;
      }
    }

    if (showNextHint && nextChapterId && isAdjacentResolved) {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      try {
        await saveProgress();
      } catch (err) {
        console.warn("Failed to save progress before navigation", err);
      }
      startChapterSwitching(isDocumentFullscreen());
      navigate(`/viewer/${nextChapterId}`, {
        replace: true,
        state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
      });
    } else if (nextChapterId) {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      setPrevHintTriggeredChapterId(null);
      setNextHintTriggeredChapterId(chapterId || null);
      hintTimeoutRef.current = setTimeout(() => {
        setNextHintTriggeredChapterId(null);
        hintTimeoutRef.current = null;
      }, 3000);
    }
  }, [
    chapterId,
    getContentScrollWidth,
    getPagedViewportWidth,
    isAdjacentResolved,
    navigate,
    nextChapterId,
    saveProgress,
    scheduleSave,
    setOffset,
    settings.readingMode,
    showNextHint,
    updateVirtualPage,
    viewerFrom,
    routeIsIncognito,
  ]);

  const handlePrev = useCallback(async () => {
    const container = scrollRef.current;
    if (!container) return;

    if (settings.readingMode === "vertical") {
      const metrics = measureVirtualPaging(container, settings.readingMode);
      if (!metrics.isAtVisualStart) {
        container.scrollTop = Math.max(container.scrollTop - metrics.viewportHeight, 0);
        updateVirtualPage();
        scheduleSave();
        return;
      }
    } else {
      const offsetX = currentOffsetXRef.current;
      const metrics = measureVirtualPaging(
        container,
        settings.readingMode,
        offsetX,
        getContentScrollWidth(),
        getPagedViewportWidth(),
      );

      if (!metrics.isAtVisualStart) {
        const prevX = Math.max(offsetX - metrics.viewportWidth, 0);
        setOffset(prevX);
        updateVirtualPage(prevX);
        scheduleSave();
        return;
      }
    }

    if (showPrevHint && prevChapterId && isAdjacentResolved) {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      try {
        await saveProgress();
      } catch (err) {
        console.warn("Failed to save progress before navigation", err);
      }
      startChapterSwitching(isDocumentFullscreen());
      navigate(`/viewer/${prevChapterId}?page=last`, {
        replace: true,
        state: buildViewerRouteState({
          from: viewerFrom,
          isIncognito: routeIsIncognito,
          preventComplete: true,
        }),
      });
    } else if (prevChapterId) {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      setNextHintTriggeredChapterId(null);
      setPrevHintTriggeredChapterId(chapterId || null);
      hintTimeoutRef.current = setTimeout(() => {
        setPrevHintTriggeredChapterId(null);
        hintTimeoutRef.current = null;
      }, 3000);
    }
  }, [
    chapterId,
    getContentScrollWidth,
    getPagedViewportWidth,
    isAdjacentResolved,
    navigate,
    prevChapterId,
    saveProgress,
    scheduleSave,
    setOffset,
    settings.readingMode,
    showPrevHint,
    updateVirtualPage,
    viewerFrom,
    routeIsIncognito,
  ]);

  const handleReadingModeChange = useCallback(
    (newMode: ReadingMode) => {
      if (newMode === settings.readingMode) return;

      const anchor = buildViewportAnchorSnapshot(settings.readingMode);
      pendingTransitionAnchorRef.current = anchor;
      pendingModeTransitionRef.current = {
        fromMode: settings.readingMode,
        fromPage:
          settings.readingMode === "single" && lastRestoredPagedPageRef.current !== null
            ? lastRestoredPagedPageRef.current
            : getCurrentVisualPage(settings.readingMode),
      };
      lastRestoredPagedPageRef.current = null;
      pendingHighlightParagraphRef.current = anchor?.paragraphId ?? null;
      if (seriesId) {
        void seriesAPI.updateViewerSettings(seriesId, { reading_mode: newMode }).catch((error) => {
          console.warn("[TextViewer] failed to persist reading mode", error);
        });
      }
      setReadingMode(newMode);
    },
    [buildViewportAnchorSnapshot, getCurrentVisualPage, seriesId, setReadingMode, settings.readingMode],
  );

  const handleContentTap = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isSettingsOpen) return;
      if (settings.readingMode === "vertical") {
        if (isUIVisible) {
          hideUI();
          return;
        }
        showUI();
        resetUITimer();
        return;
      }

      const container = scrollRef.current;
      if (!container) return;

      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      const width = container.clientWidth;
      const x = event.clientX - container.getBoundingClientRect().left;
      const leftBoundary = width * 0.3;
      const rightBoundary = width * 0.7;
      const nextIsRight = settings.clickDirection === "ltr";

      if (x <= leftBoundary) {
        if (nextIsRight) {
          handlePrev();
        } else {
          handleNext();
        }
        return;
      }

      if (x >= rightBoundary) {
        if (nextIsRight) {
          handleNext();
        } else {
          handlePrev();
        }
        return;
      }

      if (isUIVisible) {
        hideUI();
        return;
      }
      showUI();
      resetUITimer();
    },
    [
      handleNext,
      handlePrev,
      hideUI,
      isSettingsOpen,
      isUIVisible,
      resetUITimer,
      settings.clickDirection,
      settings.readingMode,
      showUI,
    ],
  );

  const { showSyncModal, serverProgress, handleConfirmSync, handleCloseModal } = useProgressSync({
    seriesId,
    chapter,
    currentPage,
    isLoading: chapterLoading || isLoadingText,
    isRestoreSettled,
  });

  const { terminatedInfo } = useViewerSync({
    seriesId: seriesId || "",
    chapterId: chapter?.id,
    currentPage,
    isLoading: chapterLoading || isLoadingText,
    isIncognito: effectiveIncognito,
  });

  const handleTerminatedConfirm = useCallback(() => {
    if (viewerFrom) {
      navigate(viewerFrom);
      return;
    }
    navigate("/");
  }, [navigate, viewerFrom]);

  useEffect(() => {
    if (!chapterId) return;

    let cancelled = false;
    setIsLoadingText(true);

    const loadText = async () => {
      try {
        const [textRes, progressRes] = await Promise.all([
          chapterAPI.getText(chapterId),
          chapterAPI.getProgress(chapterId),
        ]);
        if (cancelled) return;

        const normalizedText = normalizeTextContent(textRes.data.content || "");
        setText(normalizedText);

        const progress = progressRes.data?.progress;
        if (progress?.current_cfi) {
          setRestoreAnchor(parseAnchor(progress.current_cfi));
        } else if (typeof progress?.current_position === "number" && progress.current_position >= 0) {
          setRestoreAnchor({
            kind: "txt_anchor",
            offset: progress.current_position,
          });
        } else {
          setRestoreAnchor(null);
        }
      } catch (err) {
        console.error("[TextViewer] failed to load text data:", err);
        if (!cancelled) {
          setText("");
          setRestoreAnchor(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingText(false);
        }
      }
    };

    loadText();
    return () => {
      cancelled = true;
    };
  }, [chapterId]);

  useEffect(() => {
    if (scrollRef.current) {
      setViewportWidth(getPagedViewportWidth() ?? scrollRef.current.clientWidth);
    }
  }, [getPagedViewportWidth]);

  useEffect(() => {
    const pendingAnchor = pendingTransitionAnchorRef.current;
    if (!pendingAnchor) return;

    pendingTransitionAnchorRef.current = null;
    setRestoreAnchor(pendingAnchor);
  }, [settings.readingMode]);

  useEffect(() => {
    if (chapterLoading || isLoadingText || !chapter || restoreAnchor || viewStatus === "ready") return;

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      updateVirtualPage();
      setViewStatus?.("ready");
      setSettledRestoreChapterId(chapterId);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [chapter, chapterId, chapterLoading, isLoadingText, restoreAnchor, setViewStatus, updateVirtualPage, viewStatus]);

  useEffect(() => {
    if (!restoreAnchor) return;

    const container = scrollRef.current;
    if (!container) return;

    let frameOne = 0;
    let frameTwo = 0;
    let frameThree = 0;
    const transitionMeta = pendingModeTransitionRef.current;
    isRestoringRef.current = true;

    frameOne = window.requestAnimationFrame(() => {
      if (transitionMeta && transitionMeta.fromMode !== "vertical" && settings.readingMode !== "vertical") {
        setOffset(0);
        frameTwo = window.requestAnimationFrame(() => {
          const viewportWidth = getPagedViewportWidth() ?? 1;
          let targetPage = transitionMeta.fromPage;

          if (transitionMeta.fromMode === "single" && settings.readingMode === "double") {
            targetPage = Math.max(1, 2 * Math.floor((transitionMeta.fromPage - 1) / 2) + 1);
          } else if (transitionMeta.fromMode === "double" && settings.readingMode === "single") {
            targetPage = Math.max(1, transitionMeta.fromPage);
          }

          const screenIndex =
            settings.readingMode === "double" ? Math.floor((targetPage - 1) / 2) : Math.max(0, targetPage - 1);
          const targetX = Math.max(0, screenIndex * viewportWidth);

          setOffset(targetX);
          frameThree = window.requestAnimationFrame(() => {
            updateVirtualPage(targetX);
            applyParagraphHighlight(pendingHighlightParagraphRef.current);
            pendingModeTransitionRef.current = null;
            pendingHighlightParagraphRef.current = null;
            isRestoringRef.current = false;
            setRestoreAnchor(null);
          });
        });
        return;
      }

      if (settings.readingMode === "vertical") {
        setOffset(0);
        container.scrollTop = 0;

        frameTwo = window.requestAnimationFrame(() => {
          const resolved = resolveAnchorRange(restoreAnchor);
          if (resolved) {
            const viewportRect = getViewportRectForAnchor(container, "vertical", pagedViewportRef.current);
            const relativeY =
              restoreAnchor.kind === "txt_anchor_v2" && "relativeY" in restoreAnchor
                ? (restoreAnchor.relativeY ?? 0)
                : 0;
            const desiredTop = viewportRect.top + relativeY;
            const deltaY = resolved.rect.top - desiredTop;
            const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
            container.scrollTop = clamp(container.scrollTop + deltaY, 0, maxScroll);
            applyParagraphHighlight(pendingHighlightParagraphRef.current ?? resolved.paragraphId);
          }

          pendingHighlightParagraphRef.current = null;
          pendingModeTransitionRef.current = null;
          isRestoringRef.current = false;
          frameThree = window.requestAnimationFrame(() => {
            updateVirtualPage();
            loaderData.setViewStatus?.("ready");
            setSettledRestoreChapterId(chapterId);
          });
          setRestoreAnchor(null);
        });
        return;
      }

      setOffset(0);
      frameTwo = window.requestAnimationFrame(() => {
        const resolved = resolveAnchorRange(restoreAnchor);
        const nextViewportWidth = getPagedViewportWidth() ?? 1;
        const metrics = measureVirtualPaging(
          container,
          settings.readingMode,
          0,
          getContentScrollWidth(),
          nextViewportWidth,
        );
        const absoluteOffset = getAbsoluteOffsetFromAnchor(restoreAnchor);
        const estimatedPageFromOffset =
          absoluteOffset !== null && text.length > 1 && metrics.totalPages > 1
            ? clamp(
                Math.round(clamp(absoluteOffset / Math.max(1, text.length - 1), 0, 1) * (metrics.totalPages - 1)) + 1,
                1,
                metrics.totalPages,
              )
            : 1;

        if (resolved) {
          if (textBodyRef.current) {
            const maxOffset = Math.max(0, textBodyRef.current.scrollWidth - nextViewportWidth);
            const articleRect = textBodyRef.current.getBoundingClientRect();
            const screenIndex = Math.max(0, Math.floor((resolved.rect.left - articleRect.left) / nextViewportWidth));
            let restoredPage = settings.readingMode === "double" ? screenIndex * 2 + 1 : screenIndex + 1;
            if (transitionMeta?.fromMode === "vertical" && restoredPage === 1) {
              restoredPage = estimatedPageFromOffset;
            }
            let targetX =
              settings.readingMode === "double"
                ? Math.floor((restoredPage - 1) / 2) * nextViewportWidth
                : Math.max(0, restoredPage - 1) * nextViewportWidth;
            targetX = clamp(targetX, 0, maxOffset);
            if (transitionMeta?.fromMode === "vertical") {
              lastRestoredPagedPageRef.current = restoredPage;
            }
            setOffset(targetX);
            setCurrentPage(restoredPage);
            frameThree = window.requestAnimationFrame(() => {
              updateVirtualPage(targetX);
              isRestoringRef.current = false;
              loaderData.setViewStatus?.("ready");
              setSettledRestoreChapterId(chapterId);
            });
          }
          applyParagraphHighlight(pendingHighlightParagraphRef.current ?? resolved.paragraphId);
        } else if (transitionMeta?.fromMode === "vertical" && estimatedPageFromOffset > 1) {
          lastRestoredPagedPageRef.current = estimatedPageFromOffset;
          setCurrentPage(estimatedPageFromOffset);
          isRestoringRef.current = false;
          loaderData.setViewStatus?.("ready");
          setSettledRestoreChapterId(chapterId);
        } else {
          isRestoringRef.current = false;
          loaderData.setViewStatus?.("ready");
          setSettledRestoreChapterId(chapterId);
        }

        pendingHighlightParagraphRef.current = null;
        pendingModeTransitionRef.current = null;
        setRestoreAnchor(null);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
      window.cancelAnimationFrame(frameThree);
    };
  }, [
    applyParagraphHighlight,
    getContentScrollWidth,
    getPagedViewportWidth,
    resolveAnchorRange,
    restoreAnchor,
    setCurrentPage,
    setOffset,
    settings.readingMode,
    chapterId,
    text.length,
    loaderData,
    updateVirtualPage,
  ]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      updateVirtualPage();
      scheduleSave();
    };

    container.addEventListener("scroll", onScroll, { passive: settings.readingMode === "vertical" });

    const onWheel = (event: WheelEvent) => {
      if (settings.readingMode === "vertical") return;
      event.preventDefault();
      if (event.deltaY === 0) return;
      const moveNextByWheel = settings.wheelDirection === "down" ? event.deltaY > 0 : event.deltaY < 0;
      if (moveNextByWheel) {
        handleNext();
      } else {
        handlePrev();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (settings.readingMode === "vertical") return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const moveNextByKeyboard =
        settings.keyboardDirection === "ltr" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
      if (moveNextByKeyboard) {
        handleNext();
      } else {
        handlePrev();
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    handleNext,
    handlePrev,
    scheduleSave,
    settings.keyboardDirection,
    settings.readingMode,
    settings.wheelDirection,
    updateVirtualPage,
  ]);

  // 세로 모드가 아닐 때 pullOffset 관련 상태 초기화
  useEffect(() => {
    if (settings.readingMode !== "vertical") {
      setPullOffset(0);
      pullOffsetRef.current = 0;
      isNavigatingRef.current = false;
      startYRef.current = null;
      lastYRef.current = null;
    }
  }, [settings.readingMode]);

  // 세로 모드 오버스크롤 감지 (당기기 네비게이션)
  useEffect(() => {
    if (settings.readingMode !== "vertical") return;

    const container = scrollRef.current;
    if (!container) return;

    const pullThreshold = settings.pullThreshold;
    const sensitivity = Math.min(1, Math.max(0.1, settings.pullSensitivity ?? 1));

    const handleWheel = (e: WheelEvent) => {
      if (isNavigatingRef.current) return;

      const isAtTop = container.scrollTop <= 0;
      const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;

      if (isAtTop && e.deltaY < 0 && prevChapterId && isAdjacentResolved) {
        e.preventDefault();
        const delta = -e.deltaY * sensitivity;
        const newOffset = Math.max(0, (pullOffsetRef.current ?? 0) + delta);
        const shouldNavigate = !isNavigatingRef.current && newOffset >= pullThreshold;

        if (shouldNavigate) {
          pullOffsetRef.current = 0;
          setPullOffset(0);
        } else {
          pullOffsetRef.current = newOffset;
          setPullOffset(newOffset);
        }

        if (shouldNavigate) {
          isNavigatingRef.current = true;
          saveProgress()
            .catch((err) => console.warn("Failed to save progress", err))
            .finally(() => {
              isNavigatingRef.current = false;
              startChapterSwitching(isDocumentFullscreen());
              navigate(`/viewer/${prevChapterId}?page=last`, {
                replace: true,
                state: buildViewerRouteState({
                  from: viewerFrom,
                  isIncognito: routeIsIncognito,
                  preventComplete: true,
                }),
              });
            });
        }
      } else if (isAtBottom && e.deltaY > 0 && nextChapterId && isAdjacentResolved) {
        e.preventDefault();
        const delta = -e.deltaY * sensitivity;
        const newOffset = Math.min(0, (pullOffsetRef.current ?? 0) + delta);
        const shouldNavigate = !isNavigatingRef.current && Math.abs(newOffset) >= pullThreshold;

        if (shouldNavigate) {
          pullOffsetRef.current = 0;
          setPullOffset(0);
        } else {
          pullOffsetRef.current = newOffset;
          setPullOffset(newOffset);
        }

        if (shouldNavigate) {
          isNavigatingRef.current = true;
          saveProgress()
            .catch((err) => console.warn("Failed to save progress", err))
            .finally(() => {
              isNavigatingRef.current = false;
              startChapterSwitching(isDocumentFullscreen());
              navigate(`/viewer/${nextChapterId}`, {
                replace: true,
                state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
              });
            });
        }
      } else if (pullOffsetRef.current !== 0) {
        pullOffsetRef.current = 0;
        setPullOffset(0);
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isNavigatingRef.current) return;
      startYRef.current = e.touches[0].clientY;
      lastYRef.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isNavigatingRef.current || startYRef.current === null) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - (lastYRef.current ?? currentY);
      lastYRef.current = currentY;

      const isAtTop = container.scrollTop <= 0;
      const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;

      if ((isAtTop && diff > 0 && prevChapterId && isAdjacentResolved) || pullOffsetRef.current > 0) {
        const maxPull = 180;
        const resistance = sensitivity * (1 - Math.abs(pullOffsetRef.current) / (maxPull * 2));
        const newOffset = Math.max(0, Math.min(pullOffsetRef.current + diff * resistance, maxPull));
        pullOffsetRef.current = newOffset;
        setPullOffset(newOffset);
        if (container.scrollTop <= 0 && newOffset > 0) e.preventDefault();
      } else if ((isAtBottom && diff < 0 && nextChapterId && isAdjacentResolved) || pullOffsetRef.current < 0) {
        const maxPull = 180;
        const resistance = sensitivity * (1 - Math.abs(pullOffsetRef.current) / (maxPull * 2));
        const newOffset = Math.min(0, Math.max(pullOffsetRef.current + diff * resistance, -maxPull));
        pullOffsetRef.current = newOffset;
        setPullOffset(newOffset);
        if (isAtBottom && newOffset < 0) e.preventDefault();
      } else if (pullOffsetRef.current !== 0) {
        pullOffsetRef.current = 0;
        setPullOffset(0);
      }
    };

    const handleTouchEnd = () => {
      if (isNavigatingRef.current) return;

      const currentOffset = pullOffsetRef.current;

      if (currentOffset >= pullThreshold && prevChapterId && isAdjacentResolved) {
        isNavigatingRef.current = true;
        saveProgress()
          .catch((err) => console.warn("Failed to save progress", err))
          .finally(() => {
            isNavigatingRef.current = false;
            startChapterSwitching(isDocumentFullscreen());
            navigate(`/viewer/${prevChapterId}?page=last`, {
              replace: true,
              state: buildViewerRouteState({
                from: viewerFrom,
                isIncognito: routeIsIncognito,
                preventComplete: true,
              }),
            });
          });
      } else if (currentOffset <= -pullThreshold && nextChapterId && isAdjacentResolved) {
        isNavigatingRef.current = true;
        saveProgress()
          .catch((err) => console.warn("Failed to save progress", err))
          .finally(() => {
            isNavigatingRef.current = false;
            startChapterSwitching(isDocumentFullscreen());
            navigate(`/viewer/${nextChapterId}`, {
              replace: true,
              state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
            });
          });
      }

      setPullOffset(0);
      pullOffsetRef.current = 0;
      startYRef.current = null;
      lastYRef.current = null;
    };

    // 감쇠 애니메이션
    let rafId: number | null = null;
    const runDecay = () => {
      if (startYRef.current !== null) {
        rafId = requestAnimationFrame(runDecay);
        return;
      }
      const current = pullOffsetRef.current;
      if (Math.abs(current) < 1) {
        pullOffsetRef.current = 0;
        setPullOffset(0);
        rafId = null;
        return;
      }
      const newVal = current * 0.8;
      pullOffsetRef.current = newVal;
      setPullOffset(newVal);
      rafId = requestAnimationFrame(runDecay);
    };

    const startDecay = () => {
      if (rafId === null && pullOffsetRef.current !== 0) {
        rafId = requestAnimationFrame(runDecay);
      }
    };

    const onWheel = (e: WheelEvent) => {
      handleWheel(e);
      startDecay();
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("touchend", startDecay, { passive: true });
    container.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    container.addEventListener("touchcancel", startDecay, { passive: true });

    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchend", startDecay);
      container.removeEventListener("touchcancel", handleTouchEnd);
      container.removeEventListener("touchcancel", startDecay);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [
    isAdjacentResolved,
    navigate,
    nextChapterId,
    prevChapterId,
    saveProgress,
    settings.pullSensitivity,
    settings.pullThreshold,
    settings.readingMode,
    viewerFrom,
    routeIsIncognito,
  ]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !text) return;

    let rafId: number | null = window.requestAnimationFrame(() => updateVirtualPage());

    const onResize = () => {
      if (container.clientWidth > 0) {
        setViewportWidth(getPagedViewportWidth() ?? container.clientWidth);
      }
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => updateVirtualPage());
    };

    window.addEventListener("resize", onResize);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(onResize);
      observer.observe(container);
      const textBody = textBodyRef.current;
      if (textBody) observer.observe(textBody);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [getPagedViewportWidth, text, updateVirtualPage]);

  useEffect(() => {
    if (isUIVisible) {
      uiShownTimeRef.current = Date.now();
      resetUITimer();
    } else if (uiTimerRef.current) {
      window.clearTimeout(uiTimerRef.current);
      uiTimerRef.current = null;
    }

    return () => {
      if (uiTimerRef.current) {
        window.clearTimeout(uiTimerRef.current);
      }
    };
  }, [currentPage, isUIVisible, resetUITimer]);

  useEffect(() => {
    return () => {
      flushProgressKeepalive();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current);
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    };
  }, [flushProgressKeepalive]);

  useEffect(() => {
    const handleBeforeUnload = () => flushProgressKeepalive();
    const handlePageHide = () => flushProgressKeepalive();

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushProgressKeepalive]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isActuallyFullscreen = isDocumentFullscreen();
      if (isFullscreen !== isActuallyFullscreen) {
        setFullscreen(isActuallyFullscreen);
      }
    };

    const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
    events.forEach((event) => document.addEventListener(event, handleFullscreenChange));

    return () => {
      events.forEach((event) => document.removeEventListener(event, handleFullscreenChange));
    };
  }, [isFullscreen, setFullscreen]);

  useRestoreFullscreenAfterChapterSwitch(routeChapterId);
  useExitFullscreenOnViewerUnmount();

  if (!chapter || chapterLoading || isLoadingText) {
    return (
      <div className={viewerStyles.viewerContainer}>
        <LoadingSpinner
          fullScreen
          text={null}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className={viewerStyles.viewerContainer}>
        <div className={viewerStyles.viewerContent}>
          <div style={{ color: "white", textAlign: "center" }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${viewerStyles.viewerContainer} ${styles.textViewerRoot}`}
      style={{
        background: settings.backgroundColor,
        color: resolveTextColorFromBackground(settings.backgroundColor),
      }}
    >
      <div className={styles.fixedUiLayer}>
        <ViewerHeader
          state={{
            title: chapter.title,
            currentPage,
            totalPages: Math.max(1, totalPages),
            isUIVisible,
            isIncognito: effectiveIncognito,
            isFullscreen,
            bgmInfo: null,
            isBgmPlaying: false,
          }}
          actions={{
            onBack: handleBack,
            onToggleFullscreen: handleToggleFullscreen,
            onToggleSettings: toggleSettings,
            onToggleBgm: () => {},
          }}
          onInteractionStart={handleInteractionStart}
          onInteractionEnd={handleInteractionEnd}
        />

        <ViewerFooter
          currentPage={currentPage}
          totalPages={Math.max(1, totalPages)}
          isUIVisible={isUIVisible}
          readingMode={settings.readingMode}
          pageOffset={settings.pageOffset}
          nextChapterId={nextChapterId || null}
          onPrev={handlePrev}
          onNext={handleNext}
          onGoToPage={goToPage}
          onPageJumpClick={() => setShowPageJump(true)}
          onReadingModeChange={handleReadingModeChange}
          onTogglePageOffset={togglePageOffset}
          onInteractionStart={handleInteractionStart}
          onInteractionEnd={handleInteractionEnd}
        />
      </div>

      <div
        className={`${viewerStyles.viewerContent} ${styles.textViewerContent}`}
        onClick={handleContentTap}
      >
        {settings.readingMode === "vertical" && (
          <>
            <PullIndicator
              type="prev"
              pullOffset={pullOffset}
              pullThreshold={settings.pullThreshold}
              chapterId={prevChapterId}
              chapterTitle={prevChapterTitle}
              saveProgress={saveProgress}
            />
            <PullIndicator
              type="next"
              pullOffset={pullOffset}
              pullThreshold={settings.pullThreshold}
              chapterId={nextChapterId}
              chapterTitle={nextChapterTitle}
              saveProgress={saveProgress}
            />
          </>
        )}

        <div
          ref={scrollRef}
          className={`${styles.textScrollContainer} ${settings.readingMode !== "vertical" ? styles.pagedScrollContainer : ""} ${settings.readingMode === "single" ? styles.singlePagedScrollContainer : ""}`}
          style={
            settings.readingMode === "vertical"
              ? {
                  transform: `translateY(${pullOffset * 0.3}px)`,
                  transition: pullOffset === 0 ? "transform 0.4s cubic-bezier(0.2, 0, 0.2, 1)" : "none",
                }
              : undefined
          }
        >
          <div
            ref={settings.readingMode !== "vertical" ? pagedViewportRef : undefined}
            className={`${settings.readingMode !== "vertical" ? styles.pagedViewportMask : styles.textViewportMask} ${settings.readingMode === "single" ? styles.singlePagedViewportMask : ""}`}
          >
            <article
              ref={textBodyRef}
              className={`${styles.textBody} ${settings.readingMode !== "vertical" ? styles.pagedMode : ""} ${settings.readingMode === "single" ? styles.singleMode : settings.readingMode === "double" ? styles.doubleMode : ""}`}
              style={
                {
                  fontSize: `${(settings.fontSize / 100) * 20}px`,
                  lineHeight: settings.lineHeight,
                  fontFamily: resolveTextFontFamily(settings.fontFamily),
                  ...(settings.readingMode !== "vertical"
                    ? {
                        transform: `translateX(-${currentOffsetX}px)`,
                        "--viewport-width": `${viewportWidth}px`,
                      }
                    : {}),
                } as React.CSSProperties
              }
            >
              {renderedParagraphs}
            </article>
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <ViewerSettingsModal
          onClose={closeSettings}
          onReadingModeChange={handleReadingModeChange}
          showTextTypographyOption
        />
      )}

      <PageJumpModal
        show={showPageJump}
        totalPages={Math.max(1, totalPages)}
        onClose={() => setShowPageJump(false)}
        onJump={goToPage}
      />

      <ChapterNavHint
        type="next"
        title={nextChapterTitle || t("viewer.guide.no_title")}
        show={showNextHint && !!nextChapterId}
      />
      <ChapterNavHint
        type="prev"
        title={prevChapterTitle || t("viewer.guide.no_title")}
        show={showPrevHint && !!prevChapterId}
      />

      <SyncConfirmModal
        show={showSyncModal}
        serverProgress={serverProgress}
        onConfirm={handleConfirmSync}
        onClose={handleCloseModal}
      />

      <AlertModal
        isOpen={terminatedInfo.isOpen}
        title={t("viewer.alert.session_terminated")}
        message={terminatedInfo.reason}
        onConfirm={handleTerminatedConfirm}
      />
    </div>
  );
}

export function TextViewerRoute(props: TextViewerRouteProps) {
  return (
    <ErrorBoundary>
      <TextViewerRouteInner {...props} />
    </ErrorBoundary>
  );
}

export default TextViewerRoute;
