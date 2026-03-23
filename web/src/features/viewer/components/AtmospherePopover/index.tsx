import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AtmosphereSettings } from "../../../../components/Atmosphere/AtmosphereSettings";
import styles from "./AtmospherePopover.module.css";

interface AtmospherePopoverProps {
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
}

export function AtmospherePopover({ onClose, triggerRef }: AtmospherePopoverProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const triggerElement = triggerRef.current;

    const handleClickOutside = (event: MouseEvent | PointerEvent) => {
      const popoverElement = ref.current;
      const target = event.target as Node | null;

      if (!target) {
        return;
      }

      if (triggerElement && triggerElement.contains(target)) {
        return;
      }

      if (popoverElement && !popoverElement.contains(target)) {
        onClose();
      }
    };

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" || event.key === "Esc") {
        // 팝오버가 열려 있을 때 ESC를 누르면 전역 뒤로가기/전체화면 종료가
        // 실행되지 않도록 캡처 단계에서 이벤트 전파를 막고 팝오버를 닫는다.
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();
        onClose();
      }
    }

    const firstFocusable = ref.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    firstFocusable?.focus();

    document.addEventListener("mousedown", handleClickOutside, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });

      const restoreTarget = triggerElement ?? previousActiveElement;
      restoreTarget?.focus();
    };
  }, [onClose, triggerRef]);

  return (
    <div
      className={styles.popover}
      ref={ref}
      role="dialog"
      aria-label={t("viewer.header.atmosphere_settings_dialog")}
    >
      <AtmosphereSettings showTitle={true} />
    </div>
  );
}
