import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { chapterAPI, seriesAPI } from "../api/client";
import { useViewerStore } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
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
} from "../features/viewer";
import { useViewerSync } from "../hooks/useViewerSync";
import { useReadingTime } from "../hooks/useReadingTime";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { AlertModal } from "../components/modals/AlertModal";
import { API_BASE_URL } from "../features/viewer/utils/imageUrl";
import { usePreventBrowserZoom } from "../features/viewer/hooks/usePreventBrowserZoom";
import viewerStyles from "./Viewer.module.css";
import styles from "./TextViewerRoute.module.css";

interface TextViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

interface SavedTextAnchor {
  kind?: string;
  offset?: number;
  before?: string;
  after?: string;
  hash?: string;
}

const SAVE_INTERVAL = 3000;
const CONTEXT_WINDOW = 24;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const hashContext = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash >>> 0).toString(16);
};

const getAnchorContext = (text: string, offset: number) => {
  const safe = clamp(offset, 0, text.length);
  return {
    before: text.slice(Math.max(0, safe - CONTEXT_WINDOW), safe),
    after: text.slice(safe, Math.min(text.length, safe + CONTEXT_WINDOW)),
  };
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

const resolveTextColorFromBackground = (backgroundColor: string): string => {
  const normalized = backgroundColor.trim().toLowerCase();
  if (normalized === "#ffffff") return "#1a1a1a";
  if (normalized === "#f4ecd8") return "#3b2f2f";
  return "#f7f7f7";
};

const resolveTextFontFamily = (fontFamily: "original" | "serif" | "sans-serif"): string => {
  if (fontFamily === "serif") return "\"Noto Serif KR\", \"Times New Roman\", serif";
  if (fontFamily === "sans-serif") return "\"Pretendard\", \"Noto Sans KR\", sans-serif";
  return "\"Pretendard\", \"Noto Sans KR\", sans-serif";
};

export function TextViewerRoute({ loaderData }: TextViewerRouteProps) {
  const { chapterId: routeChapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();
  usePreventBrowserZoom(true);

  const { chapter, seriesId, volumeId, isLoading: chapterLoading, error } = loaderData;
  const chapterId = chapter?.id || "";

  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;

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

  const [text, setText] = useState("");
  const [isLoadingText, setIsLoadingText] = useState(true);
  const [showPageJump, setShowPageJump] = useState(false);
  const [restoreOffset, setRestoreOffset] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const uiTimerRef = useRef<number | null>(null);
  const uiShownTimeRef = useRef<number>(0);
  const isInteractingRef = useRef(false);
  const lastSaveRef = useRef<number>(0);
  const saveTimerRef = useRef<number | null>(null);

  const { nextChapterId, prevChapterId, isAdjacentResolved } = useAdjacentChapters({
    volumeId,
    chapterId,
    seriesId,
  });

  useReadingTime(seriesId || undefined, !chapterLoading && !isLoadingText && !error, chapterId);

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

  const updateVirtualPage = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const viewport = Math.max(1, container.clientHeight);
    const full = Math.max(viewport, container.scrollHeight);
    const virtualTotal = Math.max(1, Math.ceil(full / viewport));
    const virtualPage = clamp(Math.floor(container.scrollTop / viewport) + 1, 1, virtualTotal);

    setTotalPages(virtualTotal);
    setCurrentPage(virtualPage);
  }, [setCurrentPage, setTotalPages]);

  const saveProgress = useCallback(async () => {
    if (isIncognito || !chapter || !chapterId || !seriesId || !scrollRef.current || !text) return;

    const container = scrollRef.current;
    const ratio = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
    const offset = clamp(Math.round(ratio * Math.max(0, text.length - 1)), 0, Math.max(0, text.length - 1));
    const ctx = getAnchorContext(text, offset);

    const safeTotalPages = Math.max(1, totalPages);
    const safeCurrentPage = clamp(currentPage, 1, safeTotalPages);

    const anchor: SavedTextAnchor = {
      kind: "txt_anchor",
      offset,
      before: ctx.before,
      after: ctx.after,
      hash: hashContext(`${ctx.before}|${ctx.after}`),
    };

    await seriesAPI.updateProgress(seriesId, {
      chapter_id: chapterId,
      volume_id: chapter.volume_id,
      current_page: safeCurrentPage,
      total_pages: safeTotalPages,
      current_position: offset,
      total_positions: text.length,
      progress_percent: (safeCurrentPage / safeTotalPages) * 100,
      current_cfi: JSON.stringify(anchor),
    });
  }, [chapter, chapterId, currentPage, isIncognito, seriesId, text, totalPages]);

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

  const handleContentTap = useCallback(() => {
    if (isSettingsOpen) return;
    if (isUIVisible) {
      hideUI();
      return;
    }
    showUI();
    resetUITimer();
  }, [hideUI, isSettingsOpen, isUIVisible, resetUITimer, showUI]);

  const goToPage = useCallback(
    (page: number) => {
      const container = scrollRef.current;
      if (!container) return;
      const safePage = clamp(page, 1, Math.max(1, totalPages));
      container.scrollTop = (safePage - 1) * container.clientHeight;
      updateVirtualPage();
      scheduleSave();
    },
    [scheduleSave, totalPages, updateVirtualPage],
  );

  const handleNext = useCallback(() => {
    if (currentPage < totalPages) {
      goToPage(currentPage + 1);
      return;
    }

    if (nextChapterId && isAdjacentResolved) {
      navigate(`/viewer/${nextChapterId}`, {
        state: viewerFrom ? { from: viewerFrom } : undefined,
      });
    }
  }, [currentPage, goToPage, isAdjacentResolved, navigate, nextChapterId, totalPages, viewerFrom]);

  const handlePrev = useCallback(() => {
    if (currentPage > 1) {
      goToPage(currentPage - 1);
      return;
    }

    if (prevChapterId && isAdjacentResolved) {
      navigate(`/viewer/${prevChapterId}`, {
        state: viewerFrom ? { from: viewerFrom } : undefined,
      });
    }
  }, [currentPage, goToPage, isAdjacentResolved, navigate, prevChapterId, viewerFrom]);

  const { showSyncModal, serverProgress, handleConfirmSync, handleCloseModal } = useProgressSync({
    seriesId,
    chapter,
    currentPage,
    isLoading: chapterLoading || isLoadingText,
  });

  const { terminatedInfo } = useViewerSync({
    seriesId: seriesId || "",
    chapterId: chapter?.id,
    currentPage,
    isLoading: chapterLoading || isLoadingText,
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
        const [textRes, progressRes] = await Promise.all([chapterAPI.getText(chapterId), chapterAPI.getProgress(chapterId)]);
        if (cancelled) return;

        const content = textRes.data.content || "";
        setText(content);

        const progress = progressRes.data?.progress;
        if (progress) {
          const anchor = parseAnchor(progress.current_cfi);
          if (anchor?.kind === "txt_anchor" && typeof anchor.offset === "number") {
            let offset = clamp(anchor.offset, 0, Math.max(0, content.length - 1));
            if (anchor.before || anchor.after) {
              const seed = `${anchor.before || ""}${anchor.after || ""}`;
              if (seed) {
                const idx = content.indexOf(seed);
                if (idx >= 0) {
                  offset = idx + (anchor.before?.length || 0);
                }
              }
            }
            setRestoreOffset(clamp(offset, 0, Math.max(0, content.length - 1)));
          } else if (typeof progress.current_position === "number" && progress.current_position >= 0) {
            setRestoreOffset(clamp(progress.current_position, 0, Math.max(0, content.length - 1)));
          } else {
            setRestoreOffset(null);
          }
        } else {
          setRestoreOffset(null);
        }
      } catch (err) {
        console.error("[TextViewer] failed to load text data:", err);
        if (!cancelled) {
          setText("");
          setRestoreOffset(null);
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
    if (!text || restoreOffset === null) return;
    const container = scrollRef.current;
    if (!container) return;

    const id = window.requestAnimationFrame(() => {
      const ratio = restoreOffset / Math.max(1, text.length - 1);
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = ratio * maxScroll;
      updateVirtualPage();
      setRestoreOffset(null);
    });

    return () => window.cancelAnimationFrame(id);
  }, [restoreOffset, text, updateVirtualPage]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onScroll = () => {
      updateVirtualPage();
      scheduleSave();
    };

    updateVirtualPage();
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [scheduleSave, updateVirtualPage]);

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
  }, [isUIVisible, resetUITimer, currentPage]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isIncognito || !seriesId || !chapterId || !chapter || !scrollRef.current || !text) return;

      const container = scrollRef.current;
      const ratio = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
      const offset = clamp(Math.round(ratio * Math.max(0, text.length - 1)), 0, Math.max(0, text.length - 1));
      const ctx = getAnchorContext(text, offset);
      const safeTotalPages = Math.max(1, totalPages);
      const safeCurrentPage = clamp(currentPage, 1, safeTotalPages);

      const payload = JSON.stringify({
        chapter_id: chapterId,
        volume_id: chapter.volume_id,
        current_page: safeCurrentPage,
        total_pages: safeTotalPages,
        current_position: offset,
        total_positions: text.length,
        progress_percent: (safeCurrentPage / safeTotalPages) * 100,
        current_cfi: JSON.stringify({
          kind: "txt_anchor",
          offset,
          before: ctx.before,
          after: ctx.after,
          hash: hashContext(`${ctx.before}|${ctx.after}`),
        }),
      });

      fetch(`${API_BASE_URL}/series/${seriesId}/progress`, {
        method: "PATCH",
        body: payload,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: true,
      }).catch((err) => console.error("[TextViewer] keepalive save failed:", err));
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [chapter, chapterId, currentPage, isIncognito, seriesId, text, totalPages]);

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
            isIncognito,
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
          seriesId={seriesId}
          nextChapterId={nextChapterId}
          onPrev={handlePrev}
          onNext={handleNext}
          onGoToPage={goToPage}
          onPageJumpClick={() => setShowPageJump(true)}
          onReadingModeChange={setReadingMode}
          onTogglePageOffset={togglePageOffset}
          onInteractionStart={handleInteractionStart}
          onInteractionEnd={handleInteractionEnd}
        />
      </div>

      <div
        className={viewerStyles.viewerContent}
        onClick={handleContentTap}
      >
        <div
          ref={scrollRef}
          className={styles.textScrollContainer}
        >
          <article
            className={styles.textBody}
            style={{
              fontSize: `${(settings.fontSize / 100) * 20}px`,
              lineHeight: settings.lineHeight,
              fontFamily: resolveTextFontFamily(settings.fontFamily),
            }}
          >
            {text}
          </article>
        </div>
      </div>

      {isSettingsOpen && (
        <ViewerSettingsModal
          onClose={closeSettings}
          showTextTypographyOption
        />
      )}

      <PageJumpModal
        show={showPageJump}
        totalPages={Math.max(1, totalPages)}
        onClose={() => setShowPageJump(false)}
        onJump={goToPage}
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
