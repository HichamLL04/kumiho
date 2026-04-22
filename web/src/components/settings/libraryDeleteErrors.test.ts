import { describe, expect, it } from "vitest";
import { getLibraryDeleteErrorMessage, LIBRARY_DELETE_ERROR_CODES } from "./libraryDeleteErrors";

const t = (key: string) => key;

describe("getLibraryDeleteErrorMessage", () => {
  it("스캔 중 삭제 차단 메시지를 반환한다", () => {
    expect(
      getLibraryDeleteErrorMessage(
        { response: { data: { error_code: LIBRARY_DELETE_ERROR_CODES.activeScan } } },
        t,
      ),
    ).toBe("settings.libraries.toast.delete_failed_active_scan");
  });

  it("DB busy 메시지를 반환한다", () => {
    expect(
      getLibraryDeleteErrorMessage({ response: { data: { error_code: LIBRARY_DELETE_ERROR_CODES.busy } } }, t),
    ).toBe("settings.libraries.toast.delete_failed_busy");
  });

  it("알 수 없는 코드에서는 서버 메시지 또는 기본 메시지를 반환한다", () => {
    expect(getLibraryDeleteErrorMessage({ response: { data: { error: "server error" } } }, t)).toBe("server error");
    expect(getLibraryDeleteErrorMessage({}, t)).toBe("settings.libraries.toast.delete_failed");
  });
});
