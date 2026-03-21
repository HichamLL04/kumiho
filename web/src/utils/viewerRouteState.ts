export interface ViewerRouteState {
  from?: string;
  isIncognito?: true;
  preventComplete?: true;
  skipSyncCheck?: true;
}

interface BuildViewerRouteStateOptions {
  from?: string;
  isIncognito?: boolean;
  preventComplete?: boolean;
  skipSyncCheck?: boolean;
}

export const buildViewerRouteState = ({
  from,
  isIncognito = false,
  preventComplete = false,
  skipSyncCheck = false,
}: BuildViewerRouteStateOptions): ViewerRouteState | undefined => {
  const state: ViewerRouteState = {};

  if (from) {
    state.from = from;
  }
  if (isIncognito) {
    state.isIncognito = true;
  }
  if (preventComplete) {
    state.preventComplete = true;
  }
  if (skipSyncCheck) {
    state.skipSyncCheck = true;
  }

  return Object.keys(state).length > 0 ? state : undefined;
};
