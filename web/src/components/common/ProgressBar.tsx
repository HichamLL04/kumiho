import styles from "./ProgressBar.module.css";

interface ProgressProps {
  value: number;
  max?: number;
  height?: number;
  color?: string;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

export function ProgressBar({ value, max = 100, height = 4, color, className, ariaLabel, ariaLabelledBy }: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      className={`${styles.progressContainer} ${className || ""}`}
      style={{ height: `${height}px` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(max, Math.max(0, value))}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
    >
      <div
        className={styles.progressFill}
        style={{
          width: `${percentage}%`,
          backgroundColor: color || "var(--accent-color, #3b82f6)",
        }}
      />
    </div>
  );
}
