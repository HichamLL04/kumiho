import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import styles from "./AudioSettingsPanel.module.css";

interface AudioSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const BACKWARD_PRESETS = [5, 10, 15, 30, 60];
const FORWARD_PRESETS = [5, 10, 15, 30, 60];

export function AudioSettingsPanel({ isOpen, onClose }: AudioSettingsPanelProps) {
  const { t } = useTranslation();
  const skipBackwardSec = useAudioPlayerStore((s) => s.settings.skipBackwardSec);
  const skipForwardSec = useAudioPlayerStore((s) => s.settings.skipForwardSec);
  const autoPlayNext = useAudioPlayerStore((s) => s.settings.autoPlayNext);
  const volumeBoost = useAudioPlayerStore((s) => s.settings.volumeBoost);

  const setSkipBackwardSec = useAudioPlayerStore((s) => s.setSkipBackwardSec);
  const setSkipForwardSec = useAudioPlayerStore((s) => s.setSkipForwardSec);
  const toggleAutoPlayNext = useAudioPlayerStore((s) => s.toggleAutoPlayNext);
  const toggleVolumeBoost = useAudioPlayerStore((s) => s.toggleVolumeBoost);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
    >
      <div className={styles.panel}>
        {/* 헤더 */}
        <div className={styles.header}>
          <span className={styles.title}>{t("audio_player.settings", "설정")}</span>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* 되감기 시간 */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t("audio_player.skip_backward_time", "되감기 시간")}</div>
          <div className={styles.presetGroup}>
            {BACKWARD_PRESETS.map((sec) => (
              <button
                key={sec}
                className={`${styles.presetBtn} ${skipBackwardSec === sec ? styles.presetBtnActive : ""}`}
                onClick={() => setSkipBackwardSec(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {/* 빨리감기 시간 */}
        <div className={styles.section}>
          <div className={styles.sectionLabel}>{t("audio_player.skip_forward_time", "빨리감기 시간")}</div>
          <div className={styles.presetGroup}>
            {FORWARD_PRESETS.map((sec) => (
              <button
                key={sec}
                className={`${styles.presetBtn} ${skipForwardSec === sec ? styles.presetBtnActive : ""}`}
                onClick={() => setSkipForwardSec(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* 자동 다음 챕터 */}
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <span className={styles.toggleLabel}>{t("audio_player.auto_play_next", "자동 다음 챕터")}</span>
            <span className={styles.toggleDesc}>
              {t("audio_player.auto_play_next_desc", "챕터 종료 시 다음 챕터를 자동으로 재생합니다")}
            </span>
          </div>
          <button
            className={`${styles.toggle} ${autoPlayNext ? styles.toggleActive : ""}`}
            onClick={toggleAutoPlayNext}
            role="switch"
            aria-checked={autoPlayNext}
            aria-label="Toggle auto play next"
          />
        </div>

        <div className={styles.divider} />

        {/* 볼륨 부스트 */}
        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <span className={styles.toggleLabel}>{t("audio_player.volume_boost", "볼륨 부스트")}</span>
            <span className={styles.toggleDesc}>
              {t("audio_player.volume_boost_desc", "소리가 작은 오디오북을 위해 볼륨을 2배로 증폭합니다")}
            </span>
          </div>
          <button
            className={`${styles.toggle} ${volumeBoost ? styles.toggleActive : ""}`}
            onClick={toggleVolumeBoost}
            role="switch"
            aria-checked={volumeBoost}
            aria-label="Toggle volume boost"
          />
        </div>
      </div>
    </div>
  );
}
