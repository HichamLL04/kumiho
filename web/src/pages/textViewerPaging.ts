import type { ReadingMode } from "../stores/viewerStore";

interface ScrollContainerLike {
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface VirtualPagingMetrics {
  viewportHeight: number;
  viewportWidth: number;
  maxScrollTop: number;
  maxScrollLeft: number;
  totalPages: number;
  currentPage: number;
  isAtVisualStart: boolean;
  isAtVisualEnd: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const getStepUnitFromReadingMode = (readingMode: ReadingMode): number => (readingMode === "double" ? 2 : 1);

export const measureVirtualPaging = (
  container: ScrollContainerLike,
  readingMode: ReadingMode = "vertical",
  currentOffsetX: number = 0, // Fallback for manual translate tracking
  contentWidthOverride?: number,
  viewportWidthOverride?: number,
): VirtualPagingMetrics => {
  const isVertical = readingMode === "vertical";

  if (isVertical) {
    const stepUnit = getStepUnitFromReadingMode(readingMode);
    const safeStepUnit = Math.max(1, stepUnit);
    const viewportHeight = Math.max(1, container.clientHeight);
    const fullHeight = Math.max(viewportHeight, container.scrollHeight);
    const baseTotal = Math.max(1, Math.ceil(fullHeight / viewportHeight));
    const totalPages = Math.max(1, Math.ceil(baseTotal / safeStepUnit));
    const baseIndex = clamp(Math.floor(container.scrollTop / viewportHeight), 0, Math.max(0, baseTotal - 1));
    let currentPage = clamp(Math.floor(baseIndex / safeStepUnit) + 1, 1, totalPages);

    const maxScrollTop = Math.max(0, container.scrollHeight - viewportHeight);
    const isAtVisualStart = container.scrollTop <= 1;
    const isAtVisualEnd = maxScrollTop <= 2 || container.scrollTop >= maxScrollTop - 2;

    if (isAtVisualEnd) {
      currentPage = totalPages;
    }

    return {
      viewportHeight,
      viewportWidth: 1, // Not used in vertical
      maxScrollTop,
      maxScrollLeft: 0,
      totalPages,
      currentPage,
      isAtVisualStart,
      isAtVisualEnd,
    };
  } else {
    // Horizontal (Paged) using CSS multi-column
    const viewportWidth = Math.max(1, viewportWidthOverride ?? ((container as HTMLElement).clientWidth || 0));
    const fullWidth = Math.max(viewportWidth, container.scrollWidth, contentWidthOverride ?? 0);
    const stepUnit = getStepUnitFromReadingMode(readingMode);

    // CSS Multi-column scales width naturally; 1 viewportWidth = 1 screen translation
    const totalScreens = Math.max(1, Math.ceil(fullWidth / viewportWidth));
    const totalPages = totalScreens * stepUnit;

    // Use manual translation offset if scrollLeft is 0 (since we use CSS transform)
    const effectiveScrollLeft = container.scrollLeft > 0 ? container.scrollLeft : currentOffsetX;

    const screenIndex = clamp(Math.floor(effectiveScrollLeft / viewportWidth), 0, Math.max(0, totalScreens - 1));
    let currentPage = screenIndex * stepUnit + 1;

    // CSS multi-column paged mode can report a narrower scrollWidth than the virtual
    // page track we navigate with translateX. Align end detection with the virtual track.
    const maxScrollLeft = Math.max(0, (totalScreens - 1) * viewportWidth);
    const isAtVisualStart = effectiveScrollLeft <= 1;
    const isAtVisualEnd = maxScrollLeft <= 2 || effectiveScrollLeft >= maxScrollLeft - 2;

    if (isAtVisualEnd) {
      currentPage = Math.max(1, totalPages - stepUnit + 1);
    }

    return {
      viewportHeight: container.clientHeight,
      viewportWidth,
      maxScrollTop: 0,
      maxScrollLeft,
      totalPages,
      currentPage,
      isAtVisualStart,
      isAtVisualEnd,
    };
  }
};

export const getTranslationForVirtualPage = (
  container: ScrollContainerLike,
  targetPage: number,
  readingMode: ReadingMode = "vertical",
  contentWidthOverride?: number,
  viewportWidthOverride?: number,
): { scrollTop: number; translateX: number } => {
  const metrics = measureVirtualPaging(container, readingMode, 0, contentWidthOverride, viewportWidthOverride);

  if (readingMode === "vertical") {
    const stepUnit = getStepUnitFromReadingMode(readingMode);
    const safeStepUnit = Math.max(1, stepUnit);
    const safePage = clamp(targetPage, 1, metrics.totalPages);
    const baseIndex = (safePage - 1) * safeStepUnit;
    const nextTop = baseIndex * metrics.viewportHeight;
    return { scrollTop: Math.min(nextTop, metrics.maxScrollTop), translateX: 0 };
  } else {
    const safePage = clamp(targetPage, 1, metrics.totalPages);
    const stepUnit = getStepUnitFromReadingMode(readingMode);
    const screenIndex = Math.floor((safePage - 1) / stepUnit);
    const nextLeft = screenIndex * metrics.viewportWidth;
    // Do NOT clamp to maxScrollLeft for horizontal paged mode.
    return { scrollTop: 0, translateX: nextLeft };
  }
};
