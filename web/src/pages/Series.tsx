import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { Folder } from "lucide-react";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { api, seriesAPI, volumeAPI, downloadAPI } from "../api/client";
import { initiateDownload } from "../utils/download";
import { useAuthStore } from "../stores/authStore";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
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
      const updatedSeries = updated as Series;
      setSeries(updatedSeries);
      // 오디오 플레이어 스토어 동기화
      const audioStore = useAudioPlayerStore.getState();
      if (audioStore.currentSeries?.id === updatedSeries.id) {
        audioStore.updateCurrentSeries(updatedSeries);
        // 만약 업데이트된 객체에 volumes/chapters 정보가 포함되어 있다면 함께 갱신 (선택적)
        // 여기서는 Series 타입에 직접적인 chapters 배열이 없을 수도 있으므로 체크 필요
      }
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

  // 시리즈 데이터가 변경될 때마다 오디오 플레이어 스토어 동기화
  useEffect(() => {
    if (series) {
      const audioStore = useAudioPlayerStore.getState();
      if (audioStore.currentSeries?.id === series.id) {
        audioStore.updateCurrentSeries(series);
      }
    }
  }, [series]);

  // 오디오 재생 중이면 스토어의 currentTime을 구독하여 summary를 실시간 갱신
  const baseListenedRef = useRef<number | null>(null);
  const baseChapterTimeRef = useRef<number>(0);
  const currentChapterIdRef = useRef<string | null>(null);
  const lastChapterTimeRef = useRef<number>(0);
  const wasPlayingRef = useRef(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  useEffect(() => {
    if (!id || !series) return;
    const isAudioSeries = series.library_type === "audiobook" || series.has_audio;
    if (!isAudioSeries) return;

    let lastUpdate = 0;
    let lastVolumeUpdate = 0;
    let lastVolumeId: string | null = null;
    const unsub = useAudioPlayerStore.subscribe(
      (state) => ({
        currentSeriesId: state.currentSeries?.id ?? null,
        status: state.status,
        playerMode: state.playerMode,
        currentChapterId: state.currentChapter?.id ?? null,
        currentVolumeId: state.currentVolume?.id ?? null,
        currentTime: state.currentTime,
        duration: state.duration,
      }),
      (audioState) => {
      const isThisSeries = audioState.currentSeriesId === id;
      const isActive =
        isThisSeries &&
        (audioState.status === "playing" || audioState.status === "paused") &&
        audioState.playerMode !== "hidden";

      // 플레이어가 닫히거나 다른 시리즈로 전환 시 서버에서 최신 진행도 가져오기
      if (wasPlayingRef.current && !isActive) {
        wasPlayingRef.current = false;
        baseListenedRef.current = null;
        baseChapterTimeRef.current = 0;
        currentChapterIdRef.current = null;
        lastChapterTimeRef.current = 0;
        lastVolumeUpdate = 0;
        lastVolumeId = null;
        // 서버에 저장이 완료된 후 fetch (saveProgress 네트워크 요청 대기)
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
        refreshTimeoutRef.current = setTimeout(() => {
          void loadData();
          refreshTimeoutRef.current = null;
        }, 800);
        return;
      }

      if (!isActive) return;
      wasPlayingRef.current = true;

      const currentChapterId = audioState.currentChapterId;
      if (currentChapterIdRef.current !== currentChapterId) {
        if (currentChapterIdRef.current !== null) {
          const completedDelta = Math.max(0, lastChapterTimeRef.current - baseChapterTimeRef.current);
          baseListenedRef.current = Math.max(0, (baseListenedRef.current ?? 0) + completedDelta);
        }
        currentChapterIdRef.current = currentChapterId;

        const serverProgress = progressRef.current;
        const sameChapter = serverProgress?.chapter_id === currentChapterId;
        baseChapterTimeRef.current = sameChapter ? (serverProgress?.current_time ?? 0) : 0;
        lastChapterTimeRef.current = audioState.currentTime;
      } else {
        lastChapterTimeRef.current = audioState.currentTime;
      }

      const now = Date.now();
      if (now - lastUpdate < 5000) return;
      lastUpdate = now;

      setSummary((prev) => {
        if (!prev) return prev;
        // total_duration이 없으면 현재 재생 중인 챕터의 duration으로 초기화
        const totalDur = prev.total_duration || audioState.duration;
        if (!totalDur || totalDur <= 0) return prev;

        // 첫 호출 시 서버에서 온 listened_duration을 기준값으로 저장
        // baseChapterTime은 서버에 저장된 current_time 사용 (live state.currentTime 대신)
        // → 서버의 listened_duration과 동일 기준점을 사용하여 delta 오차 방지
        if (baseListenedRef.current === null) {
          baseListenedRef.current = prev.listened_duration ?? 0;
          const serverProgress = progressRef.current;
          const sameChapter = serverProgress?.chapter_id === audioState.currentChapterId;
          baseChapterTimeRef.current = sameChapter ? (serverProgress?.current_time ?? 0) : 0;
        }
        const delta = Math.max(0, audioState.currentTime - baseChapterTimeRef.current);
        const newListened = Math.max(0, (baseListenedRef.current ?? 0) + delta);
        return {
          ...prev,
          total_duration: totalDur,
          listened_duration: Math.min(newListened, totalDur),
        };
      });

      // 현재 재생 중인 볼륨 카드의 progress_percent도 실시간 갱신
      const currentVolumeId = audioState.currentVolumeId;
      if (currentVolumeId && audioState.duration > 0) {
        const nowForVolume = Date.now();
        if (lastVolumeId === currentVolumeId && nowForVolume - lastVolumeUpdate < 1000) {
          return;
        }
        lastVolumeUpdate = nowForVolume;
        lastVolumeId = currentVolumeId;

        const volumePercent = Math.min(100, (audioState.currentTime / audioState.duration) * 100);
        setVolumes((prev) =>
          prev.map((v) => (v.id === currentVolumeId ? { ...v, progress_percent: volumePercent } : v)),
        );
      }
    },
    );
    return () => {
      unsub();
      baseListenedRef.current = null;
      baseChapterTimeRef.current = 0;
      currentChapterIdRef.current = null;
      lastChapterTimeRef.current = 0;
      wasPlayingRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [id, series, loadData]);

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
                const isAudio = series.library_type === "audiobook" || series.has_audio;

                if (isAudio && volumes.length > 0) {
                  // 오디오북: 오디오 플레이어로 재생
                  // 시리즈 전체 챕터 로드 (볼륨 간 매끄러운 이동을 위함)
                  const [chaptersRes, progressListRes] = await Promise.all([
                    seriesAPI.getChapters(series.id),
                    seriesAPI.getProgressList(series.id).catch(() => null),
                  ]);
                  const allChapters: Chapter[] = chaptersRes.data.chapters || [];
                  const sorted = allChapters;

                  // 진행도의 챕터 찾기, 없으면 첫 챕터
                  let startChapter = sorted[0];
                  if (progress?.chapter_id) {
                    const found = sorted.find((c) => c.id === progress.chapter_id);
                    if (found) startChapter = found;
                  }

                  if (startChapter) {
                    // volume 파라미터는 null로 전달 (현재 챕터에 맞춰 자동 감지)
                    const store = useAudioPlayerStore.getState();
                    store.loadAndPlay(series, startChapter, sorted, null);
                    if (progressListRes?.data?.progress_list) {
                      store.setChapterProgressList(progressListRes.data.progress_list);
                    }
                  }
                  return;
                }

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
