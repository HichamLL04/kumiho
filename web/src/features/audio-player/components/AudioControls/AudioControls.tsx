import { Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import styles from "./AudioControls.module.css";

interface AudioControlsProps {
  variant?: "fullscreen" | "mini" | "sidebar";
  showChapterNav?: boolean;
}

export function AudioControls({ variant = "fullscreen", showChapterNav = true }: AudioControlsProps) {
  const status = useAudioPlayerStore((s) => s.status);
  const chapters = useAudioPlayerStore((s) => s.chapters);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const currentTime = useAudioPlayerStore((s) => s.currentTime);
  const skipBackwardSec = useAudioPlayerStore((s) => s.settings.skipBackwardSec);
  const skipForwardSec = useAudioPlayerStore((s) => s.settings.skipForwardSec);
  const togglePlay = useAudioPlayerStore((s) => s.togglePlay);
  const skipBackward = useAudioPlayerStore((s) => s.skipBackward);
  const skipForward = useAudioPlayerStore((s) => s.skipForward);
  const prevChapter = useAudioPlayerStore((s) => s.prevChapter);
  const nextChapter = useAudioPlayerStore((s) => s.nextChapter);

  const isPlaying = status === "playing";
  const isLoading = status === "loading";

  const currentIndex = currentChapter ? chapters.findIndex((c) => c.id === currentChapter.id) : -1;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < chapters.length - 1;

  const playIconSize = variant === "fullscreen" ? 36 : variant === "sidebar" ? 30 : 24;
  const iconSize = variant === "fullscreen" ? 30 : variant === "sidebar" ? 26 : 20;
  const navIconSize = variant === "fullscreen" ? 24 : variant === "sidebar" ? 22 : 18;

  const containerClass = `${styles.controls} ${variant === "mini" ? styles.mini : variant === "sidebar" ? styles.sidebar : ""}`;

  return (
    <div className={containerClass}>
      {/* Skip Backward */}
      <button
        className={styles.controlBtn}
        onClick={skipBackward}
        disabled={isLoading}
        aria-label={`Skip backward ${skipBackwardSec}s`}
      >
        <RotateCcw size={iconSize} />
        <span className={styles.skipLabel}>{skipBackwardSec}</span>
      </button>

      {/* Previous Chapter */}
      {showChapterNav && (
        <button
          className={styles.controlBtn}
          onClick={prevChapter}
          disabled={isLoading || (!hasPrev && currentTime <= 3)}
          aria-label="Previous chapter"
        >
          <SkipBack size={navIconSize} />
        </button>
      )}

      {/* Play/Pause */}
      <button
        className={`${styles.controlBtn} ${styles.playBtn}`}
        onClick={togglePlay}
        disabled={isLoading}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause
            size={playIconSize}
            fill="currentColor"
          />
        ) : (
          <Play
            size={playIconSize}
            fill="currentColor"
          />
        )}
      </button>

      {/* Next Chapter */}
      {showChapterNav && (
        <button
          className={styles.controlBtn}
          onClick={nextChapter}
          disabled={isLoading || !hasNext}
          aria-label="Next chapter"
        >
          <SkipForward size={navIconSize} />
        </button>
      )}

      {/* Skip Forward */}
      <button
        className={styles.controlBtn}
        onClick={skipForward}
        disabled={isLoading}
        aria-label={`Skip forward ${skipForwardSec}s`}
      >
        <RotateCw size={iconSize} />
        <span className={styles.skipLabel}>{skipForwardSec}</span>
      </button>
    </div>
  );
}
