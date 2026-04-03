import styles from "./UpdateBadge.module.css";

interface UpdateBadgeProps {
  className?: string;
  size?: "sm" | "md";
  label?: string;
  ariaLabel?: string;
  ariaLive?: "off" | "polite" | "assertive";
}

export function UpdateBadge({
  className = "",
  size = "md",
  label = "UP",
  ariaLabel,
  ariaLive,
}: UpdateBadgeProps) {
  return (
    <span
      className={[styles.updateBadge, styles[size], className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      aria-live={ariaLive}
      aria-atomic={ariaLive ? "true" : undefined}
      title={ariaLabel}
    >
      {label}
    </span>
  );
}
