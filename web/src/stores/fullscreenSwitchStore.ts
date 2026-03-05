import { create } from "zustand";
import { exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";

interface FullscreenSwitchState {
  isChapterSwitching: boolean;
  shouldRestoreFullscreenAfterSwitch: boolean;
}

interface FullscreenSwitchStore extends FullscreenSwitchState {
  startChapterSwitching: (shouldRestoreFullscreen: boolean) => void;
  finishChapterSwitching: () => void;
}

const CHAPTER_SWITCH_TTL_MS = 15_000;

let chapterSwitchTimeoutId: ReturnType<typeof setTimeout> | null = null;

export const useFullscreenSwitchStore = create<FullscreenSwitchStore>((set, get) => ({
  isChapterSwitching: false,
  shouldRestoreFullscreenAfterSwitch: false,
  startChapterSwitching: (shouldRestoreFullscreen: boolean) => {
    if (chapterSwitchTimeoutId !== null) {
      clearTimeout(chapterSwitchTimeoutId);
      chapterSwitchTimeoutId = null;
    }

    set({
      isChapterSwitching: true,
      shouldRestoreFullscreenAfterSwitch: shouldRestoreFullscreen,
    });

    chapterSwitchTimeoutId = setTimeout(() => {
      const { isChapterSwitching } = get();
      if (isChapterSwitching) {
        get().finishChapterSwitching();
        if (isDocumentFullscreen()) {
          exitFullscreen().catch(() => {});
        }
      }
    }, CHAPTER_SWITCH_TTL_MS);
  },
  finishChapterSwitching: () => {
    if (chapterSwitchTimeoutId !== null) {
      clearTimeout(chapterSwitchTimeoutId);
      chapterSwitchTimeoutId = null;
    }

    set({
      isChapterSwitching: false,
      shouldRestoreFullscreenAfterSwitch: false,
    });
  },
}));

export const startChapterSwitching = (shouldRestoreFullscreen: boolean) => {
  useFullscreenSwitchStore.getState().startChapterSwitching(shouldRestoreFullscreen);
};

export const finishChapterSwitching = () => {
  useFullscreenSwitchStore.getState().finishChapterSwitching();
};

export const getFullscreenSwitchState = (): Readonly<FullscreenSwitchState> => {
  const { isChapterSwitching, shouldRestoreFullscreenAfterSwitch } = useFullscreenSwitchStore.getState();
  return {
    isChapterSwitching,
    shouldRestoreFullscreenAfterSwitch,
  };
};
