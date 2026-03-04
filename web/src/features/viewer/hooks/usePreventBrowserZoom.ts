import { useEffect } from "react";

/**
 * Prevent Safari's native page zoom while viewer is mounted.
 * This avoids UI/header/footer scaling during in-viewer pinch gestures.
 */
export function usePreventBrowserZoom(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventMultiTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });
    document.addEventListener("gestureend", preventGesture, { passive: false });
    document.addEventListener("touchmove", preventMultiTouchMove, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
      document.removeEventListener("gestureend", preventGesture);
      document.removeEventListener("touchmove", preventMultiTouchMove);
    };
  }, [enabled]);
}

