interface FullscreenSwitchState {
  isChapterSwitching: boolean;
  shouldRestoreFullscreenAfterSwitch: boolean;
}

const CHAPTER_SWITCH_TTL_MS = 15_000;

let state: FullscreenSwitchState = {
  isChapterSwitching: false,
  shouldRestoreFullscreenAfterSwitch: false,
};

let chapterSwitchTimeoutId: ReturnType<typeof setTimeout> | null = null;

export const startChapterSwitching = (shouldRestoreFullscreen: boolean) => {
  if (chapterSwitchTimeoutId !== null) {
    clearTimeout(chapterSwitchTimeoutId);
    chapterSwitchTimeoutId = null;
  }

  state = {
    isChapterSwitching: true,
    shouldRestoreFullscreenAfterSwitch: shouldRestoreFullscreen,
  };

  chapterSwitchTimeoutId = setTimeout(() => {
    if (state.isChapterSwitching) {
      finishChapterSwitching();
    }
  }, CHAPTER_SWITCH_TTL_MS);
};

export const finishChapterSwitching = () => {
  if (chapterSwitchTimeoutId !== null) {
    clearTimeout(chapterSwitchTimeoutId);
    chapterSwitchTimeoutId = null;
  }

  state = {
    isChapterSwitching: false,
    shouldRestoreFullscreenAfterSwitch: false,
  };
};

export const getFullscreenSwitchState = (): Readonly<FullscreenSwitchState> => ({ ...state });
