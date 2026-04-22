export const LIBRARY_DELETE_ERROR_CODES = {
  activeScan: "library_delete_active_scan",
  busy: "library_delete_busy",
} as const;

type Translate = (key: string) => string;

export interface LibraryDeleteErrorResponse {
  response?: {
    data?: {
      error?: string;
      error_code?: string;
    };
  };
}

export function getLibraryDeleteErrorMessage(error: unknown, t: Translate): string {
  const err = error as LibraryDeleteErrorResponse;
  const errorCode = err.response?.data?.error_code;
  if (errorCode === LIBRARY_DELETE_ERROR_CODES.activeScan) {
    return t("settings.libraries.toast.delete_failed_active_scan");
  }
  if (errorCode === LIBRARY_DELETE_ERROR_CODES.busy) {
    return t("settings.libraries.toast.delete_failed_busy");
  }
  return err.response?.data?.error || t("settings.libraries.toast.delete_failed");
}
