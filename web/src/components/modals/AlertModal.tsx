import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle, Info, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import styles from "./AlertModal.module.css";

export type AlertType = "success" | "error" | "warning" | "info";

interface AlertModalProps {
  isOpen: boolean;
  type?: AlertType;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

const colorMap = {
  success: "#48bb78",
  error: "#f56565",
  warning: "#ed8936",
  info: "#667eea",
};

export function AlertModal({
  isOpen,
  type = "info",
  title,
  message,
  confirmText,
  cancelText,
  showCancel = false,
  onConfirm,
  onCancel,
}: AlertModalProps) {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsProcessing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const effectiveConfirmText = confirmText || t("common.confirm");
  const effectiveCancelText = cancelText || t("common.cancel");

  const Icon = iconMap[type];
  const color = colorMap[type];

  const handleConfirmClick = async () => {
    if (isProcessing) return;

    try {
      setIsProcessing(true);
      await onConfirm();
    } catch (error) {
      console.error("AlertModal onConfirm failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isProcessing) return;

    if (e.target === e.currentTarget) {
      if (showCancel && onCancel) {
        onCancel();
      } else {
        void handleConfirmClick();
      }
    }
  };

  return createPortal(
    <div
      className={styles.alertModalOverlay}
      onClick={handleBackdropClick}
    >
      <div className={styles.alertModalContent}>
        <div
          className={styles.alertModalIcon}
          style={{ color }}
        >
          <Icon size={48} />
        </div>

        {title && <h3 className={styles.alertModalTitle}>{title}</h3>}
        <p className={styles.alertModalMessage}>{message}</p>

        <div className={styles.alertModalActions}>
          {showCancel && (
            <button
              className={`${styles.alertModalBtn} ${styles.btnCancel}`}
              onClick={onCancel}
              disabled={isProcessing}
            >
              {effectiveCancelText}
            </button>
          )}
          <button
            className={`${styles.alertModalBtn} ${styles.btnConfirm}`}
            style={{ backgroundColor: color }}
            onClick={() => {
              void handleConfirmClick();
            }}
            disabled={isProcessing}
          >
            {effectiveConfirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
