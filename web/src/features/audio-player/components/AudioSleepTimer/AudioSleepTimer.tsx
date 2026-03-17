import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import styles from "./AudioSleepTimer.module.css";

interface AudioSleepTimerProps {
  isOpen: boolean;
  onClose: () => void;
}

const TIMER_OPTIONS = [15, 30, 45, 60, 90];

export function AudioSleepTimer({ isOpen, onClose }: AudioSleepTimerProps) {
  const { t } = useTranslation();
  const sleepTimerMinutes = useAudioPlayerStore((s) => s.sleepTimerMinutes);
  const sleepTimerEndTime = useAudioPlayerStore((s) => s.sleepTimerEndTime);
  const setSleepTimer = useAudioPlayerStore((s) => s.setSleepTimer);
  const clearSleepTimer = useAudioPlayerStore((s) => s.clearSleepTimer);

  const [remainingText, setRemainingText] = useState("");

  useEffect(() => {
    if (!sleepTimerEndTime) {
      setRemainingText("");
      return;
    }

    const update = () => {
      const remaining = Math.max(0, sleepTimerEndTime - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setRemainingText(`${mins}:${secs.toString().padStart(2, "0")}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEndTime]);

  if (!isOpen) return null;

  const handleSelect = (minutes: number) => {
    setSleepTimer(minutes);
    onClose();
  };

  const handleClear = () => {
    clearSleepTimer();
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.title}>
          {t("audio_player.sleep_timer", "Sleep Timer")}
        </div>

        <div className={styles.options}>
          {TIMER_OPTIONS.map((mins) => (
            <button
              key={mins}
              className={`${styles.option} ${sleepTimerMinutes === mins ? styles.optionActive : ""}`}
              onClick={() => handleSelect(mins)}
            >
              <span>
                {t("audio_player.sleep_timer_minutes", "{{count}} minutes", { count: mins })}
              </span>
              {sleepTimerMinutes === mins && (
                <Check size={18} className={styles.optionCheck} />
              )}
            </button>
          ))}
        </div>

        {sleepTimerEndTime && remainingText && (
          <div className={styles.remaining}>
            {t("audio_player.sleep_timer_remaining", "Remaining: {{time}}", { time: remainingText })}
          </div>
        )}

        {sleepTimerMinutes && (
          <button className={styles.cancelBtn} onClick={handleClear}>
            {t("audio_player.sleep_timer_off", "Turn Off Timer")}
          </button>
        )}

        <button className={styles.cancelBtn} onClick={onClose}>
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}
