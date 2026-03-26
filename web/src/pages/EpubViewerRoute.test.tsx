import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { EpubViewerRoute } from "./EpubViewerRoute";

const epubProgressGetMock = vi.fn();
const apiGetMock = vi.fn();
const mockSetCurrentCFI = vi.fn();
const mockSetGlobalProgress = vi.fn();
const mockSetIsAtLastPage = vi.fn();
const mockSetIncognito = vi.fn();
const mockReset = vi.fn();
const epubProgressUpdateMock = vi.fn();
const useViewerSyncMock = vi.fn();
let latestViewerProps: {
  onInitializationComplete: () => void;
  onLocationChange: (location: {
    cfi: string;
    chapterPage: number;
    chapterTotal: number;
    globalRatio: number;
    currentPosition: number;
    totalPositions: number;
    chapterHref: string;
    atStart?: boolean;
    atEnd?: boolean;
  }) => void;
  onReady: (total: number) => void;
} | null = null;

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
    setIsAtLastPage: mockSetIsAtLastPage,
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
  AlertModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? (
      <button
        type="button"
        data-testid="terminated-confirm"
        onClick={onConfirm}
      />
    ) : null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">loading</div>,
}));

vi.mock("./EpubViewer", () => ({
  EpubViewer: ({
    onInitializationComplete,
    onLocationChange,
    onReady,
  }: {
    onInitializationComplete: () => void;
    onLocationChange: (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
      chapterHref: string;
      atStart?: boolean;
      atEnd?: boolean;
    }) => void;
    onReady: (total: number) => void;
  }) => {
    latestViewerProps = { onInitializationComplete, onLocationChange, onReady };
    return (
      <div>
        <div data-testid="epub-viewer">epub viewer</div>
        <button
          type="button"
          data-testid="epub-init-complete"
          onClick={onInitializationComplete}
        />
        <button
          type="button"
          data-testid="epub-ready"
          onClick={() => onReady(10)}
        />
        <button
          type="button"
          data-testid="epub-relocate"
          onClick={() =>
            onLocationChange({
              cfi: "epubcfi(/6/2[chapter]!/4/4/2)",
              chapterPage: 1,
              chapterTotal: 10,
              globalRatio: 0.1,
              currentPosition: 0,
              totalPositions: 10,
              chapterHref: "chapter.xhtml",
            })
          }
        />
      </div>
    );
  },
}));

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
  },
  epubProgressAPI: {
    get: (...args: unknown[]) => epubProgressGetMock(...args),
    update: (...args: unknown[]) => epubProgressUpdateMock(...args),
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
  useBGM: () => ({
    bgmInfo: null,
    isBgmPlaying: false,
    setIsBgmPlaying: vi.fn(),
    audioRef: { current: null },
  }),
}));

vi.mock("../features/viewer/hooks/usePreventBrowserZoom", () => ({
  usePreventBrowserZoom: () => {},
}));

vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: (...args: unknown[]) => useViewerSyncMock(...args),
}));

globalThis.URL.createObjectURL = vi.fn(() => "blob:epub");
globalThis.URL.revokeObjectURL = vi.fn();

describe("EpubViewerRoute", () => {
  beforeEach(() => {
    epubProgressGetMock.mockReset();
    apiGetMock.mockReset();
    mockSetCurrentCFI.mockReset();
    mockSetGlobalProgress.mockReset();
    mockSetIsAtLastPage.mockReset();
    mockSetIncognito.mockReset();
    mockReset.mockReset();
    epubProgressUpdateMock.mockReset();
    useViewerSyncMock.mockReset();
    latestViewerProps = null;
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: false,
        reason: "",
      },
    });

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
    epubProgressUpdateMock.mockResolvedValue({});
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

  it("locations 준비 전에는 저장을 미루고 준비 후 같은 CFI라도 정상 저장한다", async () => {
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
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
        chapterPage: 1,
        chapterTotal: 10,
        globalRatio: 0,
        currentPosition: 0,
        totalPositions: 1,
        chapterHref: "chapter.xhtml",
      });
    });

    expect(epubProgressUpdateMock).not.toHaveBeenCalled();

    act(() => {
      latestViewerProps?.onReady(10);
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
        chapterPage: 5,
        chapterTotal: 10,
        globalRatio: 0.45,
        currentPosition: 4,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
      });
    });

    await waitFor(() => {
      expect(epubProgressUpdateMock).toHaveBeenCalledWith("chapter-1", {
        current_page: 5,
        total_pages: 10,
        progress_percent: expect.closeTo(44.4444444444, 5),
        current_position: 4,
        total_positions: 10,
        current_cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
      });
    });
  });

  it("should not mark at last page when atEnd flag appears but progress is not at edge", async () => {
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
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    mockSetIsAtLastPage.mockReset();

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/3/6)",
        chapterPage: 2,
        chapterTotal: 10,
        globalRatio: 0.25,
        currentPosition: 2,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
        atEnd: true,
      });
    });

    expect(mockSetIsAtLastPage).toHaveBeenCalledWith(false);
  });

  it("locations 축이 끝까지 1이어도 pseudo page로 current_cfi를 저장한다", async () => {
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
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/6/8)",
        chapterPage: 3,
        chapterTotal: 10,
        globalRatio: 0.45,
        currentPosition: 0,
        totalPositions: 1,
        chapterHref: "chapter.xhtml",
      });
    });

    await waitFor(() => {
      expect(epubProgressUpdateMock).toHaveBeenCalledWith("chapter-1", {
        current_page: 45,
        total_pages: 100,
        progress_percent: 45,
        current_position: 0,
        total_positions: 0,
        current_cfi: "epubcfi(/6/2[chapter]!/4/6/8)",
      });
    });
  });

  it("시크릿 모드에서는 pseudo page fallback도 저장하지 않는다", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/viewer/chapter-1", state: { isIncognito: true } }]}>
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
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/8/10)",
        chapterPage: 4,
        chapterTotal: 10,
        globalRatio: 0.5,
        currentPosition: 0,
        totalPositions: 1,
        chapterHref: "chapter.xhtml",
      });
    });

    expect(epubProgressUpdateMock).not.toHaveBeenCalled();
  });

  it("세션 종료 확인 시 viewerFrom으로 replace 이동한다", async () => {
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: true,
        reason: "session ended",
      },
    });

    const router = createMemoryRouter(
      [
        {
          path: "/viewer/:chapterId",
          element: (
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
          ),
        },
        {
          path: "/series/1",
          element: <div data-testid="series-page">series page</div>,
        },
      ],
      {
        initialEntries: [{ pathname: "/viewer/chapter-1", state: { from: "/series/1" } }],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId("terminated-confirm")).toBeInTheDocument();
    });

    act(() => {
      screen.getByTestId("terminated-confirm").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("series-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/series/1");
      expect(router.state.historyAction).toBe("REPLACE");
    });
  });
});
