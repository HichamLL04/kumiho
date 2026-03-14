import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { Folder } from "lucide-react";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { api, volumeAPI, downloadAPI } from "../api/client";
import { initiateDownload } from "../utils/download";
import { useAuthStore } from "../stores/authStore";
import styles from "./Series.module.css";

import type { Series, Volume, Library, ReadingProgress, SeriesProgressSummary, Chapter } from "../types/series";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { AlertModal, type AlertType } from "../components/modals/AlertModal";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

export function SeriesPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = `${location.pathname}${location.search}`;
  const [series, setSeries] = useState<Series | null>(null);

  const handleUpdate = (updated: Series | Volume) => {
    // 서재 페이지에서는 Series만 다룸
    if (!("volume_number" in updated)) {
      setSeries(updated as Series);
    }
  };
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | undefined>(undefined);
  const [summary, setSummary] = useState<SeriesProgressSummary | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 알림 모달 상태
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: "info",
    message: "",
  });

  const user = useAuthStore((state) => state.user);
  const canDownload = user?.role === "MASTER" || user?.can_download;
  const preferPercentLabel =
    volumes.length > 0 &&
    volumes.every((volume) => {
      const lowerPath = String(volume.path || "").toLowerCase();
      return lowerPath.endsWith(".txt") || lowerPath.endsWith(".epub");
    });

  const showAlert = (message: string, type: AlertType = "info") => {
    setAlertModal({ isOpen: true, type, message });
  };

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 볼륨 상세 페이지로 이동
  const openVolume = (volume: Volume) => {
    navigate(`/volumes/${volume.id}`);
  };
  const handleDownloadSeries = () => {
    if (!series) return;
    setAlertModal({
      isOpen: true,
      type: "info",
      message: t("series.alert.download_series_confirm", { title: series.title }),
      onConfirm: () => {
        try {
          const url = downloadAPI.getSeriesUrl(series.id);
          initiateDownload(url);
          closeAlert();
        } catch (error: unknown) {
          const err = error as { message?: string };
          showAlert(err.message || t("series.alert.download_failed"), "error");
        }
      },
    });
  };

  const handleDownloadVolume = (volume: Volume) => {
    setAlertModal({
      isOpen: true,
      type: "info",
      message: t("series.alert.download_volume_confirm", { title: volume.title }),
      onConfirm: () => {
        try {
          const url = downloadAPI.getVolumeUrl(volume.id);
          initiateDownload(url);
          closeAlert();
        } catch (error: unknown) {
          const err = error as { message?: string };
          showAlert(err.message || t("series.alert.download_failed"), "error");
        }
      },
    });
  };

  const loadData = useCallback(async () => {
    try {
      // 1. 핵심 데이터(시리즈, 볼륨, 진행도) 병렬 페칭
      const [seriesRes, volumesRes, progressRes] = await Promise.all([
        api.get(`/series/${id}`),
        api.get(`/series/${id}/volumes?parent_id=root`),
        api.get(`/series/${id}/progress`).catch(() => ({ data: null })),
      ]);

      const seriesData = seriesRes.data;
      setSeries(seriesData);

      // 볼륨 목록 정밀화 및 설정
      const rawVolumes = Array.isArray(volumesRes.data?.volumes) ? volumesRes.data.volumes : [];
      const normalizedVolumes: Volume[] = rawVolumes.map((raw: Volume & { is_completed?: boolean }) => ({
        ...raw,
        is_completed: raw.is_completed === true,
      }));
      setVolumes(normalizedVolumes);

      // 진행도 설정
      if (progressRes.data) {
        setProgress(progressRes.data.progress ?? undefined);
        setSummary(progressRes.data.summary ?? undefined);
      } else {
        setProgress(undefined);
        setSummary(undefined);
      }

      // 2. 라이브러리 정보는 시리즈 데이터 로드 후 비동기로 처리 (병목 방지)
      if (seriesData.library_id) {
        api
          .get(`/libraries/${seriesData.library_id}`)
          .then((libRes) => {
            setLibrary(libRes.data);
          })
          .catch((err) => console.error("Failed to load library:", err));
      }
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) loadData();
  }, [id, loadData]);

  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  if (!series) {
    return (
      <div className={styles.pageContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className={styles.errorContainer}>
          <p>{t("series.not_found")}</p>
          <Link
            to="/"
            className={styles.backLink}
          >
            {t("common.go_home")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.pageContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 서브 헤더 */}
      <SubHeader
        items={[
          ...(library
            ? [
                {
                  label: (
                    <>
                      <Folder size={14} /> {library.name}
                    </>
                  ),
                  to: `/libraries/${library.id}`,
                },
              ]
            : []),
          { label: series.title },
        ]}
      />

      {/* 볼륨 그리드 */}
      <main className={styles.seriesMain}>
        {series ? (
          <>
            <SeriesInfoCard
              series={series}
              progress={progress}
              summary={summary}
              preferPercentLabel={preferPercentLabel}
              onUpdate={handleUpdate}
              onRefresh={loadData}
              onAlert={showAlert}
              onPlay={async () => {
                if (progress && progress.chapter_id) {
                  navigate(`/viewer/${progress.chapter_id}`, { state: { from: viewerFrom } });
                } else if (volumes.length > 0) {
                  const sortedVolumes = [...volumes].sort((a, b) => a.volume_number - b.volume_number);

                  // 재귀적으로 첫 번째 챕터 탐색
                  let firstChapter: Chapter | null = null;
                  for (const vol of sortedVolumes) {
                    firstChapter = await volumeAPI.findFirstChapterRecursively(vol.id);
                    if (firstChapter) break;
                  }

                  if (firstChapter) {
                    navigate(`/viewer/${firstChapter.id}`, { state: { from: viewerFrom } });
                  } else {
                    // 챕터를 전혀 찾지 못한 경우 첫 번째 볼륨으로 이동
                    openVolume(sortedVolumes[0]);
                  }
                } else {
                  showAlert(t("series.alert.no_readable_volume"), "warning");
                }
              }}
              onDownload={canDownload ? handleDownloadSeries : undefined}
            />

            <div className={styles.volumeCount}>
              <Trans
                i18nKey={series.chapter_count && series.chapter_count > 0 ? "series.chapter_count" : "series.count"}
                count={
                  series.chapter_count && series.chapter_count > 0
                    ? series.chapter_count
                    : series.volume_count || volumes.length
                }
                components={{ strong: <strong /> }}
              />
            </div>

            {volumes.length === 0 ? (
              <div className={styles.emptyState}>
                <p>{t("series.empty_volumes")}</p>
              </div>
            ) : (
              <div className={styles.volumeGrid}>
                {volumes.map((volume) => (
                  <SeriesCard
                    key={volume.id}
                    item={volume}
                    type="volume"
                    progressStyle="overlay"
                    extensionBadgePlacement="meta"
                    onStatusChange={loadData}
                    onDownload={canDownload ? () => handleDownloadVolume(volume) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </main>

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        message={alertModal.message}
        onConfirm={alertModal.onConfirm || closeAlert}
        onCancel={alertModal.onConfirm ? closeAlert : undefined}
        showCancel={!!alertModal.onConfirm}
      />
    </div>
  );
}
