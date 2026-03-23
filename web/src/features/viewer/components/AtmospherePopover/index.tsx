import { useEffect, useRef } from "react";
import { AtmosphereSettings } from "../../../../components/Atmosphere/AtmosphereSettings";
import styles from "./AtmospherePopover.module.css";

interface AtmospherePopoverProps {
  onClose: () => void;
}

export function AtmospherePopover({ onClose }: AtmospherePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
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

    document.addEventListener("mousedown", handleClickOutside, { capture: true });
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, { capture: true });
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [onClose]);

  return (
    <div
      className={styles.popover}
      ref={ref}
    >
      <AtmosphereSettings showTitle={true} />
    </div>
  );
}
