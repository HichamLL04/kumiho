import { useEffect, useRef, useMemo } from "react";
import { X, Volume2, VolumeX, Music } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { AudioProgressBar } from "../AudioProgressBar/AudioProgressBar";
import { AudioVisualizer } from "../AudioVisualizer/AudioVisualizer";
import { AudioControls } from "../AudioControls/AudioControls";
import { getAuthenticatedImageUrl } from "../../../../utils/image";
import { formatDuration } from "../../../../utils/progressUtils";
import styles from "./AudioMiniPlayer.module.css";

export function AudioMiniPlayer() {
  const playerMode = useAudioPlayerStore((s) => s.playerMode);
  const status = useAudioPlayerStore((s) => s.status);
  const currentSeries = useAudioPlayerStore((s) => s.currentSeries);
  const currentChapter = useAudioPlayerStore((s) => s.currentChapter);
  const currentTime = useAudioPlayerStore((s) => s.currentTime);
  const duration = useAudioPlayerStore((s) => s.duration);
  const volume = useAudioPlayerStore((s) => s.settings.volume);
  const isMuted = useAudioPlayerStore((s) => s.settings.isMuted);
  const setPlayerMode = useAudioPlayerStore((s) => s.setPlayerMode);
  const setVolume = useAudioPlayerStore((s) => s.setVolume);
  const toggleMute = useAudioPlayerStore((s) => s.toggleMute);
  const close = useAudioPlayerStore((s) => s.close);
  const containerRef = useRef<HTMLDivElement>(null);
  const volumeGroupRef = useRef<HTMLDivElement>(null);
  const volumeValueRef = useRef(volume);

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

  const isVisible = playerMode === "mini" && status !== "idle";

  // 미니 플레이어 높이를 CSS 변수로 설정하여 body padding-bottom에 반영
  useEffect(() => {
    if (!isVisible) {
      document.documentElement.style.setProperty("--mini-player-height", "0px");
      return;
    }

    const updateHeight = () => {
      if (containerRef.current) {
        const height = containerRef.current.offsetHeight;
        document.documentElement.style.setProperty("--mini-player-height", `${height}px`);
      }
    };

    // 렌더링 후 높이 측정
    requestAnimationFrame(updateHeight);

    return () => {
      document.documentElement.style.setProperty("--mini-player-height", "0px");
    };
  }, [isVisible]);

  useEffect(() => {
    volumeValueRef.current = volume;
  }, [volume]);

  // Handle wheel events with non-passive listener to block page scroll
  useEffect(() => {
    const el = volumeGroupRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const nextVolume = Math.min(1, Math.max(0, volumeValueRef.current + delta));
      volumeValueRef.current = nextVolume;
      setVolume(nextVolume);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [setVolume, isVisible]);

  if (!isVisible) return null;

  const isPlaying = status === "playing";
  const title = currentSeries?.title || "";
  const chapterTitle = currentChapter?.title || `Chapter ${currentChapter?.chapter_number ?? ""}`;

  const handleExpand = () => {
    setPlayerMode("fullscreen");
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  return (
    <div
      className={styles.miniPlayer}
      ref={containerRef}
    >
      <div className={styles.main}>
        {/* Cover + Info (clickable to expand) */}
        <button
          type="button"
          className={styles.coverArea}
          onClick={handleExpand}
          aria-label="Expand player"
        >
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              className={styles.cover}
            />
          ) : (
            <div className={styles.coverPlaceholder}>
              <Music size={20} />
            </div>
          )}
        </button>

        <button
          type="button"
          className={styles.info}
          onClick={handleExpand}
          aria-label="Expand player details"
        >
          <div className={styles.titleWrapper}>
            <div className={styles.title}>{title}</div>
            <AudioVisualizer
              variant="mini"
              isPlaying={isPlaying}
            />
          </div>
          <div className={styles.subtitle}>{chapterTitle}</div>
        </button>

        {/* Actions */}
        <div className={styles.actions}>
          <AudioControls
            variant="mini"
            showChapterNav={false}
          />

          {/* Volume (desktop only) */}
          <div
            className={styles.volumeGroup}
            ref={volumeGroupRef}
          >
            <button
              className={styles.actionBtn}
              onClick={toggleMute}
              aria-label="Toggle mute"
            >
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
              style={{
                background: `linear-gradient(to right, var(--accent-primary) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.15) ${(isMuted ? 0 : volume) * 100}%)`,
              }}
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
          <AudioProgressBar
            variant="mini"
            showTime={false}
          />
        </div>
        <span className={styles.timeLabel}>
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}
