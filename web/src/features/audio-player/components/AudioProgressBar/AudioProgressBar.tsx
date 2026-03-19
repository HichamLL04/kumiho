import { useRef, useState, useCallback, useEffect } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import { formatDuration } from "../../../../utils/progressUtils";
import styles from "./AudioProgressBar.module.css";

interface AudioProgressBarProps {
  variant?: "fullscreen" | "mini";
  showTime?: boolean;
}

export function AudioProgressBar({ variant = "fullscreen", showTime = true }: AudioProgressBarProps) {
  const currentTime = useAudioPlayerStore((s) => s.currentTime);
  const duration = useAudioPlayerStore((s) => s.duration);
  const seekTo = useAudioPlayerStore((s) => s.seekTo);
  const volume = useAudioPlayerStore((s) => s.settings.volume);
  const isMuted = useAudioPlayerStore((s) => s.settings.isMuted);
  const setVolume = useAudioPlayerStore((s) => s.setVolume);
  const toggleMute = useAudioPlayerStore((s) => s.toggleMute);

  const trackRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPercent, setDragPercent] = useState(0);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  const clampedCurrentTime = Math.max(0, Math.min(currentTime, duration > 0 ? duration : currentTime));
  const percent = isDragging
    ? dragPercent
    : duration > 0
      ? Math.max(0, Math.min(100, (clampedCurrentTime / duration) * 100))
      : 0;
  const remaining = Math.max(0, duration - clampedCurrentTime);

  const getPercentFromEvent = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const pct = getPercentFromEvent(e.clientX);
      setIsDragging(true);
      setDragPercent(pct);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [getPercentFromEvent],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const pct = getPercentFromEvent(e.clientX);
      setDragPercent(pct);
    },
    [isDragging, getPercentFromEvent],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const pct = getPercentFromEvent(e.clientX);
      const time = (pct / 100) * duration;
      seekTo(time);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setIsDragging(false);
    },
    [isDragging, getPercentFromEvent, duration, seekTo],
  );

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsDragging(false);
  }, []);

  const handleLostPointerCapture = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (volumeRef.current && !volumeRef.current.contains(event.target as Node)) {
        setShowVolumeSlider(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle wheel events with non-passive listener to block page scroll
  useEffect(() => {
    const el = volumeRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setVolume(Math.min(1, Math.max(0, volume + delta)));
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [volume, setVolume, variant]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  const containerClass = `${styles.container} ${variant === "mini" ? styles.mini : ""} ${isDragging ? styles.dragging : ""}`;

  return (
    <div className={containerClass}>
      <div
        ref={trackRef}
        className={styles.trackWrapper}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
      >
        <div className={styles.track}>
          <div
            className={styles.fill}
            style={{ width: `${percent}%` }}
          />
          <div
            className={styles.thumb}
            style={{ left: `${percent}%` }}
          />
        </div>
      </div>

      {showTime && (
        <div className={styles.timeRow}>
          <span className={styles.time}>{formatDuration(clampedCurrentTime)}</span>
          <span className={styles.time}>-{formatDuration(remaining)}</span>
        </div>
      )}

      {variant === "fullscreen" && (
        <div
          className={styles.volumeWrapper}
          ref={volumeRef}
          onMouseEnter={() => setShowVolumeSlider(true)}
          onMouseLeave={() => setShowVolumeSlider(false)}
        >
          {showVolumeSlider && (
            <div className={styles.volumePopover}>
              <div className={styles.volumeSliderContainer}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className={styles.volumeSlider}
                  aria-label="Volume"
                  style={{
                    background: `linear-gradient(to top, var(--accent-primary) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.15) ${(isMuted ? 0 : volume) * 100}%)`,
                  }}
                />
              </div>
            </div>
          )}
          <button
            className={styles.volumeBtn}
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      )}
    </div>
  );
}
