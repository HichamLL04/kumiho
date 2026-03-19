import { useTranslation } from "react-i18next";
import { useId, useEffect } from "react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import styles from "./AudioSpeedSelector.module.css";

interface AudioSpeedSelectorProps {
  isOpen: boolean;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function AudioSpeedSelector({ isOpen, onClose }: AudioSpeedSelectorProps) {
  const { t } = useTranslation();
  const playbackRate = useAudioPlayerStore((s) => s.settings.playbackRate);
  const setPlaybackRate = useAudioPlayerStore((s) => s.setPlaybackRate);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelect = (speed: number) => {
    setPlaybackRate(speed);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className={styles.title}
          id={titleId}
        >
          {t("audio_player.playback_speed", "Playback Speed")}
        </div>

        <div className={styles.options}>
          {SPEED_OPTIONS.map((speed) => (
            <button
              key={speed}
              className={`${styles.option} ${playbackRate === speed ? styles.optionActive : ""}`}
              onClick={() => handleSelect(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        <button className={styles.cancelBtn} onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}
