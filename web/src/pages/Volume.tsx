import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, useNavigate, Link, useLocation } from "react-router-dom";
import { Check, CheckCircle, Folder, FileText, Music, MoreVertical, EyeOff, Download } from "lucide-react";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { api, volumeAPI, downloadAPI, chapterAPI } from "../api/client";
import { formatDuration } from "../utils/progressUtils";
import { buildViewerRouteState } from "../utils/viewerRouteState";
import { initiateDownload } from "../utils/download";
import { useAuthStore } from "../stores/authStore";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
import { Tooltip } from "../components/common/Tooltip";
import styles from "./Volume.module.css";

import type { Volume, Chapter, Series, ReadingProgress, Library } from "../types/series";
import { AlertModal, type AlertType } from "../components/modals/AlertModal";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

export function VolumePage() {
  const { t } = useTranslation();
  const { volumeId } = useParams<{ volumeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = `${location.pathname}${location.search}`;
  const [volume, setVolume] = useState<Volume | null>(null);
  const [subVolumes, setSubVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [series, setSeries] = useState<Series | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [lastProgress, setLastProgress] = useState<ReadingProgress | null>(null);
  const [progressList, setProgressList] = useState<ReadingProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [activeMenuChapterId, setActiveMenuChapterId] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 알림 모달 상태
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    message: string;
    onConfirm?: () => void | Promise<void>;
  }>({
    isOpen: false,
    type: "info",
    message: "",
  });

  const user = useAuthStore((state) => state.user);
  const canDownload = user?.role === "MASTER" || user?.can_download;
  const lowerVolumePath = String(volume?.path || "").toLowerCase();
  const preferPercentLabel = lowerVolumePath.endsWith(".txt") || lowerVolumePath.endsWith(".epub");

  const showAlert = (message: string, type: AlertType = "info") => {
    setAlertModal({ isOpen: true, type, message });
  };

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  const loadData = useCallback(async () => {
    try {
      // 볼륨 상세 정보
      const volRes = await api.get(`/volumes/${volumeId}`);
      const volData = volRes.data as Volume;
      setVolume(volData);

      // 하위 볼륨 목록 조회
      if (volData.series_id) {
        const subVolsRes = await api.get(`/series/${volData.series_id}/volumes?parent_id=${volumeId}`);
        const rawSubVols = Array.isArray(subVolsRes.data?.volumes) ? subVolsRes.data.volumes : [];
        setSubVolumes(
          rawSubVols.map((v: Volume & { is_completed?: boolean }) => ({
            ...v,
            is_completed: v.is_completed === true,
          })),
        );

        // 부모 시리즈 정보
        const seriesRes = await api.get(`/series/${volData.series_id}`);
        const seriesData = seriesRes.data as Series;
        setSeries(seriesData);

        if (seriesData.library_id) {
          const libraryRes = await api.get(`/libraries/${seriesData.library_id}`);
          setLibrary(libraryRes.data as Library);
        } else {
          setLibrary(null);
        }
      } else {
        setLibrary(null);
      }

      // 챕터 목록 (볼륨 단위 API 사용)
      const chaptersRes = await volumeAPI.getChapters(volumeId!);
      const chapterList = chaptersRes.data.chapters || [];
      setChapters(chapterList.sort((a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number));
      // 최근 읽기 진행도 가져오기 (볼륨 단위)
      try {
        const progressRes = await api.get(`/volumes/${volumeId}/progress`);
        const list = progressRes.data.progress_list;

        if (Array.isArray(list)) {
          setProgressList(list);

          if (list.length > 0) {
            // 가장 최근 기록 찾기 (업데이트 시간 최우선, 동일 시 마지막 챕터 우선)
            const sorted = list.sort((a: ReadingProgress, b: ReadingProgress) => {
              const timeA = new Date(a.updated_at).getTime();
              const timeB = new Date(b.updated_at).getTime();
              if (timeB !== timeA) return timeB - timeA;

              // 업데이트 시간이 같으면(완독 시 등) 챕터 번호가 큰 것을 우선
              const chapA = chapterList.find((c) => c.id === a.chapter_id);
              const chapB = chapterList.find((c) => c.id === b.chapter_id);
              if (chapA && chapB) return chapB.chapter_number - chapA.chapter_number;
              return 0;
            });
            setLastProgress(sorted[0]);
          } else {
            setLastProgress(null);
          }
        } else {
          setProgressList([]);
          setLastProgress(null);
        }
      } catch {
        setProgressList([]);
        setLastProgress(null);
      }
    } catch (error) {
      console.error("Failed to load volume data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [volumeId]);

  const handleReset = (chapter: Chapter) => {
    setActiveMenuChapterId(null);
    setAlertModal({
      isOpen: true,
      type: "warning",
      message: chapter.is_read ? t("series.alert.reset_chapter_complete_msg") : t("series.alert.reset_chapter_msg"),
      onConfirm: async () => {
        try {
          setIsUpdating(true);
          await chapterAPI.deleteProgress(chapter.id);
          await loadData();
          closeAlert();
        } catch (err) {
          console.error(err);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.reset_failed") });
        } finally {
          setIsUpdating(false);
        }
      },
    });
  };

  const handleMarkChapterAsRead = (chapter: Chapter) => {
    setActiveMenuChapterId(null);
    setAlertModal({
      isOpen: true,
      type: "warning",
      message: t("series.alert.mark_complete_chapter_msg"),
      onConfirm: async () => {
        try {
          setIsUpdating(true);
          await chapterAPI.markComplete(chapter.id);
          await loadData();
          closeAlert();
        } catch (err) {
          console.error(err);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.complete_failed") });
        } finally {
          setIsUpdating(false);
        }
      },
    });
  };

  const handleMarkPreviousChaptersAsRead = (chapter: Chapter) => {
    setActiveMenuChapterId(null);
    setAlertModal({
      isOpen: true,
      type: "warning",
      message: t("series.alert.mark_previous_completed_msg"),
      onConfirm: async () => {
        try {
          setIsUpdating(true);
          await chapterAPI.markPreviousComplete(series!.id, chapter.id);
          await loadData();
          closeAlert();
        } catch (err) {
          console.error("Failed to mark previous chapters as read:", err);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.complete_failed") });
        } finally {
          setIsUpdating(false);
        }
      },
    });
  };

  useEffect(() => {
    if (!activeMenuChapterId) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const target = e.target;
      if (!target.closest(`.${styles.chapterMenuWrapper}`)) {
        setActiveMenuChapterId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeMenuChapterId]);

  useEffect(() => {
    if (volumeId) loadData();
  }, [volumeId, loadData]);

  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  if (!volume || !series) {
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

  // 이어보기 또는 첫 챕터 읽기
  const handlePlay = async (incognito = false) => {
    const viewerState = buildViewerRouteState({ from: viewerFrom, isIncognito: incognito });
    const isAudio = series.library_type === "audiobook";

    if (isAudio) {
      try {
        const store = useAudioPlayerStore.getState();
        const result = await store.bootstrapAndPlay({
          source: "volume",
          seriesId: series.id,
          volumeId: volume.id,
          series,
          volume,
        });
        if (!result.ok) {
          if (result.reason === "no_chapters") {
            showAlert(t("series.alert.no_readable_chapter"), "warning");
            return;
          }
          throw new Error(result.reason ?? "bootstrap_failed");
        }
      } catch (error) {
        console.error("Failed to start audiobook playback:", error);
        showAlert(
          t("series.alert.load_failed", { defaultValue: "오디오 정보를 불러오는데 실패했습니다." }),
          "error",
        );
      }
      return;
    }

    if (lastProgress && lastProgress.chapter_id) {
      navigate(`/viewer/${lastProgress.chapter_id}`, { state: viewerState });
      return;
    }

    // 재귀적으로 첫 번째 챕터 탐색
    const firstChapter = await volumeAPI.findFirstChapterRecursively(volumeId!);
    if (firstChapter) {
      navigate(`/viewer/${firstChapter.id}`, { state: viewerState });
    } else {
      showAlert(t("series.alert.no_readable_chapter"), "warning");
    }
  };
  const handleDownloadVolume = (volId?: string, volTitle?: string) => {
    const targetId = volId || volume?.id;
    const targetTitle = volTitle || volume?.title;

    if (!targetId) return;

    setAlertModal({
      isOpen: true,
      type: "info",
      message: t("series.alert.download_volume_confirm", { title: targetTitle }),
      onConfirm: () => {
        try {
          const url = downloadAPI.getVolumeUrl(targetId);
          initiateDownload(url);
          closeAlert();
        } catch (error: unknown) {
          const err = error as { message?: string };
          showAlert(err.message || t("series.alert.download_failed"), "error");
        }
      },
    });
  };

  const handleUpdate = (updated: Volume | Series) => {
    // Volume 타입인 경우만 처리
    if ("volume_number" in updated) {
      setVolume(updated as Volume);
    }
  };

  return (
    <div className={`${styles.pageContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <SubHeader
        items={[
          {
            label: (
              <>
                <Folder size={14} /> {series.title}
              </>
            ),
            to: `/series/${series.id}`,
          },
          { label: volume.title },
        ]}
        onBack={() => {
          if (volume.parent_id) {
            navigate(`/volumes/${volume.parent_id}`);
          } else if (series) {
            navigate(`/series/${series.id}`);
          } else {
            navigate(-1);
          }
        }}
      />

      <div className={styles.pageContentWrapper}>
        <main className={styles.volumeMain}>
          <SeriesInfoCard
            series={series}
            library={library}
            volume={volume}
            type="volume"
            progress={lastProgress || undefined}
            preferPercentLabel={preferPercentLabel}
            onPlay={handlePlay}
            onAlert={showAlert}
            onRefresh={loadData}
            onUpdate={handleUpdate}
            onDownload={canDownload ? handleDownloadVolume : undefined}
          />

          {subVolumes.length > 0 && (
            <>
              <div className={styles.volumeCount}>
                <Trans
                  i18nKey="series.count"
                  count={subVolumes.length}
                  components={{ strong: <strong /> }}
                />
              </div>
              <div className={styles.volumeGrid}>
                {subVolumes.map((vol) => (
                  <SeriesCard
                    key={vol.id}
                    item={vol}
                    type="volume"
                    progressStyle="overlay"
                    extensionBadgePlacement="meta"
                    onStatusChange={loadData}
                    onDownload={canDownload ? () => handleDownloadVolume(vol.id, vol.title) : undefined}
                  />
                ))}
              </div>
            </>
          )}

          {chapters.length > 0 && (
            <div className={styles.chapterCount}>
              <Trans
                i18nKey="series.chapter_count"
                count={chapters.length}
                components={{ strong: <strong /> }}
              />
            </div>
          )}

          {chapters.length === 0 && subVolumes.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t("series.empty_chapters")}</p>
            </div>
          ) : (
            <div className={styles.chapterList}>
              {chapters.map((chapter) => {
                const chapterProgress = progressList.find((p) => p.chapter_id === chapter.id);
                const hasPartialProgress =
                  !!chapterProgress &&
                  (chapterProgress.current_page > 0 || (chapterProgress.current_time ?? 0) > 0) &&
                  !chapter.is_read;
                const shouldShowResetAction = chapter.is_read || hasPartialProgress;

                return (
                  <div
                    key={chapter.id}
                    className={`${styles.chapterItem} ${lastProgress?.chapter_id === chapter.id ? styles.current : ""} ${
                      isUpdating ? styles.loading : ""
                    }`}
                    onClick={() =>
                      !isUpdating &&
                      navigate(`/viewer/${chapter.id}`, { state: buildViewerRouteState({ from: viewerFrom }) })
                    }
                  >
                    <div className={styles.chapterThumbnailWrapper}>
                      {chapter.thumbnail_url && !imageErrors[chapter.id] ? (
                        <img
                          src={`${chapter.thumbnail_url}${
                            chapter.thumbnail_url.includes("?") ? "&" : "?"
                          }token=${localStorage.getItem("access_token")}`}
                          alt={chapter.title}
                          className={styles.chapterThumbnail}
                          onError={() => setImageErrors((prev) => ({ ...prev, [chapter.id]: true }))}
                        />
                      ) : (
                        <div className={styles.chapterThumbnailPlaceholder}>
                          {String(chapter.path || "")
                            .toLowerCase()
                            .endsWith(".pdf") ? (
                            <FileText
                              size={20}
                              style={{ opacity: 0.5 }}
                            />
                          ) : (
                            <Folder size={20} />
                          )}
                        </div>
                      )}
                    </div>

                    <div className={styles.chapterInfo}>
                      <span className={styles.chapterNumber}>
                        Chapter {chapter.chapter_number}
                        {chapter.has_audio && (
                          <Music
                            size={12}
                            className={styles.audioIcon}
                          />
                        )}
                      </span>
                      <span className={styles.chapterTitle}>{chapter.title}</span>
                      <span className={styles.chapterPages}>
                        {chapter.has_audio && typeof chapter.duration === "number"
                          ? typeof chapterProgress?.current_time === "number"
                            ? `${formatDuration(chapterProgress.current_time)} / ${formatDuration(chapter.duration)}`
                            : formatDuration(chapter.duration)
                          : chapterProgress
                            ? `${chapterProgress.current_page} / ${chapter.page_count} P`
                            : `${chapter.page_count} Pages`}
                      </span>
                    </div>

                    <div className={styles.chapterStatus}>
                      {/* 완독 표시 / 독서 초기화 버튼 (원상복구) */}
                      {!shouldShowResetAction ? (
                        <Tooltip content={t("series.action.mark_completed")}>
                          <button
                            className={styles.chapterActionButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkChapterAsRead(chapter);
                            }}
                            aria-label={t("series.action.mark_completed")}
                            disabled={isUpdating}
                          >
                            <Check size={18} />
                          </button>
                        </Tooltip>
                      ) : (
                        <Tooltip content={t("series.action.mark_unread")}>
                          <button
                            className={`${styles.chapterActionButton} ${styles.resetButton}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReset(chapter);
                            }}
                            aria-label={t("series.action.mark_unread")}
                            disabled={isUpdating}
                          >
                            <CheckCircle size={18} />
                          </button>
                        </Tooltip>
                      )}

                      <div className={styles.chapterMenuWrapper}>
                        <Tooltip content={t("series.action.more")}>
                          <button
                            className={styles.chapterMenuButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuChapterId(activeMenuChapterId === chapter.id ? null : chapter.id);
                            }}
                            aria-label={t("series.action.more")}
                            aria-expanded={activeMenuChapterId === chapter.id}
                            aria-controls={`chapter-dropdown-${chapter.id}`}
                            disabled={isUpdating}
                          >
                            <MoreVertical
                              size={18}
                              strokeWidth={2}
                            />
                          </button>
                        </Tooltip>

                        {activeMenuChapterId === chapter.id && (
                          <div
                            id={`chapter-dropdown-${chapter.id}`}
                            className={styles.chapterDropdownMenu}
                          >
                            <button
                              className={styles.chapterMenuItem}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkPreviousChaptersAsRead(chapter);
                              }}
                            >
                              <CheckCircle
                                size={16}
                                strokeWidth={2}
                              />
                              <span>{t("series.action.mark_previous_completed")}</span>
                            </button>

                            <button
                              className={styles.chapterMenuItem}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuChapterId(null);
                                navigate(`/viewer/${chapter.id}`, {
                                  state: buildViewerRouteState({ from: viewerFrom, isIncognito: true }),
                                });
                              }}
                            >
                              <EyeOff size={16} />
                              <span>{t("series.action.incognito")}</span>
                            </button>

                            {canDownload && (
                              <button
                                className={styles.chapterMenuItem}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  initiateDownload(downloadAPI.getChapterUrl(chapter.id));
                                  setActiveMenuChapterId(null);
                                }}
                              >
                                <Download size={16} />
                                <span>{t("series.action.download")}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

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
