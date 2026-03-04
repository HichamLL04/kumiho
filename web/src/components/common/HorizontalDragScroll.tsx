import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type WheelEvent, type UIEvent } from "react";

interface HorizontalDragScrollProps {
  className?: string;
  children: ReactNode;
}

export function HorizontalDragScroll({ className = "", children }: HorizontalDragScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const targetScrollLeftRef = useRef(0);
  const draggedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const maskRafRef = useRef<number | null>(null);
  const pendingMaskElementRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const DRAG_THRESHOLD = 8;
  const CLICK_SUPPRESS_MS = 160;

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (maskRafRef.current !== null) {
        window.cancelAnimationFrame(maskRafRef.current);
        maskRafRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, []);

  const updateMaskEdges = useCallback((el: HTMLDivElement) => {
    // 0~80px 스크롤에 걸쳐 투명도가 1 -> 0으로 변함 (더 부드러운 애니메이션)
    const FADE_RANGE = 80;

    // isAtLeft: scrollLeft가 0에 가까울수록 1(불투명, 페이드 없음), 커지면 0(투명, 페이드 있음)
    const leftEdgeOpacity = Math.max(0, 1 - el.scrollLeft / FADE_RANGE);

    // isAtRight: 끝에 도달할수록 1(불투명), 떨어질수록 0(투명)
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    // content가 짧아서 스크롤 자체가 불가능한 경우, 양쪽 모두 페이드 없어야 함
    if (maxScrollLeft <= 0) {
      el.style.setProperty("--mask-left-edge", "1");
      el.style.setProperty("--mask-right-edge", "1");
      return;
    }

    const distanceFromRight = maxScrollLeft - el.scrollLeft;
    const rightEdgeOpacity = Math.max(0, 1 - distanceFromRight / FADE_RANGE);

    el.style.setProperty("--mask-left-edge", leftEdgeOpacity.toString());
    el.style.setProperty("--mask-right-edge", rightEdgeOpacity.toString());
  }, []);

  const scheduleMaskUpdate = useCallback((el: HTMLDivElement) => {
    pendingMaskElementRef.current = el;
    if (maskRafRef.current !== null) return;

    maskRafRef.current = window.requestAnimationFrame(() => {
      const target = pendingMaskElementRef.current;
      if (target) {
        updateMaskEdges(target);
      }
      pendingMaskElementRef.current = null;
      maskRafRef.current = null;
    });
  }, [updateMaskEdges]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 초기 마스크 설정
    updateMaskEdges(el);

    // 컨테이너 박스 크기 변동(리사이즈 등) 시 마스크 갱신
    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => {
        scheduleMaskUpdate(el);
      });
      resizeObserver.observe(el);
      resizeObserverRef.current = resizeObserver;
    }

    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [scheduleMaskUpdate, updateMaskEdges]);

  // 자식 콘텐츠 변경으로 scrollWidth가 달라질 수 있으므로 별도 갱신
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    scheduleMaskUpdate(el);
  }, [children, scheduleMaskUpdate]);

  const applyScrollOnNextFrame = () => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) {
        el.scrollLeft = targetScrollLeftRef.current;
      }
      rafRef.current = null;
    });
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    setIsDragging(true);
    startXRef.current = e.pageX;
    startYRef.current = e.pageY;
    scrollLeftRef.current = el.scrollLeft;
    targetScrollLeftRef.current = el.scrollLeft;
    draggedRef.current = false;
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const el = containerRef.current;
    if (!el) return;

    const deltaX = e.pageX - startXRef.current;
    const deltaY = e.pageY - startYRef.current;

    if (!draggedRef.current && (Math.abs(deltaX) >= DRAG_THRESHOLD || Math.abs(deltaY) >= DRAG_THRESHOLD)) {
      draggedRef.current = true;
    }

    if (!draggedRef.current) return;

    e.preventDefault();
    targetScrollLeftRef.current = scrollLeftRef.current - deltaX;
    applyScrollOnNextFrame();
  };

  const stopDragging = () => {
    if (draggedRef.current) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
    }
    setIsDragging(false);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    const canScrollHorizontally = el.scrollWidth > el.clientWidth;
    if (!canScrollHorizontally) return;

    // 세로 휠 입력은 페이지 스크롤에 맡기고,
    // 실제 가로 제스처(트랙패드/가로 휠)일 때만 가로 스크롤 처리.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const deltaX = e.deltaX;
    if (deltaX === 0) return;

    e.preventDefault();
    e.stopPropagation();
    targetScrollLeftRef.current = el.scrollLeft + deltaX;
    applyScrollOnNextFrame();
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
  };

  const handleClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (Date.now() <= suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    scheduleMaskUpdate(e.currentTarget);
  };

  return (
    <div
      ref={containerRef}
      className={`${className} ${isDragging ? "dragging" : ""}`.trim()}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={stopDragging}
      onMouseUp={stopDragging}
      onWheel={handleWheel}
      onClickCapture={handleClickCapture}
      onScroll={handleScroll}
    >
      {children}
    </div>
  );
}
