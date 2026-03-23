import { useEffect, useRef } from "react";
import { AtmosphereSettings } from "../../../../components/Atmosphere/AtmosphereSettings";
import styles from "./AtmospherePopover.module.css";

interface AtmospherePopoverProps {
  onClose: () => void;
}

export function AtmospherePopover({ onClose }: AtmospherePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside, { capture: true });
    return () => document.removeEventListener("mousedown", handleClickOutside, { capture: true });
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
