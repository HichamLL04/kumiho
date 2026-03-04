import { useEffect, useCallback, useState, useRef } from "react";
import axios from "axios";
import { useSSE } from "./useSSE";
import { useTranslation } from "react-i18next";
import { progressAPI, viewerAPI } from "../api/client";

interface ViewerSyncProps {
  seriesId: string;
  chapterId?: string;
  currentPage: number;
  isLoading?: boolean;
  enablePageProgressSync?: boolean;
}

const RESUME_CHECK_INTERVAL_MS = 30_000;

export function useViewerSync({
  seriesId,
  chapterId,
  currentPage,
  isLoading = false,
  enablePageProgressSync = true,
}: ViewerSyncProps) {
  const { subscribe } = useSSE();
  const { t } = useTranslation();
  const [terminatedInfo, setTerminatedInfo] = useState<{ isOpen: boolean; reason: string }>({
    isOpen: false,
    reason: "",
  });
  const hasStarted = useRef(false);
  const initializedChapterKeyRef = useRef<string | null>(null);
  const resumeCheckInFlightRef = useRef(false);
  const currentPageRef = useRef(currentPage);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  const openTerminatedModal = useCallback(
    (reasonCode?: string) => {
      let messageKey = "viewer.session.force_logout_message";
      if (reasonCode === "CONNECTION_LIMIT") {
        messageKey = "viewer.session.connection_limit_message";
      }
      setTerminatedInfo({
        isOpen: true,
        reason: t(messageKey),
      });
    },
    [t],
  );

  // 0. 뷰어 진입 시 다른 세션에 FORCE_LOGOUT 전송 (1회만, 재시도 포함)
  useEffect(() => {
    if (chapterId && !hasStarted.current) {
      hasStarted.current = true;

      const startWithRetry = async (attempt: number) => {
        try {
          await viewerAPI.start({ series_id: seriesId || "", chapter_id: chapterId });
        } catch (err) {
          console.error(`[ViewerSync] Failed to notify viewer start (attempt ${attempt}):`, err);
          if (attempt < 3) {
            await startWithRetry(attempt + 1);
          }
        }
      };

      startWithRetry(1);
    }
  }, [seriesId, chapterId]);

  // 1. 강제 종료(FORCE_LOGOUT) 이벤트 구독
  useEffect(() => {
    const unsubscribe = subscribe("FORCE_LOGOUT", (payload) => {
      const data = payload as { reason?: string };
      openTerminatedModal(data.reason);
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe, openTerminatedModal]);

  // 1-2. 백그라운드/화면 꺼짐 복귀 보완: 복귀 이벤트에서 소유권 재검증
  const runResumeCheck = useCallback(async () => {
    if (!chapterId || resumeCheckInFlightRef.current) return;
    resumeCheckInFlightRef.current = true;
    try {
      await viewerAPI.resumeCheck({
        series_id: seriesId || "",
        chapter_id: chapterId,
        current_page: currentPageRef.current,
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const code = typeof error.response.data?.code === "string" ? error.response.data.code : undefined;
        if (code === "VIEWER_TAKEN_OVER") {
          openTerminatedModal("DUPLICATE_LOGIN");
        }
      }
    } finally {
      resumeCheckInFlightRef.current = false;
    }
  }, [seriesId, chapterId, openTerminatedModal]);

  useEffect(() => {
    if (!chapterId) return;

    // 뷰어가 준비되는 즉시 1회 검증 (모바일 복귀 이벤트 누락 보완)
    void runResumeCheck();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runResumeCheck();
      }
    };
    const onFocus = () => {
      void runResumeCheck();
    };
    const onPageShow = () => {
      void runResumeCheck();
    };
    const onTouchStart = () => {
      if (document.visibilityState === "visible") {
        void runResumeCheck();
      }
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void runResumeCheck();
      }
    }, RESUME_CHECK_INTERVAL_MS);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("touchstart", onTouchStart, { passive: true });

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("touchstart", onTouchStart);
    };
  }, [chapterId, runResumeCheck]);

  // 2. 진행도 변경 시 서버에 전송 (REST API)
  // 챕터별 첫 이벤트는 스킵하여 챕터 전환 레이스에서 이전 챕터 페이지가 전송되는 문제를 방지
  const updateProgress = useCallback(async () => {
    if (!enablePageProgressSync) return;
    if (chapterId && seriesId && !isLoading) {
      try {
        await progressAPI.update({
          series_id: seriesId,
          chapter_id: chapterId,
          current_page: currentPage,
        });
      } catch (err) {
        console.error("[ViewerSync] Progress update failed:", err);
      }
    }
  }, [seriesId, chapterId, currentPage, isLoading, enablePageProgressSync]);

  // 페이지가 바뀔 때마다 서버에 알림 (챕터별 첫 이벤트 제외)
  useEffect(() => {
    const chapterKey = chapterId ? `${seriesId}:${chapterId}` : null;
    if (!enablePageProgressSync || !chapterKey || isLoading) {
      return;
    }

    if (initializedChapterKeyRef.current !== chapterKey) {
      initializedChapterKeyRef.current = chapterKey;
      return;
    }

    updateProgress();
  }, [seriesId, chapterId, currentPage, isLoading, enablePageProgressSync, updateProgress]);

  return { terminatedInfo };
}
