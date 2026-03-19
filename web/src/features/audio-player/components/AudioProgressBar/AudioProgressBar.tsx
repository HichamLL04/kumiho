import { useRef, useState, useCallback } from "react";
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

  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPercent, setDragPercent] = useState(0);

  const clampedCurrentTime = Math.max(0, Math.min(currentTime, duration > 0 ? duration : currentTime));
  const percent = isDragging ? dragPercent : duration > 0 ? Math.max(0, Math.min(100, (clampedCurrentTime / duration) * 100)) : 0;
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
      setIsDragging(false);
      const pct = getPercentFromEvent(e.clientX);
      const time = (pct / 100) * duration;
      seekTo(time);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [isDragging, getPercentFromEvent, duration, seekTo],
  );

  const containerClass = `${styles.container} ${variant === "mini" ? styles.mini : ""} ${isDragging ? styles.dragging : ""}`;

  return (
    <div className={containerClass}>
      <div
        ref={trackRef}
        className={styles.trackWrapper}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${percent}%` }} />
          <div className={styles.thumb} style={{ left: `${percent}%` }} />
        </div>
      </div>
      {showTime && (
        <div className={styles.timeRow}>
          <span className={styles.time}>{formatDuration(clampedCurrentTime)}</span>
          <span className={styles.time}>-{formatDuration(remaining)}</span>
        </div>
      )}
    </div>
  );
}
