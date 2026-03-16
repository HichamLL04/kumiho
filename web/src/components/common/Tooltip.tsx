import React, { type ReactNode } from "react";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  children: ReactNode;
  content: string;
  className?: string;
  position?: "top" | "bottom" | "left" | "right";
}

export const Tooltip: React.FC<TooltipProps> = ({ children, content, className = "", position = "top" }) => {
  if (!content) return <>{children}</>;

  return (
    <div
      className={`${styles.tooltipContainer} ${className}`}
      data-tooltip={content}
      data-position={position}
    >
      {children}
      <span
        className={styles.tooltipText}
        aria-hidden="true"
      >
        {content}
      </span>
    </div>
  );
};
