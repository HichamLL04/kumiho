import { useEffect, useRef } from "react";
import { Check, AlertCircle, Info } from "lucide-react";
import styles from "./Toast.module.css";

export interface ToastProps {
  type: "success" | "error" | "info";
  message: string;
  onClose: () => void;
  duration?: number;
  anchored?: boolean;
  inline?: boolean;
  sticky?: boolean;
}

export function Toast({ type, message, onClose, duration = 2000, anchored = false, inline = false, sticky = false }: ToastProps) {
  const onCloseRef = useRef(onClose);
  const variantCount = Number(anchored) + Number(inline) + Number(sticky);
  const resolvedAnchored = anchored && variantCount === 1;
  const resolvedInline = inline && variantCount === 1;
  const resolvedSticky = sticky || variantCount > 1;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, type, message]);

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      className={`${styles.statusMessage} ${
        type === "success" ? styles.success : type === "info" ? styles.info : styles.error
      } ${resolvedAnchored ? styles.anchored : ""} ${resolvedInline ? styles.inline : ""} ${resolvedSticky ? styles.sticky : ""}`}
      onClick={onClose}
    >
      {type === "success" ? <Check size={14} /> : type === "info" ? <Info size={14} /> : <AlertCircle size={14} />}
      {message}
    </div>
  );
}
