// 세로 스크롤 모드 전용 훅

import { useCallback, useEffect, useState, useRef } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewerStore } from "../../../stores/viewerStore";
import { isFullscreen as isDocumentFullscreen } from "../../../utils/fullscreen";
import { startChapterSwitching } from "../../../stores/fullscreenSwitchStore";
import { buildViewerRouteState } from "../../../utils/viewerRouteState";
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
  viewerContentRef?: RefObject<HTMLDivElement | null>;
  imageLoading?: Record<number, boolean>;
}

interface UseVerticalScrollReturn {
  pullOffset: number;
  viewerContentRef: RefObject<HTMLDivElement | null>;
  isTouching: boolean;
}

const RESTORE_TOLERANCE = 4;
const READY_STABILIZE_DELAY = 250;
const MAX_RESTORE_ATTEMPTS = 40;
const WHEEL_COOLDOWN = 150; // ms

// 민감도별 100% 도달에 필요한 휠 클릭 횟수 (이후 1회 더 클릭하면 이동)
// sensitivity 임계값은 ViewerTab.tsx의 PULL_PRESETS와 대응:
//   high(1.2) -> 1클릭, medium(1.0) -> 2클릭, low(0.8) -> 4클릭
const SENSITIVITY_THRESHOLDS = [
  { minSensitivity: 1.1, clicks: 1 }, // high: 총 2회
  { minSensitivity: 0.9, clicks: 2 }, // medium: 총 3회
] as const;
const DEFAULT_WHEEL_CLICKS = 4; // low: 총 5회

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
  const routeIsIncognito = location.state?.isIncognito === true;

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
  const rafIdRef = useRef<number | null>(null);
  const internalViewerContentRef = useRef<HTMLDivElement>(null);
  const resolvedViewerContentRef = viewerContentRef ?? internalViewerContentRef;
  const startYRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const isInternalScrollRef = useRef(false);
  const readyAtRef = useRef(0);
  const currentPageRef = useRef(currentPage);
  const imageLoadingRef = useRef(imageLoading);
  const lastWheelTimeRef = useRef(0);
  const safePullThreshold = Number.isFinite(pullThreshold) && pullThreshold > 0 ? pullThreshold : null;
  const safePullSensitivity = Number.isFinite(pullSensitivity) ? Math.max(0.1, Math.min(pullSensitivity, 1.2)) : 1.0;

  // 현재 페이지 상태를 Ref에 동기화 (스크롤 이벤트 핸들러에서 최신 값을 참조하기 위함)
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // imageLoading을 Ref에 동기화 (스크롤 복원 effect가 imageLoading 변경으로 재시작되지 않도록)
  useEffect(() => {
    imageLoadingRef.current = imageLoading;
  }, [imageLoading]);

  const navigateToChapter = useCallback(
    (chapterIdToMove: string, options: { preventComplete?: boolean } = {}): Promise<void> => {
      return (options.preventComplete ? saveProgress() : handleVolumeCompletion().then(() => saveProgress()))
        .then(() => {
          startChapterSwitching(isDocumentFullscreen());
          navigate(`/viewer/${chapterIdToMove}`, {
            replace: true,
            state: buildViewerRouteState({
              from: viewerFrom,
              isIncognito: routeIsIncognito,
              preventComplete: options.preventComplete,
            }),
          });
        })
        .catch((error) => {
          console.error("[useVerticalScroll] chapter navigation failed:", error);
          isNavigatingRef.current = false;
        });
    },
    [handleVolumeCompletion, navigate, saveProgress, viewerFrom, routeIsIncognito],
  );

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

    const isLastPage = effectiveRestorePosition.anchorPage >= totalPages;

    const restoreScroll = () => {
      if (cancelled) return;

      const targetPageEl = document.getElementById(`page-${effectiveRestorePosition.anchorPage}`);
      if (isLastPage) {
        // 마지막 페이지: 스크롤을 맨 아래로
        content.scrollTop = content.scrollHeight - content.clientHeight;
      } else if (targetPageEl) {
        targetPageEl.scrollIntoView({ block: "start" });
      }

      const isPageAligned = isLastPage
        ? content.scrollTop >= content.scrollHeight - content.clientHeight - RESTORE_TOLERANCE
        : !!targetPageEl &&
          typeof targetPageEl.getBoundingClientRect === "function" &&
          typeof content.getBoundingClientRect === "function" &&
          Math.abs(targetPageEl.getBoundingClientRect().top - content.getBoundingClientRect().top) <= 20;
      const isFallbackAligned =
        isPageAligned || (effectiveRestorePosition.anchorPage === 1 && content.scrollTop <= RESTORE_TOLERANCE);
      const isAnchorImageReady = imageLoadingRef.current[effectiveRestorePosition.anchorPage] === false;

      const isTargetPageVisible =
        getViewportAnchorPage(content, totalPages, effectiveRestorePosition.anchorPage) ===
        effectiveRestorePosition.anchorPage;
      const isReady = content.scrollHeight > 0 && isAnchorImageReady && isTargetPageVisible && isFallbackAligned;

      if (isReady) {
        readyAtRef.current = Date.now();
        setViewStatus("ready");
        isInitialScrollingRef.current = false;
        return;
      }

      if (attempts >= MAX_RESTORE_ATTEMPTS) {
        if (isLastPage) {
          content.scrollTop = content.scrollHeight - content.clientHeight;
        } else if (targetPageEl && isAnchorImageReady) {
          targetPageEl.scrollIntoView({ block: "start" });
        }
        retryId = window.setTimeout(() => {
          if (cancelled) return;
          readyAtRef.current = Date.now();
          setCurrentPage(effectiveRestorePosition.anchorPage);
          setViewStatus("ready");
          isInitialScrollingRef.current = false;
        }, 80);
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
    effectiveRestorePosition.anchorPage,
    resolvedViewerContentRef,
    setCurrentPage,
    setViewStatus,
    effectiveViewStatus,
    totalPages,
  ]);

  useEffect(() => {
    if (readingMode !== "vertical") return;
    if (isLoading || effectiveViewStatus !== "ready") return;

    const content = resolvedViewerContentRef.current;
    if (!content) return;

    const syncCurrentPage = () => {
      if (isInitialScrollingRef.current) return;
      if (Date.now() - readyAtRef.current < READY_STABILIZE_DELAY) return;
      const nextPage = getViewportAnchorPage(content, totalPages, currentPageRef.current);
      if (nextPage !== currentPageRef.current) {
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
    if (safePullThreshold === null) return;

    const content = resolvedViewerContentRef.current;
    if (!content) return;
    const maxPull = 180;

    // 마우스 휠 조작 로직 (이산 단계 방식)
    // 민감도 설정에 따라 휠 횟수 제어:
    // Sensitive(1.2) -> 1번 클릭으로 100% (총 2번이면 이동)
    // Normal(1.0) -> 2번 클릭으로 100% (총 3번이면 이동)
    // Dull(0.8) -> 4번 클릭으로 100% (총 5번이면 이동)
    const handleWheel = (e: WheelEvent) => {
      if (isNavigatingRef.current) return;

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      const now = Date.now();
      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      const clicksToReach100 =
        SENSITIVITY_THRESHOLDS.find((t) => safePullSensitivity >= t.minSensitivity)?.clicks ?? DEFAULT_WHEEL_CLICKS;
      const step = safePullThreshold / clicksToReach100;
      const currentPull = pullOffsetRef.current;
      const isReverseRelease = (currentPull > 0 && e.deltaY > 0) || (currentPull < 0 && e.deltaY < 0);
      const isSnappedPull = Math.abs(currentPull) >= safePullThreshold;

      // 쿨다운 체크 (트랙패드 등에서의 과도한 이벤트 방지)
      if (now - lastWheelTimeRef.current < WHEEL_COOLDOWN && !isReverseRelease && !isSnappedPull) {
        if (isAtTop && e.deltaY < 0 && prevChapterId) e.preventDefault();
        if (isAtBottom && e.deltaY > 0 && nextChapterId) e.preventDefault();
        return;
      }

      // 1. 이미 100%에 도달해 스냅된 상태에서의 처리 (이동 또는 해제)
      if (Math.abs(currentPull) >= safePullThreshold) {
        e.preventDefault();

        if (currentPull > 0) {
          // 위로 당겨진 상태 (이전 회차)
          if (e.deltaY < 0 && prevChapterId) {
            // 같은 방향(위)
            isNavigatingRef.current = true;
            pullOffsetRef.current = 0;
            setPullOffset(0);
            void navigateToChapter(prevChapterId, { preventComplete: true });
          } else if (e.deltaY > 0) {
            // 반대 방향(아래) → 즉시 해제
            lastWheelTimeRef.current = now;
            pullOffsetRef.current = 0;
            setPullOffset(0);
          }
        } else if (currentPull < 0) {
          // 아래로 당겨진 상태 (다음 회차)
          if (e.deltaY > 0 && nextChapterId) {
            // 같은 방향(아래)
            isNavigatingRef.current = true;
            pullOffsetRef.current = 0;
            setPullOffset(0);
            void navigateToChapter(nextChapterId);
          } else if (e.deltaY < 0) {
            // 반대 방향(위) → 즉시 해제
            lastWheelTimeRef.current = now;
            pullOffsetRef.current = 0;
            setPullOffset(0);
          }
        }
        return;
      }

      // 2. 게이지를 채우는 단계 (0 -> 100%)
      if (isAtTop && e.deltaY < 0 && prevChapterId) {
        e.preventDefault();
        lastWheelTimeRef.current = now;

        setPullOffset((prev) => {
          const newOffset = Math.min(safePullThreshold, prev + step);
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
      } else if (isAtBottom && e.deltaY > 0 && nextChapterId) {
        e.preventDefault();
        lastWheelTimeRef.current = now;

        setPullOffset((prev) => {
          const newOffset = Math.max(-safePullThreshold, prev - step);
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
      } else if (currentPull !== 0) {
        // 경계가 아니더라도 이미 당겨진 상태면 반대 방향 스크롤 시 즉시 해제
        if ((currentPull > 0 && e.deltaY > 0) || (currentPull < 0 && e.deltaY < 0)) {
          e.preventDefault();
          lastWheelTimeRef.current = now;
          pullOffsetRef.current = 0;
          setPullOffset(0);
        }
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isNavigatingRef.current) return;

      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

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
          const resistance = safePullSensitivity * (1 - Math.abs(prev) / (maxPull * 2));
          const newOffset = Math.max(0, Math.min(prev + diff * resistance, maxPull));
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
        if (e.cancelable && content.scrollTop <= 0 && pullOffsetRef.current > 0) {
          e.preventDefault();
        }
      } else if ((isAtBottom && diff < 0 && nextChapterId) || pullOffsetRef.current < 0) {
        setPullOffset((prev) => {
          const resistance = safePullSensitivity * (1 - Math.abs(prev) / (maxPull * 2));
          const newOffset = Math.min(0, Math.max(prev + diff * resistance, -maxPull));
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
        if (e.cancelable && isAtBottom && pullOffsetRef.current < 0) {
          e.preventDefault();
        }
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
      startYRef.current = null;
      lastYRef.current = null;
      setIsTouching(false);

      // 이미 당겨진 상태에서 손을 뗐을 때 임계값을 넘었으면 이동
      if (Math.abs(currentOffset) >= safePullThreshold) {
        if (currentOffset > 0 && prevChapterId) {
          isNavigatingRef.current = true;
          pullOffsetRef.current = 0;
          setPullOffset(0);
          void navigateToChapter(prevChapterId, { preventComplete: true });
        } else if (currentOffset < 0 && nextChapterId) {
          isNavigatingRef.current = true;
          pullOffsetRef.current = 0;
          setPullOffset(0);
          void navigateToChapter(nextChapterId);
        }
      } else if (currentOffset !== 0) {
        // 임계값을 넘지 않았으면 점진적으로 원복 (모바일 기존 동작)
        const decay = () => {
          if (pullOffsetRef.current === 0) {
            rafIdRef.current = null;
            return;
          }
          const factor = 0.82; // 복귀 속도
          const newVal = pullOffsetRef.current * factor;
          if (Math.abs(newVal) < 1) {
            pullOffsetRef.current = 0;
            setPullOffset(0);
            rafIdRef.current = null;
          } else {
            pullOffsetRef.current = newVal;
            setPullOffset(newVal);
            rafIdRef.current = requestAnimationFrame(decay);
          }
        };
        rafIdRef.current = requestAnimationFrame(decay);
      }
    };

    // 모바일 터치에서는 decay로 자연스럽게 원복하고, 휠 입력 시에는 새 입력이 decay를 중단함

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
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      isNavigatingRef.current = false;
    };
  }, [
    handleVolumeCompletion,
    isLoading,
    navigate,
    nextChapterId,
    prevChapterId,
    readingMode,
    resolvedViewerContentRef,
    navigateToChapter,
    effectiveViewStatus,
    safePullSensitivity,
    safePullThreshold,
  ]);

  useEffect(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
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
    isTouching,
  };
}
