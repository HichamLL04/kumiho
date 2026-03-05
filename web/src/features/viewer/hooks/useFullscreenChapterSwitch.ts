import { useEffect } from "react";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../../../utils/fullscreen";
import { finishChapterSwitching, getFullscreenSwitchState } from "../../../stores/fullscreenSwitchStore";

export function useExitFullscreenOnViewerUnmount() {
  useEffect(() => {
    return () => {
      const { isChapterSwitching } = getFullscreenSwitchState();
      if (isDocumentFullscreen() && !isChapterSwitching) {
        exitFullscreen().catch(() => {});
      }
    };
  }, []);
}

export function useRestoreFullscreenAfterChapterSwitch(chapterId: string | undefined) {
  useEffect(() => {
    if (!chapterId) {
      if (getFullscreenSwitchState().isChapterSwitching) {
        finishChapterSwitching();
      }
      return;
    }

    const timer = window.setTimeout(() => {
      const state = getFullscreenSwitchState();
      if (!state.isChapterSwitching) return;

      const maybeRestore =
        state.shouldRestoreFullscreenAfterSwitch && !isDocumentFullscreen() ? enterFullscreen().catch(() => {}) : null;

      Promise.resolve(maybeRestore).finally(() => {
        finishChapterSwitching();
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [chapterId]);
}

