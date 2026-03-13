// 세로 스크롤 모드 전용 훅

import { useEffect, useState, useRef } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewerStore } from "../../../stores/viewerStore";
import { isFullscreen as isDocumentFullscreen } from "../../../utils/fullscreen";
import { startChapterSwitching } from "../../../stores/fullscreenSwitchStore";
import type { ReadingMode } from "../../../stores/viewerStore";
import type { RestorePosition, ViewStatus } from "../types";
import { getViewportAnchorPage } from "../utils/progressPosition";

interface UseVerticalScrollParams {
  readingMode: ReadingMode;
  isLoading: boolean;
  currentPage: number;
  totalPages: number;
  nextChapterId: string | null;
  prevChapterId: string | null;
  pullThreshold: number;
  pullSensitivity: number;
  saveProgress: () => Promise<void>;
  handleVolumeCompletion: () => Promise<void>;
  chapterId: string | undefined;
  isInitialScrollingRef: MutableRefObject<boolean>;
  restorePosition?: RestorePosition;
  viewStatus?: ViewStatus;
  setViewStatus?: Dispatch<SetStateAction<ViewStatus>>;
  targetScrollTop?: number;
  canUsePreciseRestore?: boolean;
  viewerContentRef?: RefObject<HTMLDivElement | null>;
  imageLoading?: Record<number, boolean>;
}

interface UseVerticalScrollReturn {
  pullOffset: number;
  viewerContentRef: RefObject<HTMLDivElement | null>;
  isInternalScrollRef: RefObject<boolean>;
  startYRef: RefObject<number | null>;
  isTouching: boolean;
}

const RESTORE_TOLERANCE = 4;
const READY_STABILIZE_DELAY = 250;
const MAX_RESTORE_ATTEMPTS = 12;

export function useVerticalScroll({
  readingMode,
  isLoading,
  currentPage,
  totalPages,
  nextChapterId,
  prevChapterId,
  pullThreshold,
  pullSensitivity,
  saveProgress,
  handleVolumeCompletion,
  chapterId,
  isInitialScrollingRef,
  restorePosition,
  viewStatus,
  setViewStatus = () => undefined,
  viewerContentRef,
  imageLoading = {},
}: UseVerticalScrollParams): UseVerticalScrollReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const { setCurrentPage } = useViewerStore();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;

  const [pullOffset, setPullOffset] = useState(0);
  const [isTouching, setIsTouching] = useState(false);
  const effectiveRestorePosition = restorePosition ?? {
    currentPage,
    anchorPage: currentPage,
    offsetRatio: 0,
  };
  const effectiveViewStatus = viewStatus ?? (readingMode === "vertical" ? "hydrating" : "ready");
  const pullOffsetRef = useRef(0);
  const isNavigatingRef = useRef(false);
  const internalViewerContentRef = useRef<HTMLDivElement>(null);
  const resolvedViewerContentRef = viewerContentRef ?? internalViewerContentRef;
  const startYRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const isInternalScrollRef = useRef(false);
  const readyAtRef = useRef(0);

  useEffect(() => {
    if (readingMode === "vertical" || isLoading) return;
    isInitialScrollingRef.current = false;
    setViewStatus("ready");
  }, [isLoading, isInitialScrollingRef, readingMode, setViewStatus]);

  useEffect(() => {
    if (readingMode !== "vertical" || isLoading) return;
    if (effectiveViewStatus !== "hydrating" && effectiveViewStatus !== "restoring") return;

    const content = resolvedViewerContentRef.current;
    if (!content) return;

    let frameId = 0;
    let retryId = 0;
    let attempts = 0;
    let cancelled = false;

    isInitialScrollingRef.current = true;
    setCurrentPage(effectiveRestorePosition.anchorPage);

    const restoreScroll = () => {
      if (cancelled) return;

      const targetPageEl = document.getElementById(`page-${effectiveRestorePosition.anchorPage}`);
      if (targetPageEl) {
        targetPageEl.scrollIntoView({ block: "start" });
      }

      const isPageAligned =
        !!targetPageEl &&
        typeof targetPageEl.getBoundingClientRect === "function" &&
        typeof content.getBoundingClientRect === "function" &&
        Math.abs(targetPageEl.getBoundingClientRect().top - content.getBoundingClientRect().top) <= 20;
      const isFallbackAligned =
        isPageAligned || (effectiveRestorePosition.anchorPage === 1 && content.scrollTop <= RESTORE_TOLERANCE);
      const isAnchorImageReady = imageLoading[effectiveRestorePosition.anchorPage] === false;
      const isTargetPageVisible =
        getViewportAnchorPage(content, totalPages, effectiveRestorePosition.anchorPage) === effectiveRestorePosition.anchorPage;
      const isReady =
        content.scrollHeight > 0 &&
        isAnchorImageReady &&
        isTargetPageVisible &&
        isFallbackAligned;

      if (isReady) {
        readyAtRef.current = Date.now();
        setViewStatus("ready");
        isInitialScrollingRef.current = false;
        return;
      }

      if (attempts >= MAX_RESTORE_ATTEMPTS) {
        if (targetPageEl && isAnchorImageReady) {
          targetPageEl.scrollIntoView({ block: "start" });

          retryId = window.setTimeout(() => {
            if (cancelled) return;
            readyAtRef.current = Date.now();
            setCurrentPage(effectiveRestorePosition.anchorPage);
            setViewStatus("ready");
            isInitialScrollingRef.current = false;
          }, 80);
        }
        return;
      }

      attempts += 1;
      retryId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(restoreScroll);
      }, 120);
    };

    frameId = window.requestAnimationFrame(restoreScroll);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(retryId);
    };
  }, [
    isInitialScrollingRef,
    isLoading,
    readingMode,
    currentPage,
    effectiveRestorePosition.anchorPage,
    resolvedViewerContentRef,
    setCurrentPage,
    setViewStatus,
    effectiveViewStatus,
    totalPages,
    imageLoading,
  ]);

  useEffect(() => {
    if (readingMode !== "vertical") return;
    if (isLoading || effectiveViewStatus !== "ready") return;

    const content = resolvedViewerContentRef.current;
    if (!content) return;

    const syncCurrentPage = () => {
      if (isInitialScrollingRef.current) return;
      if (Date.now() - readyAtRef.current < READY_STABILIZE_DELAY) return;
      const nextPage = getViewportAnchorPage(content, totalPages, currentPage);
      if (nextPage !== currentPage) {
        isInternalScrollRef.current = true;
        setCurrentPage(nextPage);
      }
    };

    syncCurrentPage();
    content.addEventListener("scroll", syncCurrentPage, { passive: true });

    return () => {
      content.removeEventListener("scroll", syncCurrentPage);
      isInternalScrollRef.current = false;
    };
  }, [
    currentPage,
    effectiveViewStatus,
    isLoading,
    isInitialScrollingRef,
    readingMode,
    resolvedViewerContentRef,
    setCurrentPage,
    totalPages,
  ]);

  useEffect(() => {
    if (readingMode !== "vertical" || isLoading || effectiveViewStatus !== "ready") return;

    const content = resolvedViewerContentRef.current;
    if (!content) return;

    let handleWheel = (e: WheelEvent) => {
      if (isNavigatingRef.current) return;

      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      if (isAtTop && e.deltaY < 0 && prevChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.max(0, prev - e.deltaY * pullSensitivity);
          pullOffsetRef.current = newOffset;
          if (newOffset >= pullThreshold) {
            isNavigatingRef.current = true;
            saveProgress().then(() => {
              startChapterSwitching(isDocumentFullscreen());
              navigate(`/viewer/${prevChapterId}`, {
                replace: true,
                state: {
                  preventComplete: true,
                  ...(viewerFrom ? { from: viewerFrom } : {}),
                },
              });
            });
            return 0;
          }
          return newOffset;
        });
      } else if (isAtBottom && e.deltaY > 0 && nextChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.min(0, prev - e.deltaY * pullSensitivity);
          pullOffsetRef.current = newOffset;
          if (Math.abs(newOffset) >= pullThreshold) {
            isNavigatingRef.current = true;
            handleVolumeCompletion()
              .then(() => saveProgress())
              .then(() => {
                startChapterSwitching(isDocumentFullscreen());
                navigate(`/viewer/${nextChapterId}`, {
                  replace: true,
                  state: viewerFrom ? { from: viewerFrom } : undefined,
                });
              });
            return 0;
          }
          return newOffset;
        });
      } else {
        setPullOffset((current) => {
          if (current !== 0) {
            pullOffsetRef.current = 0;
            return 0;
          }
          return current;
        });
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isNavigatingRef.current) return;
      startYRef.current = e.touches[0].clientY;
      lastYRef.current = e.touches[0].clientY;
      setIsTouching(true);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isNavigatingRef.current || startYRef.current === null) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - (lastYRef.current ?? currentY);
      lastYRef.current = currentY;

      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      if ((isAtTop && diff > 0 && prevChapterId) || pullOffsetRef.current > 0) {
        setPullOffset((prev) => {
          const maxPull = 180;
          const safeSensitivity = Math.max(0.1, Math.min(pullSensitivity, 1.0));
          const resistance = safeSensitivity * (1 - Math.abs(prev) / (maxPull * 2));
          const newOffset = Math.max(0, Math.min(prev + diff * resistance, maxPull));
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
        if (content.scrollTop <= 0 && pullOffsetRef.current > 0) e.preventDefault();
      } else if ((isAtBottom && diff < 0 && nextChapterId) || pullOffsetRef.current < 0) {
        setPullOffset((prev) => {
          const maxPull = 180;
          const resistance = pullSensitivity * (1 - Math.abs(prev) / (maxPull * 2));
          const newOffset = Math.min(0, Math.max(prev + diff * resistance, -maxPull));
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
        if (isAtBottom && pullOffsetRef.current < 0) e.preventDefault();
      } else {
        setPullOffset((current) => {
          if (current !== 0) {
            pullOffsetRef.current = 0;
            return 0;
          }
          return current;
        });
      }
    };

    const handleTouchEnd = () => {
      if (isNavigatingRef.current) return;

      const currentOffset = pullOffsetRef.current;

      if (currentOffset >= pullThreshold && prevChapterId) {
        isNavigatingRef.current = true;
        saveProgress().then(() => {
          startChapterSwitching(isDocumentFullscreen());
          navigate(`/viewer/${prevChapterId}`, {
            replace: true,
            state: {
              preventComplete: true,
              ...(viewerFrom ? { from: viewerFrom } : {}),
            },
          });
        });
      } else if (currentOffset <= -pullThreshold && nextChapterId) {
        isNavigatingRef.current = true;
        handleVolumeCompletion()
          .then(() => saveProgress())
          .then(() => {
            startChapterSwitching(isDocumentFullscreen());
            navigate(`/viewer/${nextChapterId}`, {
              replace: true,
              state: viewerFrom ? { from: viewerFrom } : undefined,
            });
          });
      }

      setPullOffset(0);
      pullOffsetRef.current = 0;
      startYRef.current = null;
      lastYRef.current = null;
      setIsTouching(false);
    };

    let rafId: number | null = null;
    const runDecay = () => {
      if (startYRef.current !== null) {
        rafId = requestAnimationFrame(runDecay);
        return;
      }

      setPullOffset((prev) => {
        if (Math.abs(prev) < 1) {
          pullOffsetRef.current = 0;
          rafId = null;
          return 0;
        }
        const newVal = prev * 0.8;
        pullOffsetRef.current = newVal;
        rafId = requestAnimationFrame(runDecay);
        return newVal;
      });
    };

    const startDecay = () => {
      if (rafId === null && pullOffsetRef.current !== 0) {
        rafId = requestAnimationFrame(runDecay);
      }
    };

    const originalHandleWheel = handleWheel;
    handleWheel = (e: WheelEvent) => {
      originalHandleWheel(e);
      startDecay();
    };

    content.addEventListener("wheel", handleWheel, { passive: false });
    content.addEventListener("touchstart", handleTouchStart, { passive: true });
    content.addEventListener("touchmove", handleTouchMove, { passive: false });
    content.addEventListener("touchend", handleTouchEnd, { passive: true });
    content.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      content.removeEventListener("wheel", handleWheel);
      content.removeEventListener("touchstart", handleTouchStart);
      content.removeEventListener("touchmove", handleTouchMove);
      content.removeEventListener("touchend", handleTouchEnd);
      content.removeEventListener("touchcancel", handleTouchEnd);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      isNavigatingRef.current = false;
    };
  }, [
    handleVolumeCompletion,
    isLoading,
    navigate,
    nextChapterId,
    prevChapterId,
    pullSensitivity,
    pullThreshold,
    readingMode,
    resolvedViewerContentRef,
    saveProgress,
    viewerFrom,
    effectiveViewStatus,
  ]);

  useEffect(() => {
    pullOffsetRef.current = 0;
    isNavigatingRef.current = false;
    isInternalScrollRef.current = false;
    if (readingMode === "vertical") {
      isInitialScrollingRef.current = true;
    }
    queueMicrotask(() => {
      setPullOffset(0);
    });
  }, [chapterId, isInitialScrollingRef, readingMode]);

  return {
    pullOffset,
    viewerContentRef: resolvedViewerContentRef,
    isInternalScrollRef,
    startYRef,
    isTouching,
  };
}
