import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ListMusic, Music, Moon, Bookmark, Gauge } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { AudioControls } from "../AudioControls/AudioControls";
import { AudioProgressBar } from "../AudioProgressBar/AudioProgressBar";
import { AudioSleepTimer } from "../AudioSleepTimer/AudioSleepTimer";
import { AudioBookmarkList } from "../AudioBookmarkList/AudioBookmarkList";
import { AudioSpeedSelector } from "../AudioSpeedSelector/AudioSpeedSelector";
import styles from "./AudioFullscreenPlayer.module.css";

function formatDuration(seconds?: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioFullscreenPlayer() {
  const { t } = useTranslation();
  const playerMode = useAudioPlayerStore((s) => s.playerMode);
  const status = useAudioPlayerStore((s) => s.status);
  const currentSeries = useAudioPlayerStore((s) => s.currentSeries);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const chapters = useAudioPlayerStore((s) => s.chapters);
  const isChapterListOpen = useAudioPlayerStore((s) => s.isChapterListOpen);
  const playbackRate = useAudioPlayerStore((s) => s.settings.playbackRate);
  const sleepTimerMinutes = useAudioPlayerStore((s) => s.sleepTimerMinutes);
  const setPlayerMode = useAudioPlayerStore((s) => s.setPlayerMode);
  const toggleChapterList = useAudioPlayerStore((s) => s.toggleChapterList);
  const playChapter = useAudioPlayerStore((s) => s.playChapter);

  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);

  if (playerMode !== "fullscreen" || status === "idle") return null;

  const thumbnailUrl = currentSeries?.thumbnail_url;
  const seriesTitle = currentSeries?.title || "";
  const chapterTitle = currentChapter?.title || `Chapter ${currentChapter?.chapter_number ?? ""}`;

  const handleMinimize = () => {
    setPlayerMode("mini");
  };

  const handleChapterClick = (chapterId: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    if (chapter) {
      playChapter(chapter);
    }
  };

  return (
    <div className={styles.overlay}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.headerBtn} onClick={handleMinimize} aria-label="Minimize">
          <ChevronDown size={24} />
        </button>
        <div className={styles.headerCenter}>
          <span className={styles.headerLabel}>{t("audio_player.now_playing", "NOW PLAYING")}</span>
        </div>
        <button className={styles.headerBtn} onClick={toggleChapterList} aria-label="Chapters">
          <ListMusic size={22} />
        </button>
      </div>

      {/* Main Content */}
      <div className={styles.content}>
        {/* Cover */}
        <div className={styles.coverWrapper}>
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={seriesTitle} className={styles.cover} />
          ) : (
            <div className={styles.coverPlaceholder}>
              <Music size={64} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className={styles.info}>
          <div className={styles.title}>{seriesTitle}</div>
          {currentSeries?.author && (
            <div className={styles.subtitle}>{currentSeries.author}</div>
          )}
          <div className={styles.chapterInfo}>{chapterTitle}</div>
        </div>

        {/* Progress Bar */}
        <div className={styles.progressSection}>
          <AudioProgressBar variant="fullscreen" />
        </div>

        {/* Controls */}
        <div className={styles.controlsSection}>
          <AudioControls variant="fullscreen" />
        </div>

        {/* Bottom Actions */}
        <div className={styles.bottomActions}>
          <button className={styles.actionBtn} onClick={() => setSpeedOpen(true)}>
            <Gauge size={16} />
            {playbackRate}x
          </button>
          <button
            className={`${styles.actionBtn} ${sleepTimerMinutes ? styles.actionBtnActive : ""}`}
            onClick={() => setSleepTimerOpen(true)}
          >
            <Moon size={16} />
            {sleepTimerMinutes
              ? t("audio_player.sleep_timer_minutes", "{{count}} min", { count: sleepTimerMinutes })
              : t("audio_player.sleep", "Sleep")}
          </button>
          <button className={styles.actionBtn} onClick={() => setBookmarkOpen(true)}>
            <Bookmark size={16} />
            {t("audio_player.bookmark", "Mark")}
          </button>
          <button
            className={`${styles.actionBtn} ${isChapterListOpen ? styles.actionBtnActive : ""}`}
            onClick={toggleChapterList}
          >
            <ListMusic size={16} />
            {t("audio_player.chapters", "Chapters")}
          </button>
        </div>
      </div>

      {/* Chapter List */}
      {isChapterListOpen && (
        <div className={styles.chapterListSection}>
          <div className={styles.chapterListHeader}>
            <span className={styles.chapterListTitle}>{t("audio_player.chapters", "Chapters")}</span>
            <span className={styles.chapterCount}>
              {chapters.length} {t("audio_player.total", "TOTAL")}
            </span>
          </div>
          <div className={styles.chapterList}>
            {chapters.map((chapter) => {
              const isActive = chapter.id === currentChapter?.id;
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
                  ) : (
                    <span className={styles.chapterNumber}>{chapter.chapter_number}</span>
                  )}
                  <span className={styles.chapterTitle}>
                    {chapter.title || `Chapter ${chapter.chapter_number}`}
                  </span>
                  {chapter.duration != null && (
                    <span className={styles.chapterDuration}>{formatDuration(chapter.duration)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <AudioSleepTimer isOpen={sleepTimerOpen} onClose={() => setSleepTimerOpen(false)} />
      <AudioBookmarkList isOpen={bookmarkOpen} onClose={() => setBookmarkOpen(false)} />
      <AudioSpeedSelector isOpen={speedOpen} onClose={() => setSpeedOpen(false)} />
    </div>
  );
}
