export interface AnchorPosition {
  anchorPage: number;
  offsetRatio: number;
}

const DEFAULT_SEARCH_WINDOW = 8;

interface AnchorRectResult {
  anchorPage: number;
  rect: DOMRect | null;
  containerTop: number;
}

interface ScanState {
  fallbackPage: number;
  fallbackRect: DOMRect | null;
  fallbackDistance: number;
  previousPage: number;
  previousRect: DOMRect | null;
  nextPage: number;
  nextRect: DOMRect | null;
}

function inspectPage(
  containerTop: number,
  page: number,
  state: ScanState,
): AnchorRectResult | null {
  const pageEl = document.getElementById(`page-${page}`);
  if (!pageEl || typeof pageEl.getBoundingClientRect !== "function") return null;

  const rect = pageEl.getBoundingClientRect();
  if (rect.height <= 0) return null;

  if (rect.top <= containerTop && rect.bottom > containerTop) {
    return { anchorPage: page, rect, containerTop };
  }

  if (rect.top <= containerTop) {
    state.previousRect = rect;
    state.previousPage = page;
  } else if (!state.nextRect) {
    state.nextRect = rect;
    state.nextPage = page;
  }

  const distance = Math.abs(rect.top - containerTop);
  if (distance < state.fallbackDistance) {
    state.fallbackDistance = distance;
    state.fallbackRect = rect;
    state.fallbackPage = page;
  }

  return null;
}

function getAnchorPageRect(content: HTMLDivElement, totalPages: number, fallbackPage: number) {
  if (typeof content.getBoundingClientRect !== "function") {
    return { anchorPage: fallbackPage, rect: null, containerTop: 0 };
  }

  const state: ScanState = {
    fallbackPage,
    fallbackRect: null,
    fallbackDistance: Number.POSITIVE_INFINITY,
    previousPage: fallbackPage,
    previousRect: null,
    nextPage: fallbackPage,
    nextRect: null,
  };

  const centerPage = Math.max(1, Math.min(totalPages, fallbackPage));
  const start = Math.max(1, centerPage - DEFAULT_SEARCH_WINDOW);
  const end = Math.min(totalPages, centerPage + DEFAULT_SEARCH_WINDOW);
  const containerTop = content.getBoundingClientRect().top;

  for (let page = start; page <= end; page += 1) {
    const found = inspectPage(containerTop, page, state);
    if (found) return found;
  }

  for (let page = 1; page <= totalPages; page += 1) {
    if (page >= start && page <= end) continue;
    const found = inspectPage(containerTop, page, state);
    if (found) return found;
  }

  if (state.previousRect) {
    return { anchorPage: state.previousPage, rect: state.previousRect, containerTop };
  }

  if (state.nextRect) {
    return { anchorPage: state.nextPage, rect: state.nextRect, containerTop };
  }

  return { anchorPage: state.fallbackPage, rect: state.fallbackRect, containerTop };
}

export function getViewportAnchorPosition(
  content: HTMLDivElement | null,
  totalPages: number,
  fallbackPage: number,
): AnchorPosition {
  if (!content || totalPages <= 0) {
    return {
      anchorPage: fallbackPage,
      offsetRatio: 0,
    };
  }

  const { anchorPage, rect: anchorRect, containerTop } = getAnchorPageRect(content, totalPages, fallbackPage);

  if (!anchorRect || anchorRect.height <= 0) {
    return {
      anchorPage,
      offsetRatio: 0,
    };
  }

  return {
    anchorPage,
    offsetRatio: Math.max(0, Math.min(1, (containerTop - anchorRect.top) / anchorRect.height)),
  };
}

export function getViewportAnchorPage(content: HTMLDivElement | null, totalPages: number, fallbackPage: number): number {
  if (!content || totalPages <= 0) {
    return fallbackPage;
  }

  return getAnchorPageRect(content, totalPages, fallbackPage).anchorPage;
}
