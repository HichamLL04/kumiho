import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAudioPlayerStore } from "../../../../stores/audioPlayerStore";
import styles from "./AudioSleepTimer.module.css";

interface AudioSleepTimerProps {
  isOpen: boolean;
  onClose: () => void;
}

const TIMER_OPTIONS = [15, 30, 45, 60, 90, 120];
const ITEM_HEIGHT = 44;

export function AudioSleepTimer({ isOpen, onClose }: AudioSleepTimerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);

  const sleepTimerMinutes = useAudioPlayerStore((s) => s.sleepTimerMinutes);
  const sleepTimerEndTime = useAudioPlayerStore((s) => s.sleepTimerEndTime);
  const setSleepTimer = useAudioPlayerStore((s) => s.setSleepTimer);
  const clearSleepTimer = useAudioPlayerStore((s) => s.clearSleepTimer);

  const [remainingText, setRemainingText] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = TIMER_OPTIONS.indexOf(sleepTimerMinutes || 30);
    return idx === -1 ? 1 : idx;
  });
  const selectedIndexRef = useRef(selectedIndex);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const syncedIndex = TIMER_OPTIONS.indexOf(sleepTimerMinutes || 30);
    const nextIndex = syncedIndex === -1 ? 1 : syncedIndex;
    const syncTimer = window.setTimeout(() => {
      setSelectedIndex(nextIndex);
    }, 0);
    selectedIndexRef.current = nextIndex;

    const el = containerRef.current;
    if (el) {
      el.scrollTop = nextIndex * ITEM_HEIGHT;
      setScrollTop(el.scrollTop);
    }
    return () => {
      window.clearTimeout(syncTimer);
    };
  }, [isOpen, sleepTimerMinutes]);

  useEffect(() => {
    if (!sleepTimerEndTime) {
      const t = setTimeout(() => setRemainingText(""), 0);
      return () => clearTimeout(t);
    }

    const update = () => {
      const remaining = Math.max(0, sleepTimerEndTime - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setRemainingText(`${mins}:${secs.toString().padStart(2, "0")}`);
    };

    const timeout = setTimeout(update, 0);
    const interval = setInterval(update, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [sleepTimerEndTime]);

  // Initial scroll and event listeners
  useEffect(() => {
    if (!isOpen) return;
    const el = containerRef.current;
    if (!el) return;

    el.scrollTop = selectedIndexRef.current * ITEM_HEIGHT;
    setScrollTop(el.scrollTop);

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isScrollingRef.current || isDraggingRef.current) return;

      const currentIndex = selectedIndexRef.current;
      const direction = e.deltaY > 0 ? 1 : -1;
      const nextIndex = Math.min(Math.max(0, currentIndex + direction), TIMER_OPTIONS.length - 1);

      if (nextIndex !== currentIndex) {
        isScrollingRef.current = true;
        setSelectedIndex(nextIndex);
        el.scrollTo({ top: nextIndex * ITEM_HEIGHT, behavior: "smooth" });

        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          isScrollingRef.current = false;
        }, 250);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const diff = startYRef.current - e.pageY;
      el.scrollTop = startScrollTopRef.current + diff;
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      el.style.scrollSnapType = "y mandatory";
      el.style.cursor = "grab";

      const index = Math.round(el.scrollTop / ITEM_HEIGHT);
      const finalIndex = Math.min(Math.max(0, index), TIMER_OPTIONS.length - 1);
      setSelectedIndex(finalIndex);
      el.scrollTo({ top: finalIndex * ITEM_HEIGHT, behavior: "smooth" });

      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      startYRef.current = e.pageY;
      startScrollTopRef.current = el.scrollTop;
      el.style.scrollSnapType = "none";
      el.style.cursor = "grabbing";

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("mousedown", handleMouseDown);
    el.style.cursor = "grab";

    return () => {
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleScroll = () => {
    if (!containerRef.current) return;
    const currentScroll = containerRef.current.scrollTop;
    setScrollTop(currentScroll);

    if (!isDraggingRef.current && !isScrollingRef.current) {
      const index = Math.round(currentScroll / ITEM_HEIGHT);
      if (index >= 0 && index < TIMER_OPTIONS.length && index !== selectedIndex) {
        setSelectedIndex(index);
      }
    }
  };

  const getOptionStyle = (index: number) => {
    const targetScroll = index * ITEM_HEIGHT;
    const distance = Math.abs(scrollTop - targetScroll);
    const maxVisibleDistance = ITEM_HEIGHT * 2.5;

    const normalizedDistance = Math.min(distance / maxVisibleDistance, 1);

    // Improved 3D curve
    const scale = 1 - Math.pow(normalizedDistance, 2) * 0.3;
    const opacity = 1 - Math.pow(normalizedDistance, 1.5) * 0.8;
    const rotateX = ((scrollTop - targetScroll) / maxVisibleDistance) * 60;
    const translateZ = -Math.pow(normalizedDistance, 2) * 50;

    return {
      transform: `rotateX(${rotateX}deg) scale(${scale}) translateZ(${translateZ}px)`,
      opacity: opacity,
      transition: "transform 0.2s ease-out, opacity 0.2s ease-out",
      userSelect: "none" as const,
    };
  };

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
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
    >
      <div className={styles.modal}>
        <div className={styles.title}>{t("audio_player.sleep_timer", "Sleep Timer")}</div>

        <div className={styles.optionsWrapper}>
          <div className={styles.selectionOverlay}></div>
          <div
            ref={containerRef}
            className={styles.options}
            onScroll={handleScroll}
          >
            <div className={styles.spacer} />
            {TIMER_OPTIONS.map((mins, idx) => (
              <button
                key={mins}
                type="button"
                className={`${styles.option} ${selectedIndex === idx ? styles.optionActive : ""}`}
                style={getOptionStyle(idx)}
                aria-pressed={selectedIndex === idx}
                onClick={() => {
                  setSelectedIndex(idx);
                  containerRef.current?.scrollTo({
                    top: idx * ITEM_HEIGHT,
                    behavior: "smooth",
                  });
                }}
              >
                {t("audio_player.sleep_timer_minutes", "{{count}}분", { count: mins })}
              </button>
            ))}
            <div className={styles.spacer} />
          </div>
        </div>

        {sleepTimerEndTime && remainingText && (
          <div className={styles.remaining}>
            {t("audio_player.sleep_timer_remaining", "Remaining: {{time}}", { time: remainingText })}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <button
            className={styles.cancelBtn}
            style={{ marginTop: 0, background: "var(--accent-primary)", color: "white" }}
            onClick={() => handleSelect(TIMER_OPTIONS[selectedIndex])}
          >
            {t("common.confirm", "Confirm")}
          </button>
          {sleepTimerMinutes && (
            <button
              className={styles.cancelBtn}
              style={{ marginTop: 0 }}
              onClick={handleClear}
            >
              {t("audio_player.sleep_timer_off", "Off")}
            </button>
          )}
        </div>

        <button
          className={styles.cancelBtn}
          onClick={onClose}
        >
          {t("common.cancel", "Cancel")}
        </button>
      </div>
    </div>
  );
}
