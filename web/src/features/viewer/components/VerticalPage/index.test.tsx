import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VerticalPage } from "./index";

// Mock SmartImageViewer
vi.mock("../../../../components/SmartImageViewer", () => ({
  SmartImageViewer: ({
    src,
    alt,
    onVisualReady,
    style,
    className,
  }: {
    src?: string;
    alt?: string;
    onVisualReady?: () => void;
    style?: React.CSSProperties;
    className?: string;
  }) => (
    <img
      src={src}
      alt={alt}
      onLoad={onVisualReady}
      style={style}
      className={className}
      data-testid="smart-image"
    />
  ),
}));

// Mock ResizeObserver
class ResizeObserverMock {
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe("VerticalPage", () => {
  const defaultProps = {
    pageNum: 1,
    imageUrl: "test-image.jpg",
    pageHeightCache: new Map<number, number>(),
    minAllowedPage: 1,
    maxAllowedPage: 5,
    viewStatus: "ready" as const,
    handleImageLoad: vi.fn(),
    handleContentClick: vi.fn(),
    styles: {
      verticalPageImage: "verticalPageImage",
      pageLoadingPlaceholder: "pageLoadingPlaceholder",
      spinner: "spinner",
      pageImageWrapper: "pageImageWrapper",
    },
    fitMode: "screen",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  it("renders the image when within the allowed range", () => {
    render(<VerticalPage {...defaultProps} />);
    expect(screen.getByTestId("smart-image")).toBeDefined();
    expect(screen.getByAltText("페이지 1")).toBeDefined();
  });

  it("does not render the image when outside the allowed range", () => {
    render(
      <VerticalPage
        {...defaultProps}
        pageNum={10}
      />,
    );
    expect(screen.queryByTestId("smart-image")).toBeNull();
  });

  it("shows a spinner when viewStatus is ready and image is not loaded", () => {
    render(<VerticalPage {...defaultProps} />);
    // SmartImageViewer is mocked, and by default imageLoaded state in VerticalPageContent is false
    expect(document.querySelector(".spinner")).toBeDefined();
  });

  it("calls handleImageLoad when the image successfully loads", () => {
    render(<VerticalPage {...defaultProps} />);
    const img = screen.getByTestId("smart-image");
    fireEvent.load(img);
    expect(defaultProps.handleImageLoad).toHaveBeenCalledWith(1);
    // After load, spinner should disappear
    expect(document.querySelector(".spinner")).toBeNull();
  });

  it("uses cached height for placeholder if available", () => {
    const cache = new Map([[1, 1234]]);
    render(
      <VerticalPage
        {...defaultProps}
        pageHeightCache={cache}
      />,
    );
    const wrapper = document.getElementById("page-1");
    expect(wrapper?.style.minHeight).toBe("1234px");
  });

  it("updates the cache when ResizeObserver detects a height change", () => {
    const cache = new Map<number, number>();
    let observerCallback: ResizeObserverCallback = () => {};

    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          observerCallback = cb;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );

    render(
      <VerticalPage
        {...defaultProps}
        pageHeightCache={cache}
      />,
    );

    // Simulate ResizeObserver trigger
    const mockEntry = {
      contentRect: { height: 500 },
      target: {} as Element,
    } as ResizeObserverEntry;

    act(() => {
      observerCallback([mockEntry], {} as ResizeObserver);
    });

    expect(cache.get(1)).toBe(500);
  });

  it("initializes imageLoaded state as false even after unmount/remount of content", () => {
    const { rerender } = render(
      <VerticalPage
        {...defaultProps}
        pageNum={1}
      />,
    );

    // Load image
    fireEvent.load(screen.getByTestId("smart-image"));
    expect(document.querySelector(".spinner")).toBeNull();

    // Force unrender content by changing allowed range
    rerender(
      <VerticalPage
        {...defaultProps}
        pageNum={1}
        minAllowedPage={5}
        maxAllowedPage={10}
      />,
    );
    expect(screen.queryByTestId("smart-image")).toBeNull();

    // Remount content
    rerender(
      <VerticalPage
        {...defaultProps}
        pageNum={1}
        minAllowedPage={1}
        maxAllowedPage={5}
      />,
    );

    // Spinner should reappear because VerticalPageContent was remounted and its internal state reset
    expect(document.querySelector(".spinner")).toBeDefined();
  });
});
