import { Play, Pause, X, Rewind, FastForward, Volume2, VolumeX, Music } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { AudioProgressBar } from "../AudioProgressBar/AudioProgressBar";
import styles from "./AudioMiniPlayer.module.css";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioMiniPlayer() {
  const playerMode = useAudioPlayerStore((s) => s.playerMode);
  const status = useAudioPlayerStore((s) => s.status);
  const currentSeries = useAudioPlayerStore((s) => s.currentSeries);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const currentTime = useAudioPlayerStore((s) => s.currentTime);
  const duration = useAudioPlayerStore((s) => s.duration);
  const volume = useAudioPlayerStore((s) => s.settings.volume);
  const isMuted = useAudioPlayerStore((s) => s.settings.isMuted);
  const skipBackwardSec = useAudioPlayerStore((s) => s.settings.skipBackwardSec);
  const skipForwardSec = useAudioPlayerStore((s) => s.settings.skipForwardSec);
  const togglePlay = useAudioPlayerStore((s) => s.togglePlay);
  const skipBackward = useAudioPlayerStore((s) => s.skipBackward);
  const skipForward = useAudioPlayerStore((s) => s.skipForward);
  const setPlayerMode = useAudioPlayerStore((s) => s.setPlayerMode);
  const setVolume = useAudioPlayerStore((s) => s.setVolume);
  const toggleMute = useAudioPlayerStore((s) => s.toggleMute);
  const close = useAudioPlayerStore((s) => s.close);

  if (playerMode !== "mini" || status === "idle") return null;

  const isPlaying = status === "playing";
  const thumbnailUrl = currentSeries?.thumbnail_url;
  const title = currentSeries?.title || "";
  const chapterTitle = currentChapter?.title || `Chapter ${currentChapter?.chapter_number ?? ""}`;

  const handleExpand = () => {
    setPlayerMode("fullscreen");
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  return (
    <div className={styles.miniPlayer}>
      <div className={styles.main}>
        {/* Cover + Info (clickable to expand) */}
        <div className={styles.coverArea} onClick={handleExpand}>
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt={title} className={styles.cover} />
          ) : (
            <div className={styles.coverPlaceholder}>
              <Music size={20} />
            </div>
          )}
        </div>

        <div className={styles.info} onClick={handleExpand}>
          <div className={styles.title}>{title}</div>
          <div className={styles.subtitle}>{chapterTitle}</div>
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={skipBackward}
            aria-label={`Skip backward ${skipBackwardSec}s`}
          >
            <Rewind size={18} />
          </button>
          <button
            className={`${styles.actionBtn} ${styles.playBtn}`}
            onClick={togglePlay}
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button
            className={styles.actionBtn}
            onClick={skipForward}
            aria-label={`Skip forward ${skipForwardSec}s`}
          >
            <FastForward size={18} />
          </button>

          {/* Volume (desktop only) */}
          <div className={styles.volumeGroup}>
            <button className={styles.actionBtn} onClick={toggleMute} aria-label="Toggle mute">
              {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              className={styles.volumeSlider}
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
            />
          </div>

          <button
            className={`${styles.actionBtn} ${styles.closeBtn}`}
            onClick={close}
            aria-label="Close player"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className={styles.progressRow}>
        <div className={styles.progressBarWrapper}>
          <AudioProgressBar variant="mini" showTime={false} />
        </div>
        <span className={styles.timeLabel}>{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
    </div>
  );
}
