import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { forwardRef, type ReactNode } from "react";
import { PdfChapterViewer } from "./index";

let mockIsZoomed = false;
let mockAnimateNext = vi.fn();
let mockAnimatePrev = vi.fn();
const mockPdfGetPage = vi.hoisted(() => vi.fn());
const mockGetDocument = vi.hoisted(() => vi.fn());

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {
    workerSrc: "",
  },
  getDocument: mockGetDocument,
  TextLayer: class {
    async render() {
      return Promise.resolve();
    }
  },
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "mock-worker-url",
}));

vi.mock("./index.module.css", () => ({
  default: new Proxy(
    {},
    {
      get: (_, key) => String(key),
    },
  ),
}));

vi.mock("../../../../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">loading</div>,
}));

vi.mock("../../hooks/useViewerZoom", () => ({
  useViewerZoom: () => ({
    transformComponentRef: { current: null },
    isZoomed: mockIsZoomed,
    setIsZoomed: vi.fn(),
    handleContentClick: vi.fn(),
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSwipe", () => ({
  useSwipe: () => ({
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
    swipeOffset: 0,
    isAnimating: false,
    animateNext: mockAnimateNext,
    animatePrev: mockAnimatePrev,
  }),
}));

vi.mock("../PageTransition", () => ({
  PageTransition: forwardRef<
    HTMLDivElement,
    {
      children: ReactNode;
      onWheel?: (e: React.WheelEvent) => void;
      prevChildren?: ReactNode;
      nextChildren?: ReactNode;
    }
  >(({ children, onWheel, prevChildren, nextChildren }, ref) => (
    <div
      ref={ref}
      data-testid="pdf-page-transition"
      onWheel={onWheel}
    >
      {prevChildren}
      {children}
      {nextChildren}
    </div>
  )),
}));

vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TransformComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const baseProps = {
  chapterId: undefined,
  currentPage: 1,
  fitMode: "screen",
  readingMode: "single" as const,
  readingDirection: "ltr" as const,
  transitionType: "slide" as const,
  onDocumentLoad: vi.fn(),
  onNext: vi.fn(),
  onPrev: vi.fn(),
};

const createMockPdfPage = () => ({
  getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale })),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  getTextContent: vi.fn(async () => ({ items: [], styles: {} })),
});

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  trigger(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  mockIsZoomed = false;
  mockAnimateNext = vi.fn();
  mockAnimatePrev = vi.fn();
  mockPdfGetPage.mockReset();
  mockGetDocument.mockReset();
  MockResizeObserver.instances = [];
  globalThis.ResizeObserver = originalResizeObserver;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PdfChapterViewer wheel navigation", () => {
  it("moves next on wheel down when wheelDirection is down", () => {
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).toHaveBeenCalledTimes(1);
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("moves prev on wheel down when wheelDirection is up", () => {
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="up"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimatePrev).toHaveBeenCalledTimes(1);
    expect(mockAnimateNext).not.toHaveBeenCalled();
  });

  it("ignores wheel navigation with ctrl key pressed", () => {
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, ctrlKey: true });

    expect(mockAnimateNext).not.toHaveBeenCalled();
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("ignores wheel navigation when zoomed", () => {
    mockIsZoomed = true;
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).not.toHaveBeenCalled();
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("throttles rapid wheel events", () => {
    const dateNow = vi.spyOn(Date, "now");
    dateNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100).mockReturnValueOnce(1300);

    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    const container = screen.getByTestId("pdf-page-transition");
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).toHaveBeenCalledTimes(2);
  });
});

describe("PdfChapterViewer PDF load logic", () => {
  const createMockPdf = (numPages = 3) => ({
    numPages,
    getPage: mockPdfGetPage,
    getOutline: vi.fn(async () => null),
  });

  it("calls onDocumentLoad with numPages on successful load", async () => {
    const mockPdf = createMockPdf(5);
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-1"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(5));
  });

  it("calls onDocumentLoad(0) when load fails", async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error("Total failure")),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-fail"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(0));
  });

  it("includes JWT Authorization header when access_token looks like JWT", async () => {
    const jwtToken = "eyJhbGciOi.eyJzdWIiOi.signature";
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = (key: string) =>
      key === "access_token" ? jwtToken : null;

    const mockPdf = createMockPdf(1);
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-jwt"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalled());
    expect(mockGetDocument.mock.calls[0][0]).toMatchObject({
      httpHeaders: { Authorization: `Bearer ${jwtToken}` },
    });

    Storage.prototype.getItem = originalGetItem;
  });

  it("does not include Authorization header when access_token is not JWT-like", async () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = (key: string) =>
      key === "access_token" ? "not-a-jwt" : null;

    const mockPdf = createMockPdf(1);
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-no-jwt"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalled());
    expect(mockGetDocument.mock.calls[0][0]).not.toHaveProperty("httpHeaders");

    Storage.prototype.getItem = originalGetItem;
  });
});

describe("PdfChapterViewer resize observer", () => {
  it("rerenders when container size changes from zero to valid size", async () => {
    mockPdfGetPage.mockResolvedValue(createMockPdfPage());
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: mockPdfGetPage,
        getOutline: vi.fn(async () => null),
      }),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-1"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(1));
    await waitFor(() => expect(MockResizeObserver.instances.length).toBeGreaterThan(0));

    const renderCallsBeforeResize = mockPdfGetPage.mock.calls.length;
    const container = screen.getByTestId("pdf-page-transition");
    Object.defineProperty(container, "clientWidth", { configurable: true, get: () => 480 });
    Object.defineProperty(container, "clientHeight", { configurable: true, get: () => 800 });

    vi.useFakeTimers();
    MockResizeObserver.instances[0]?.trigger(480, 800);
    vi.advanceTimersByTime(180);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockPdfGetPage.mock.calls.length).toBeGreaterThan(renderCallsBeforeResize);
    });
  });
});
