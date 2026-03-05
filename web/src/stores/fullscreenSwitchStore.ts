interface FullscreenSwitchState {
  isChapterSwitching: boolean;
  shouldRestoreFullscreenAfterSwitch: boolean;
}

let state: FullscreenSwitchState = {
  isChapterSwitching: false,
  shouldRestoreFullscreenAfterSwitch: false,
};

export const startChapterSwitching = (shouldRestoreFullscreen: boolean) => {
  state = {
    isChapterSwitching: true,
    shouldRestoreFullscreenAfterSwitch: shouldRestoreFullscreen,
  };
};

export const finishChapterSwitching = () => {
  state = {
    isChapterSwitching: false,
    shouldRestoreFullscreenAfterSwitch: false,
  };
};

export const getFullscreenSwitchState = (): Readonly<FullscreenSwitchState> => ({ ...state });
