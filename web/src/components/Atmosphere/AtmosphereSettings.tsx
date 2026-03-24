import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Sparkles, Music, Timer, Volume2 } from "lucide-react";
import { useAtmosphereStore } from "../../stores/atmosphereStore";
import { AMBIENT_TRACKS } from "../../constants/ambientTracks";
import styles from "./AtmosphereSettings.module.css";

interface AtmosphereSettingsProps {
  showTitle?: boolean;
}

export function AtmosphereSettings({ showTitle = true }: AtmosphereSettingsProps) {
  const { t } = useTranslation();
  const atmosphere = useAtmosphereStore(
    useShallow((s) => ({
      isEnabled: s.isEnabled,
      selectedTrackId: s.selectedTrackId,
      volume: s.volume,
      timerMinutes: s.timerMinutes,
      timerEndAt: s.timerEndAt,
      suppressedBy: s.suppressedBy,
      setEnabled: s.setEnabled,
      setSelectedTrackId: s.setSelectedTrackId,
      setVolume: s.setVolume,
      setTimer: s.setTimer,
    })),
  );

  const atmosphereSuppressed = Object.values(atmosphere.suppressedBy).some(Boolean);

  const [timerSnapshot, setTimerSnapshot] = useState<{ timerEndAt: number; remaining: number } | null>(null);

  useEffect(() => {
    if (atmosphere.timerEndAt === null) {
      return;
    }

    const timerEndAt = atmosphere.timerEndAt;

    const update = () => {
      setTimerSnapshot({
        timerEndAt,
        remaining: Math.max(0, Math.ceil((timerEndAt - Date.now()) / (60 * 1000))),
      });
    };

    update();
    const intervalId = setInterval(update, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [atmosphere.timerEndAt]);

  return (
    <div className={styles.atmosphereSection}>
      <div className={`${styles.atmosphereHeader} ${atmosphere.isEnabled ? styles.hasControls : ""}`}>
        {showTitle && (
          <span className={styles.atmosphereTitle}>
            <Sparkles size={14} /> {t("header.atmosphere_title")}
          </span>
        )}
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={atmosphere.isEnabled}
            onChange={(e) => {
              const checked = e.target.checked;
              atmosphere.setEnabled(checked);
              if (!checked) {
                atmosphere.setTimer(null);
              }
            }}
            aria-label={t("header.atmosphere_title")}
          />
          <span className={styles.slider} />
        </label>
      </div>

      {atmosphere.isEnabled && (
        <div className={styles.atmosphereControls}>
          <div className={styles.atmosphereRow}>
            <Music size={14} />
            <select
              className={styles.atmosphereSelect}
              value={atmosphere.selectedTrackId}
              onChange={(e) => atmosphere.setSelectedTrackId(e.target.value)}
              aria-label={t("header.atmosphere_track_select")}
            >
              {AMBIENT_TRACKS.map((track) => (
                <option
                  key={track.id}
                  value={track.id}
                >
                  {t(`header.atmosphere_tracks.${track.id}`)}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.atmosphereRow}>
            <Timer size={14} />
            <select
              className={styles.timerSelect}
              value={atmosphere.timerMinutes || ""}
              aria-label={t("header.atmosphere_timer")}
              onChange={(e) => {
                const val = e.target.value;
                atmosphere.setTimer(val ? parseInt(val, 10) : null);
              }}
            >
              <option value="">{t("header.atmosphere_timer_off")}</option>
              <option value="15">{t("header.atmosphere_timer_15")}</option>
              <option value="30">{t("header.atmosphere_timer_30")}</option>
              <option value="60">{t("header.atmosphere_timer_60")}</option>
            </select>
            {atmosphere.timerEndAt !== null &&
              timerSnapshot?.timerEndAt === atmosphere.timerEndAt &&
              timerSnapshot.remaining > 0 && (
                <span className={styles.timerDisplay}>
                  {t("header.atmosphere_timer_remaining", {
                    minutes: timerSnapshot.remaining,
                  })}
                </span>
              )}
          </div>

          <div className={styles.atmosphereRow}>
            <Volume2 size={14} />
            <div className={styles.atmosphereVolume}>
              <input
                type="range"
                className={styles.volumeSlider}
                min="0"
                max="1"
                step="0.01"
                value={atmosphere.volume}
                aria-label={t("header.atmosphere_volume")}
                aria-valuetext={`${Math.round(atmosphere.volume * 100)}%`}
                onChange={(e) => atmosphere.setVolume(parseFloat(e.target.value))}
              />
            </div>
          </div>

          {atmosphereSuppressed && <div className={styles.suppressedNotice}>{t("header.atmosphere_suppressed")}</div>}
        </div>
      )}
    </div>
  );
}
