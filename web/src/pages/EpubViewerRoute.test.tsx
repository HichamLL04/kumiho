import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EpubViewerRoute } from "./EpubViewerRoute";

const epubProgressGetMock = vi.fn();
const apiGetMock = vi.fn();
const mockSetCurrentCFI = vi.fn();
const mockSetGlobalProgress = vi.fn();
const mockSetIncognito = vi.fn();
const mockReset = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../stores/epubViewerStore", () => ({
  useEpubViewerStore: () => ({
    currentPage: 1,
    totalPages: 1,
    globalProgress: 0,
    isUIVisible: true,
    isSettingsOpen: false,
    isTOCOpen: false,
    isFullscreen: false,
    isIncognito: false,
    settings: {
      flow: "paginated",
      renderMode: "horizontal",
      fontSize: 100,
      fontFamily: "original",
      lineHeight: 1.6,
      theme: "dark",
      spread: "auto",
      wheelDirection: "down",
      keyboardDirection: "ltr",
      clickDirection: "ltr",
    },
    setCurrentCFI: mockSetCurrentCFI,
    setCurrentPage: vi.fn(),
    setTotalPages: vi.fn(),
    setGlobalProgress: mockSetGlobalProgress,
    setIsAtFirstPage: vi.fn(),
    setIsAtLastPage: vi.fn(),
    toggleSettings: vi.fn(),
    closeSettings: vi.fn(),
    toggleTOC: vi.fn(),
    closeTOC: vi.fn(),
    setFullscreen: vi.fn(),
    setIncognito: mockSetIncognito,
    reset: mockReset,
    setFontSize: vi.fn(),
    setFontFamily: vi.fn(),
    setLineHeight: vi.fn(),
    setTheme: vi.fn(),
    setRenderMode: vi.fn(),
    setFlow: vi.fn(),
    setSpread: vi.fn(),
    setWheelDirection: vi.fn(),
    setKeyboardDirection: vi.fn(),
    setClickDirection: vi.fn(),
    isAtFirstPage: false,
    isAtLastPage: false,
  }),
}));

vi.mock("../components/modals/AlertModal", () => ({
  AlertModal: () => null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">loading</div>,
}));

vi.mock("./EpubViewer", () => ({
  EpubViewer: ({ onInitializationComplete }: { onInitializationComplete: () => void }) => (
    <div>
      <div data-testid="epub-viewer">epub viewer</div>
      <button
        type="button"
        data-testid="epub-init-complete"
        onClick={onInitializationComplete}
      />
    </div>
  ),
}));

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
  },
  epubProgressAPI: {
    get: (...args: unknown[]) => epubProgressGetMock(...args),
    update: vi.fn(),
  },
  libraryAPI: {
    get: vi.fn(),
  },
  seriesAPI: {
    get: vi.fn(),
    getViewerSettings: vi.fn().mockResolvedValue({}),
  },
  settingAPI: {
    list: vi.fn().mockResolvedValue({}),
    update: vi.fn(),
  },
}));

vi.mock("../features/viewer", () => ({
  useAdjacentChapters: () => ({
    nextChapterId: null,
    isAdjacentResolved: true,
  }),
  useExitFullscreenOnViewerUnmount: () => {},
  useRestoreFullscreenAfterChapterSwitch: () => {},
}));

vi.mock("../features/viewer/hooks/usePreventBrowserZoom", () => ({
  usePreventBrowserZoom: () => {},
}));

vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: () => ({
    terminatedInfo: {
      isOpen: false,
      reason: "",
    },
  }),
}));

globalThis.URL.createObjectURL = vi.fn(() => "blob:epub");
globalThis.URL.revokeObjectURL = vi.fn();

describe("EpubViewerRoute", () => {
  beforeEach(() => {
    epubProgressGetMock.mockReset();
    apiGetMock.mockReset();
    mockSetCurrentCFI.mockReset();
    mockSetGlobalProgress.mockReset();
    mockSetIncognito.mockReset();
    mockReset.mockReset();

    epubProgressGetMock.mockResolvedValue({
      data: {
        progress: {
          current_cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
          progress_percent: 45,
        },
      },
    });
    apiGetMock.mockResolvedValue({
      data: new Blob(["epub"]),
    });
  });

  it("초기화 완료 전에는 EPUB 뷰어를 투명 상태로 유지하고 스피너를 표시한다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    });

    expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
    const viewerContainer = screen.getByTestId("epub-viewer").parentElement?.parentElement;
    expect(viewerContainer).toHaveStyle({ opacity: "0" });
    expect(viewerContainer).toHaveStyle({ pointerEvents: "none" });
  });

  it("초기화 완료 후에만 EPUB 뷰어를 렌더한다", async () => {
    const setViewStatus = vi.fn();

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus,
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      const viewerContainer = screen.getByTestId("epub-viewer").parentElement?.parentElement;
      expect(viewerContainer).toHaveStyle({ opacity: "1" });
      expect(viewerContainer).toHaveStyle({ pointerEvents: "auto" });
      expect(setViewStatus).toHaveBeenCalledWith("ready");
    });
  });
});
