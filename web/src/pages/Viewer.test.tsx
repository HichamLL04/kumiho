import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ViewerPage } from "./Viewer";

const useChapterLoaderMock = vi.fn();
const setViewerIncognitoMock = vi.fn();
const setEpubIncognitoMock = vi.fn();

vi.mock("../features/viewer", () => ({
  useChapterLoader: (...args: unknown[]) => useChapterLoaderMock(...args),
}));

vi.mock("../stores/viewerStore", () => ({
  useViewerStore: (selector: (state: { setIncognito: typeof setViewerIncognitoMock }) => unknown) =>
    selector({ setIncognito: setViewerIncognitoMock }),
}));

vi.mock("../stores/epubViewerStore", () => ({
  useEpubViewerStore: (selector: (state: { setIncognito: typeof setEpubIncognitoMock }) => unknown) =>
    selector({ setIncognito: setEpubIncognitoMock }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./ImageViewerRoute", () => ({
  ImageViewerRoute: () => <div data-testid="image-viewer-route">image route</div>,
}));

vi.mock("./PdfViewerRoute", () => ({
  PdfViewerRoute: () => <div data-testid="pdf-viewer-route">pdf route</div>,
}));

vi.mock("./EpubViewerRoute", () => ({
  EpubViewerRoute: () => <div data-testid="epub-viewer-route">epub route</div>,
}));

describe("ViewerPage routing by chapter type", () => {
  beforeEach(() => {
    useChapterLoaderMock.mockReset();
    setViewerIncognitoMock.mockReset();
    setEpubIncognitoMock.mockReset();
  });

  const renderPage = (state?: { from?: string; isIncognito?: boolean }) =>
    render(
      <MemoryRouter initialEntries={[{ pathname: "/viewer/chapter-1", state }]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={<ViewerPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

  it("routes PDF chapter with render_mode=image to ImageViewerRoute", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.pdf",
        render_mode: "image",
      },
    });

    renderPage();

    expect(screen.getByTestId("image-viewer-route")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-viewer-route")).not.toBeInTheDocument();
    expect(setViewerIncognitoMock).toHaveBeenCalledWith(false);
    expect(setEpubIncognitoMock).toHaveBeenCalledWith(false);
  });

  it("routes PDF chapter with render_mode=pdf to PdfViewerRoute", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.pdf",
        render_mode: "pdf",
      },
    });

    renderPage();

    expect(screen.getByTestId("pdf-viewer-route")).toBeInTheDocument();
    expect(screen.queryByTestId("image-viewer-route")).not.toBeInTheDocument();
  });

  it("routes PDF chapter without render_mode to PdfViewerRoute by default", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.pdf",
      },
    });

    renderPage();

    expect(screen.getByTestId("pdf-viewer-route")).toBeInTheDocument();
    expect(screen.queryByTestId("image-viewer-route")).not.toBeInTheDocument();
  });

  it("routes TXT chapter to EpubViewerRoute", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.txt",
        render_mode: "text",
      },
    });

    renderPage();

    expect(screen.getByTestId("epub-viewer-route")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-viewer-route")).not.toBeInTheDocument();
    expect(screen.queryByTestId("image-viewer-route")).not.toBeInTheDocument();
  });

  it("routes incognito state into the shared viewer store for non-EPUB chapters", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.cbz",
        render_mode: "image",
      },
    });

    renderPage({ from: "/series/1", isIncognito: true });

    expect(setViewerIncognitoMock).toHaveBeenCalledWith(true);
    expect(setEpubIncognitoMock).toHaveBeenCalledWith(false);
  });

  it("routes incognito state into the EPUB viewer store for EPUB chapters", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.epub",
        render_mode: "epub",
      },
    });

    renderPage({ from: "/series/1", isIncognito: true });

    expect(setEpubIncognitoMock).toHaveBeenCalledWith(true);
    expect(setViewerIncognitoMock).toHaveBeenCalledWith(false);
  });

  it("routes incognito state into the EPUB viewer store for TXT chapters", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: false,
      chapter: {
        id: "chapter-1",
        path: "/books/sample.txt",
        render_mode: "text",
      },
    });

    renderPage({ from: "/series/1", isIncognito: true });

    expect(setEpubIncognitoMock).toHaveBeenCalledWith(true);
    expect(setViewerIncognitoMock).toHaveBeenCalledWith(false);
  });

  it("clears stale incognito state immediately before chapter data is ready", () => {
    useChapterLoaderMock.mockReturnValue({
      error: null,
      isLoading: true,
      chapter: null,
    });

    renderPage({ from: "/series/1" });

    expect(setViewerIncognitoMock).toHaveBeenCalledWith(false);
    expect(setEpubIncognitoMock).toHaveBeenCalledWith(false);
  });
});
