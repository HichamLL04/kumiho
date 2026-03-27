import styles from "./UpdateBadge.module.css";

interface UpdateBadgeProps {
  className?: string;
  size?: "sm" | "md";
  label?: string;
}

export function UpdateBadge({ className = "", size = "md", label = "UP" }: UpdateBadgeProps) {
  return <span className={[styles.updateBadge, styles[size], className].filter(Boolean).join(" ")}>{label}</span>;
}
