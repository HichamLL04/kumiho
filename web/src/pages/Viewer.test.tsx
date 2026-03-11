import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ViewerPage } from "./Viewer";

const useChapterLoaderMock = vi.fn();

vi.mock("../features/viewer", () => ({
  useChapterLoader: (...args: unknown[]) => useChapterLoaderMock(...args),
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

vi.mock("./TextViewerRoute", () => ({
  TextViewerRoute: () => <div data-testid="text-viewer-route">text route</div>,
}));

describe("ViewerPage routing by chapter type", () => {
  beforeEach(() => {
    useChapterLoaderMock.mockReset();
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
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

  it("routes TXT chapter to TextViewerRoute", () => {
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

    expect(screen.getByTestId("text-viewer-route")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-viewer-route")).not.toBeInTheDocument();
    expect(screen.queryByTestId("image-viewer-route")).not.toBeInTheDocument();
  });
});
