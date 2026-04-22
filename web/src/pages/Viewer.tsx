import { useEffect, useLayoutEffect, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useChapterLoader } from "../features/viewer";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
import { useViewerStore } from "../stores/viewerStore";
import { useEpubViewerStore } from "../stores/epubViewerStore";
import { ImageViewerRoute } from "./ImageViewerRoute";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { EpubViewerRoute } from "./EpubViewerRoute";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Chapter } from "../types/series";
import styles from "./Viewer.module.css";

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const audioRedirectDone = useRef(false);
  const setViewerIncognito = useViewerStore((state) => state.setIncognito);
  const setEpubIncognito = useEpubViewerStore((state) => state.setIncognito);

  // Fetch minimal data to route
  const loaderData = useChapterLoader({ chapterId });
  const routeIsIncognito = location.state?.isIncognito === true;

  const isAudio = loaderData.chapter?.render_mode === "audio";

  useLayoutEffect(() => {
    if (!routeIsIncognito) {
      setViewerIncognito(false);
      setEpubIncognito(false);
      return;
    }

    if (!loaderData.chapter) {
      setViewerIncognito(true);
      setEpubIncognito(true);
      return;
    }

    const chapterPath = loaderData.chapter.path?.toLowerCase() ?? "";
    if (chapterPath.endsWith(".epub") || chapterPath.endsWith(".txt")) {
      setViewerIncognito(false);
      setEpubIncognito(true);
      return;
    }

    setViewerIncognito(true);
    setEpubIncognito(false);
  }, [loaderData.chapter, routeIsIncognito, setEpubIncognito, setViewerIncognito]);

  useEffect(() => {
    audioRedirectDone.current = false;
  }, [loaderData.chapter?.id]);

  // Audio redirect: fetch series/chapters, open audio player, navigate back
  useEffect(() => {
    if (!isAudio || !loaderData.chapter || !loaderData.seriesId || audioRedirectDone.current) return;
    audioRedirectDone.current = true;
    let cancelled = false;

    const chapter = loaderData.chapter;
    const seriesId = loaderData.seriesId;
    const volumeId = loaderData.volumeId;

    void (async () => {
      try {
        const store = useAudioPlayerStore.getState();
        const result = await store.bootstrapAndPlay({
          source: "viewer",
          seriesId,
          volumeId: volumeId ?? undefined,
          preferredChapterId: chapter.id,
          chapter: chapter as Chapter,
        });
        if (cancelled) return;
        if (!result.ok) {
          throw new Error(result.reason ?? "bootstrap_failed");
        }
        if (window.history.length > 1) {
          navigate(-1);
        } else if (volumeId) {
          navigate(`/volumes/${volumeId}`, { replace: true });
        } else {
          navigate(`/series/${seriesId}`, { replace: true });
        }
      } catch (err) {
        console.error("Failed to load audio player data:", err);
        if (cancelled) return;
        if (volumeId) {
          navigate(`/volumes/${volumeId}`, { replace: true });
        } else {
          navigate(`/series/${seriesId}`, { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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

  const route = isEpub || isText ? (
    <EpubViewerRoute loaderData={loaderData} />
  ) : isPdf && !shouldUseImageRouteForPdf ? (
    <PdfViewerRoute loaderData={loaderData} />
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
