import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { seriesAPI, volumeAPI } from "../../../api/client";
import { isFullscreen as isDocumentFullscreen } from "../../../utils/fullscreen";
import { finishChapterSwitching, startChapterSwitching } from "../../../stores/fullscreenSwitchStore";
import type { Chapter } from "../types";
import type { ViewStatus } from "../types";

interface ServerProgress {
  volume_number: number;
  chapter_number: number;
  current_page: number;
  anchor_page: number;
  offset_ratio: number;
  chapter_id: string;
  volume_id: string;
}

interface UseProgressSyncParams {
  seriesId: string | null;
  chapter: Chapter | null;
  currentPage: number;
  isLoading: boolean;
  anchorPage?: number;
  offsetRatio?: number;
  viewStatus?: ViewStatus;
}

export function useProgressSync({
  seriesId,
  chapter,
  currentPage,
  isLoading,
  anchorPage = currentPage,
  offsetRatio = 0,
  viewStatus = "ready",
}: UseProgressSyncParams) {
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [serverProgress, setServerProgress] = useState<ServerProgress | null>(null);
  const isCheckedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;
  const skipSyncCheck = location.state?.skipSyncCheck === true;

  useEffect(() => {
    if (skipSyncCheck) {
      isCheckedRef.current = true;
    }
  }, [skipSyncCheck]);

  const checkSync = useCallback(async () => {
    if (!seriesId || !chapter || isLoading || viewStatus !== "ready" || isCheckedRef.current || skipSyncCheck) return;

    try {
      // 볼륨 번호 가져오기
      const volumeRes = await volumeAPI.get(chapter.volume_id);
      const volumeNumber = volumeRes.data.volume_number;

      const response = await seriesAPI.compareProgress(seriesId, {
        volume_number: volumeNumber,
        chapter_number: chapter.chapter_number,
        current_page: currentPage,
        anchor_page: anchorPage,
        offset_ratio: offsetRatio,
      });

      const { server_ahead, server_progress } = response.data;

      if (server_ahead && server_progress && server_progress.current_page !== currentPage) {
        setServerProgress(server_progress);
        setShowSyncModal(true);
      }

      isCheckedRef.current = true;
    } catch (error) {
      console.error("[useProgressSync] Failed to compare progress:", error);
    }
  }, [anchorPage, chapter, currentPage, isLoading, offsetRatio, seriesId, skipSyncCheck, viewStatus]);

  useEffect(() => {
    const triggerSync = async () => {
      // 로딩이 막 끝난 시점에 한 번만 체크
      if (!isLoading && viewStatus === "ready" && chapter && seriesId && !isCheckedRef.current) {
        await checkSync();
      }
    };

    triggerSync();
  }, [checkSync, chapter, isLoading, seriesId, viewStatus]);

  const handleConfirmSync = useCallback(() => {
    if (!serverProgress) return;

    setShowSyncModal(false);
    // 해당 챕터와 페이지로 이동
    const isChapterChanged = chapter ? serverProgress.chapter_id !== chapter.id : true;
    if (isChapterChanged) {
      startChapterSwitching(isDocumentFullscreen());
    } else {
      finishChapterSwitching();
    }
    const searchParams = new URLSearchParams({
      page: String(serverProgress.current_page),
      anchor: String(serverProgress.anchor_page || serverProgress.current_page),
      offset: "0",
    });
    navigate(`/viewer/${serverProgress.chapter_id}?${searchParams.toString()}`, {
      replace: true,
      state: {
        ...(viewerFrom ? { from: viewerFrom } : {}),
        ...(isChapterChanged ? {} : { skipSyncCheck: true }),
      },
    });
    // 페이지 이동 시 콤포넌트가 재마운트되거나 훅이 다시 실행되므로 isCheckedRef는 그대로 둬도 됨
  }, [serverProgress, navigate, viewerFrom, chapter]);

  const handleCloseModal = useCallback(() => {
    setShowSyncModal(false);
  }, []);

  return {
    showSyncModal,
    serverProgress,
    handleConfirmSync,
    handleCloseModal,
  };
}
