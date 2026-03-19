import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Moon, Bookmark, Music } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { AudioControls } from "../AudioControls/AudioControls";
import { AudioProgressBar } from "../AudioProgressBar/AudioProgressBar";
import { AudioSleepTimer } from "../AudioSleepTimer/AudioSleepTimer";
import { AudioBookmarkList } from "../AudioBookmarkList/AudioBookmarkList";
import { AudioSpeedSelector } from "../AudioSpeedSelector/AudioSpeedSelector";
import { formatDuration } from "../../../../utils/progressUtils";
import styles from "./AudioSidebarPlayer.module.css";

export function AudioSidebarPlayer() {
  const { t } = useTranslation();
  const playerMode = useAudioPlayerStore((s) => s.playerMode);
  const status = useAudioPlayerStore((s) => s.status);
  const currentSeries = useAudioPlayerStore((s) => s.currentSeries);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const chapters = useAudioPlayerStore((s) => s.chapters);
  const playbackRate = useAudioPlayerStore((s) => s.settings.playbackRate);
  const sleepTimerMinutes = useAudioPlayerStore((s) => s.sleepTimerMinutes);
  const setPlayerMode = useAudioPlayerStore((s) => s.setPlayerMode);
  const playChapter = useAudioPlayerStore((s) => s.playChapter);

  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);

  if (playerMode !== "sidebar" || status === "idle") return null;

  const thumbnailUrl = currentSeries?.thumbnail_url;
  const seriesTitle = currentSeries?.title || "";
  const author = currentSeries?.author || "";

  const handleClose = () => {
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
        <div className={styles.headerLeft}>
          <span className={styles.appTitle}>KUMIHO</span>
          <span className={styles.libraryName}>{t("audio_player.personal_library", "Personal Library Server")}</span>
        </div>
        <button
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="Close"
        >
          <X size={22} />
        </button>
      </div>

      {/* Player Section */}
      <div className={styles.playerSection}>
        <div className={styles.coverWrapper}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={seriesTitle}
              className={styles.cover}
            />
          ) : (
            <div className={styles.coverPlaceholder}>
              <Music size={48} />
            </div>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.title}>{seriesTitle}</div>
          {author && <div className={styles.subtitle}>{author}</div>}
        </div>

        <div className={styles.progressSection}>
          <AudioProgressBar variant="fullscreen" />
        </div>

        <div className={styles.controlsSection}>
          <AudioControls variant="sidebar" />
        </div>

        {/* Quick Actions */}
        <div className={styles.quickActions}>
          <button
            className={styles.quickBtn}
            onClick={() => setSpeedOpen(true)}
          >
            {playbackRate}x
          </button>
          <button
            className={`${styles.quickBtn} ${sleepTimerMinutes ? styles.quickBtnActive : ""}`}
            onClick={() => setSleepTimerOpen(true)}
          >
            <Moon size={14} />
            {sleepTimerMinutes ? `${sleepTimerMinutes}m` : t("audio_player.sleep", "Sleep")}
          </button>
          <button
            className={styles.quickBtn}
            onClick={() => setBookmarkOpen(true)}
          >
            <Bookmark size={14} />
            {t("audio_player.bookmark", "Mark")}
          </button>
        </div>
      </div>

      {/* Chapter List */}
      <div className={styles.chapterSection}>
        <div className={styles.chapterHeader}>
          <span className={styles.chapterTitle}>{t("audio_player.chapters", "Chapters")}</span>
          <span className={styles.chapterCount}>
            {chapters.length} {t("audio_player.total", "TOTAL")}
          </span>
        </div>
        <div className={styles.chapterList}>
          {chapters.map((chapter, index) => {
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
                  <span className={styles.chapterNumber}>{index + 1}</span>
                )}
                <span className={styles.chapterName}>{chapter.title || `Chapter ${index + 1}`}</span>
                {chapter.duration != null && (
                  <span className={styles.chapterDuration}>{formatDuration(chapter.duration)}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.syncDot} />
        <span className={styles.syncText}>{t("audio_player.synced", "SYNCED WITH KUMIHO")}</span>
      </div>

      {/* Modals */}
      <AudioSleepTimer
        isOpen={sleepTimerOpen}
        onClose={() => setSleepTimerOpen(false)}
      />
      <AudioBookmarkList
        isOpen={bookmarkOpen}
        onClose={() => setBookmarkOpen(false)}
      />
      <AudioSpeedSelector
        isOpen={speedOpen}
        onClose={() => setSpeedOpen(false)}
      />
    </div>
  );
}
