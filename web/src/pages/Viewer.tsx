import { useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useChapterLoader } from "../features/viewer";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
import { seriesAPI, volumeAPI } from "../api/client";
import { ImageViewerRoute } from "./ImageViewerRoute";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { EpubViewerRoute } from "./EpubViewerRoute";
import { TextViewerRoute } from "./TextViewerRoute";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Chapter } from "../types/series";
import styles from "./Viewer.module.css";

const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".m4b", ".aac", ".wma", ".opus", ".mp4"];

function isAudioPath(path: string): boolean {
  const lower = path.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const audioRedirectDone = useRef(false);

  // Fetch minimal data to route
  const loaderData = useChapterLoader({ chapterId });

  const isAudio =
    loaderData.chapter?.render_mode === "audio" || (loaderData.chapter?.path && isAudioPath(loaderData.chapter.path));

  useEffect(() => {
    audioRedirectDone.current = false;
  }, [loaderData.chapter?.id]);

  // Audio redirect: fetch series/chapters, open audio player, navigate back
  useEffect(() => {
    if (!isAudio || !loaderData.chapter || !loaderData.seriesId || audioRedirectDone.current) return;
    audioRedirectDone.current = true;

    const chapter = loaderData.chapter;
    const seriesId = loaderData.seriesId;
    const volumeId = loaderData.volumeId;

    void (async () => {
      try {
        // Fetch series and chapters in parallel
        const [seriesRes, chaptersRes, progressListRes] = await Promise.all([
          seriesAPI.get(seriesId),
          seriesAPI.getChapters(seriesId),
          seriesAPI.getProgressList(seriesId).catch(() => null),
        ]);

        const series = seriesRes.data;
        const chapters = (chaptersRes.data.chapters || []).sort((a, b) => a.chapter_number - b.chapter_number);

        let volume = null;
        if (volumeId) {
          try {
            const volRes = await volumeAPI.get(volumeId);
            volume = volRes.data;
          } catch {
            /* ignore */
          }
        }

        const store = useAudioPlayerStore.getState();
        store.loadAndPlay(series, chapter as Chapter, chapters, volume);
        if (progressListRes?.data?.progress_list) {
          store.setChapterProgressList(progressListRes.data.progress_list);
        }
      } catch (err) {
        console.error("Failed to load audio player data:", err);
      }

      if (window.history.length > 1) {
        navigate(-1);
      } else if (volumeId) {
        navigate(`/volumes/${volumeId}`, { replace: true });
      } else {
        navigate(`/series/${seriesId}`, { replace: true });
      }
    })();
  }, [isAudio, loaderData.chapter, loaderData.seriesId, loaderData.volumeId, navigate]);

  if (isAudio) {
    return (
      <LoadingSpinner
        fullScreen
        text={undefined}
      />
    );
  }

  if (loaderData.error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "white" }}>
        <div>{t("viewer.error.load_failed", { error: loaderData.error })}</div>
      </div>
    );
  }

  // 메인 로딩 스피너: viewStatus가 "ready"가 될 때까지 오버레이 유지
  // 이미지가 실제 로드 완료된 후에만 오버레이를 제거하여 검은 화면 깜빡임 방지
  const showLoading =
    loaderData.isLoading ||
    !loaderData.chapter ||
    (loaderData.viewStatus !== undefined && loaderData.viewStatus !== "ready");

  if (!loaderData.chapter) {
    return showLoading ? (
      <LoadingSpinner
        fullScreen
        text={undefined}
      />
    ) : null;
  }

  const chapterPath = loaderData.chapter.path?.toLowerCase() ?? "";
  const isPdf = chapterPath.endsWith(".pdf");
  const isEpub = chapterPath.endsWith(".epub");
  const isText = chapterPath.endsWith(".txt");
  const shouldUseImageRouteForPdf = isPdf && loaderData.chapter.render_mode === "image";

  const route = isEpub ? (
    <EpubViewerRoute loaderData={loaderData} />
  ) : isPdf && !shouldUseImageRouteForPdf ? (
    <PdfViewerRoute loaderData={loaderData} />
  ) : isText ? (
    <TextViewerRoute loaderData={loaderData} />
  ) : (
    <ImageViewerRoute loaderData={loaderData} />
  );

  return (
    <>
      {showLoading && (
        <LoadingSpinner
          fullScreen
          text={undefined}
          className={styles.viewerLoadingOverlay}
        />
      )}
      {route}
    </>
  );
}
