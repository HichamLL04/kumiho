import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ListMusic, Music, Moon, Bookmark, Gauge, MoreVertical, CheckCircle2 } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { formatDuration } from "../../../../utils/progressUtils";
import { getAuthenticatedImageUrl } from "../../../../utils/image";
import { AudioControls } from "../AudioControls/AudioControls";
import { AudioProgressBar } from "../AudioProgressBar/AudioProgressBar";
import { AudioSleepTimer } from "../AudioSleepTimer/AudioSleepTimer";
import { AudioBookmarkList } from "../AudioBookmarkList/AudioBookmarkList";
import { AudioSettingsPanel } from "../AudioSettingsPanel/AudioSettingsPanel";
import { AudioVisualizer } from "../AudioVisualizer/AudioVisualizer";
import styles from "./AudioFullscreenPlayer.module.css";

const SPEED_CYCLE = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function AudioFullscreenPlayer() {
  const { t } = useTranslation();
  const playerMode = useAudioPlayerStore((s) => s.playerMode);
  const status = useAudioPlayerStore((s) => s.status);
  const isPlaying = status === "playing";
  const currentSeries = useAudioPlayerStore((s) => s.currentSeries);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const chapters = useAudioPlayerStore((s) => s.chapters);
  const chapterProgressMap = useAudioPlayerStore((s) => s.chapterProgressMap);
  const currentTime = useAudioPlayerStore((s) => s.currentTime);
  const currentDuration = useAudioPlayerStore((s) => s.duration);
  const isChapterListOpen = useAudioPlayerStore((s) => s.isChapterListOpen);
  const playbackRate = useAudioPlayerStore((s) => s.settings.playbackRate);
  const sleepTimerEndTime = useAudioPlayerStore((s) => s.sleepTimerEndTime);

  const setPlayerMode = useAudioPlayerStore((s) => s.setPlayerMode);
  const setPlaybackRate = useAudioPlayerStore((s) => s.setPlaybackRate);
  const toggleChapterList = useAudioPlayerStore((s) => s.toggleChapterList);
  const playChapter = useAudioPlayerStore((s) => s.playChapter);

  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null);

  // 썸네일 URL (캐시 버스팅 포함)
  const thumbnailUrl = useMemo(() => {
    if (!currentSeries?.thumbnail_url) return null;
    const rawUrl = currentSeries.thumbnail_url;
    const versionSource = currentSeries.updated_at;
    // updated_at이 없을 경우 static한 0을 사용하여 렌더링 시마다 값이 변하지 않게 함 (Date.now() 제거)
    const busterValue = versionSource ? new Date(versionSource).getTime() : 0;
    const cacheBuster = `_cb=${busterValue}`;
    const separator = rawUrl.includes("?") ? "&" : "?";
    return getAuthenticatedImageUrl(`${rawUrl}${separator}${cacheBuster}`);
  }, [currentSeries]);

  useEffect(() => {
    if (playerMode !== "fullscreen") return;
    if (!sleepTimerEndTime) {
      const t = setTimeout(() => setRemainingMinutes(null), 0);
      return () => clearTimeout(t);
    }

    const update = () => {
      const remaining = sleepTimerEndTime - Date.now();
      if (remaining <= 0) {
        setRemainingMinutes(null);
      } else {
        setRemainingMinutes(Math.floor(remaining / 60000));
      }
    };

    const timeout = setTimeout(update, 0);
    const interval = setInterval(update, 10000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [playerMode, sleepTimerEndTime]);

  if (playerMode !== "fullscreen" || status === "idle") return null;

  const seriesTitle = currentSeries?.title || "";
  const chapterTitle = currentChapter?.title || `Chapter ${currentChapter?.chapter_number ?? ""}`;

  const handleMinimize = () => {
    setPlayerMode("mini");
  };

  const handleChapterClick = (chapterId: string) => {
    if (chapterId === currentChapter?.id) return;

    const chapter = chapters.find((c) => c.id === chapterId);
    if (chapter) {
      const resumeTime = chapterProgressMap[chapterId]?.current_time ?? 0;
      playChapter(chapter, resumeTime);
    }
  };

  const handleCycleSpeed = () => {
    const currentIndex = SPEED_CYCLE.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % SPEED_CYCLE.length;
    setPlaybackRate(SPEED_CYCLE[nextIndex]);
  };

  return (
    <div className={`${styles.overlay} ${isChapterListOpen ? styles.withList : ""}`}>
      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.headerBtn}
          onClick={handleMinimize}
          aria-label="Minimize"
        >
          <ChevronDown size={24} />
        </button>
        <div className={styles.headerCenter}>
          <div className={styles.labelWrapper}>
            <span className={styles.headerLabel}>
              {isPlaying ? t("audio_player.now_playing", "NOW PLAYING") : t("audio_player.paused", "PAUSED")}
            </span>
            <AudioVisualizer
              variant="fullscreen"
              isPlaying={isPlaying}
            />
          </div>
        </div>
        <button
          className={styles.headerBtn}
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >
          <MoreVertical size={22} />
        </button>
      </div>

      <div className={styles.mainLayout}>
        <div className={styles.content}>
          <div className={styles.coverWrapper}>
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={seriesTitle}
                className={styles.cover}
              />
            ) : (
              <div className={styles.coverPlaceholder}>
                <Music size={64} />
              </div>
            )}
          </div>

          <div className={styles.info}>
            <div className={styles.title}>{seriesTitle}</div>
            {currentSeries?.author && <div className={styles.subtitle}>{currentSeries.author}</div>}
            <div className={styles.chapterInfo}>{chapterTitle}</div>
          </div>

          <div className={styles.progressSection}>
            <AudioProgressBar variant="fullscreen" />
          </div>

          <div className={styles.controlsSection}>
            <AudioControls variant="fullscreen" />
          </div>

          <div className={styles.bottomActions}>
            <button
              className={styles.actionBtn}
              onClick={handleCycleSpeed}
            >
              <Gauge size={16} />
              {playbackRate}x
            </button>
            <button
              className={`${styles.actionBtn} ${sleepTimerEndTime ? styles.actionBtnActive : ""}`}
              onClick={() => setSleepTimerOpen(true)}
            >
              <Moon size={16} />
              {remainingMinutes !== null
                ? t("audio_player.sleep_timer_minutes", "{{count}}분", { count: remainingMinutes })
                : t("audio_player.sleep", "수면")}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => setBookmarkOpen(true)}
            >
              <Bookmark size={16} />
              {t("audio_player.bookmark", "Mark")}
            </button>
            <button
              className={`${styles.actionBtn} ${isChapterListOpen ? styles.actionBtnActive : ""}`}
              onClick={toggleChapterList}
            >
              <ListMusic size={16} />
              {t("audio_player.list", "List")}
            </button>
          </div>
        </div>

        {isChapterListOpen && (
          <div className={styles.chapterListSection}>
            <div className={styles.chapterListHeader}>
              <span className={styles.chapterListTitle}>{t("audio_player.chapters", "Chapters")}</span>
              <span className={styles.chapterCount}>
                {chapters.length} {t("audio_player.total", "TOTAL")}
              </span>
            </div>
            <div className={styles.chapterList}>
              {chapters.map((chapter, index) => {
                const isActive = chapter.id === currentChapter?.id;
                const chapterProgress = chapterProgressMap[chapter.id];
                const progressPercent = chapterProgress?.progress_percent ?? 0;
                const displayCurrentTime = isActive ? currentTime : (chapterProgress?.current_time ?? null);
                const duration = chapter.duration ?? (isActive ? currentDuration : null);
                const isCompletedByProgress =
                  progressPercent >= 99.9 ||
                  (duration != null && displayCurrentTime != null && displayCurrentTime >= duration - 1);
                const isCompleted = chapter.is_read === true || isCompletedByProgress;
                const hasAudioProgress = !isCompleted && displayCurrentTime != null && duration != null;

                const durationLabel =
                  duration != null
                    ? hasAudioProgress
                      ? `${formatDuration(displayCurrentTime ?? 0)} / ${formatDuration(duration)}`
                      : formatDuration(duration)
                    : "";

                return (
                  <button
                    key={chapter.id}
                    className={`${styles.chapterItem} ${isActive ? styles.chapterItemActive : ""}`}
                    onClick={() => handleChapterClick(chapter.id)}
                  >
                    {isActive && status === "playing" ? (
                      <div className={styles.playingIndicator}>
                        <div className={styles.playingBar} />
                        <div className={styles.playingBar} />
                        <div className={styles.playingBar} />
                      </div>
                    ) : isCompleted ? (
                      <span className={styles.completedIndicator}>
                        <CheckCircle2
                          size={16}
                          className={styles.completedIcon}
                        />
                      </span>
                    ) : (
                      <span className={styles.chapterNumber}>{index + 1}</span>
                    )}
                    <span
                      className={`${styles.chapterTitle} ${isCompleted && !isActive ? styles.chapterTitleCompleted : ""}`}
                    >
                      {chapter.title || `Chapter ${index + 1}`}
                    </span>
                    {durationLabel && (
                      <span
                        className={`${styles.chapterDuration} ${
                          isCompleted && !isActive ? styles.chapterDurationCompleted : ""
                        }`}
                      >
                        {durationLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <AudioSleepTimer
        isOpen={sleepTimerOpen}
        onClose={() => setSleepTimerOpen(false)}
      />
      <AudioBookmarkList
        isOpen={bookmarkOpen}
        onClose={() => setBookmarkOpen(false)}
      />
      <AudioSettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
