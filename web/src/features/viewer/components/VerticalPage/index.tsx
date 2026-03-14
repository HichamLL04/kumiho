import { useEffect, useRef, useState, type MouseEvent, type TouchEvent, type RefObject } from "react";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";
import type { ViewStatus } from "../../types";
import type { FitMode } from "../../../../stores/viewerStore";

interface VerticalPageProps {
  pageNum: number;
  imageUrl: string;
  pageHeightCache: Map<number, number>;
  minAllowedPage: number;
  maxAllowedPage: number;
  isInitialScrolling?: boolean; // Boolean으로 회복
  estimatedHeight?: number;
  viewStatus: ViewStatus;
  handleImageLoad: (pageNum: number) => void;
  handleContentClick: (
    e: MouseEvent | TouchEvent,
    ref?: RefObject<ReactZoomPanPinchContentRef> | { current: null },
  ) => void;
  styles: { readonly [key: string]: string };
  fitMode: string;
}

interface VerticalPageContentProps {
  pageNum: number;
  imageUrl: string;
  fitMode: FitMode;
  viewStatus: ViewStatus;
  onLoadComplete: () => void;
  onError: () => void;
  styles: { readonly [key: string]: string }; // styles prop 추가
}

const VerticalPageContent = ({
  pageNum,
  imageUrl,
  fitMode,
  viewStatus,
  onLoadComplete,
  onError,
  styles, // styles prop 받기
}: VerticalPageContentProps) => {
  const [imageLoaded, setImageLoaded] = useState(false);

  const onImageLoadComplete = () => {
    setImageLoaded(true);
    onLoadComplete();
  };

  const onImageError = () => {
    setImageLoaded(true); // 에러 시에도 플레이스홀더 해제
    onError();
  };

  const shouldShowSpinner = viewStatus === "ready" && !imageLoaded;

  return (
    <>
      <SmartImageViewer
        src={imageUrl}
        alt={`페이지 ${pageNum}`}
        className={`${styles.verticalPageImage} ${styles[`fit${fitMode.charAt(0).toUpperCase() + fitMode.slice(1)}`]}`}
        onVisualReady={onImageLoadComplete}
        onError={onImageError}
        style={{
          display: imageLoaded ? "block" : "none",
        }}
      />
      {shouldShowSpinner && (
        <div
          className={styles.pageLoadingPlaceholder}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            pointerEvents: "none",
          }}
        >
          <div className={styles.spinner} />
        </div>
      )}
    </>
  );
};

export const VerticalPage = ({
  pageNum,
  imageUrl,
  pageHeightCache,
  minAllowedPage,
  maxAllowedPage,
  isInitialScrolling = false,
  estimatedHeight,
  viewStatus,
  handleImageLoad,
  handleContentClick,
  styles,
  fitMode,
}: VerticalPageProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [cachedHeight, setCachedHeight] = useState<number>(() => pageHeightCache.get(pageNum) ?? 0);

  // 초기 스크롤/점프 시에도 모든 페이지를 한 번에 렌더하지 않도록,
  // maxAllowedPage를 기준으로 제한된 윈도우만 허용한다.
  const INITIAL_RENDER_WINDOW = 10;
  const effectiveMinAllowedPage = isInitialScrolling
    ? Math.max(1, maxAllowedPage - INITIAL_RENDER_WINDOW)
    : minAllowedPage;

  const shouldRenderImage = pageNum >= effectiveMinAllowedPage && pageNum <= maxAllowedPage;

  useEffect(() => {
    if (!shouldRenderImage) return;

    const el = contentRef.current;
    if (!el || !("ResizeObserver" in window)) return;

    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect.height ?? 0;
      if (nextHeight > 0) {
        setCachedHeight((prev) => {
          // 2px 이상의 유의미한 차이가 있을 때만 업데이트하여 잦은 렌더링 방지
          if (Math.abs(prev - nextHeight) < 2) return prev;
          pageHeightCache.set(pageNum, nextHeight);
          return nextHeight;
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [pageHeightCache, pageNum, shouldRenderImage]);

  const placeholderHeight = cachedHeight > 0 ? cachedHeight : Math.max(estimatedHeight ?? 0, 300);

  return (
    <div
      id={`page-${pageNum}`}
      ref={wrapperRef}
      className={styles.pageImageWrapper}
      onClick={(e) => handleContentClick(e, { current: null })}
      style={{
        width: "100%",
        minHeight: `${placeholderHeight}px`, // 항상 높이 유지 (언마운트 시에도 공백 유지)
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        margin: 0,
        padding: 0,
        lineHeight: 0,
        backgroundColor: "#000",
        position: "relative",
      }}
    >
      <div
        ref={contentRef}
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
        }}
      >
        {shouldRenderImage && (
          <VerticalPageContent
            pageNum={pageNum}
            imageUrl={imageUrl}
            fitMode={fitMode as FitMode} // fitMode 타입을 FitMode로 캐스팅
            viewStatus={viewStatus}
            onLoadComplete={() => handleImageLoad(pageNum)}
            onError={() => handleImageLoad(pageNum)}
            styles={styles} // styles prop 전달
          />
        )}
      </div>
    </div>
  );
};
