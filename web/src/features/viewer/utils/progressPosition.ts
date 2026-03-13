export interface AnchorPosition {
  anchorPage: number;
  offsetRatio: number;
}

function getAnchorPageRect(content: HTMLDivElement, totalPages: number, fallbackPage: number) {
  if (typeof content.getBoundingClientRect !== "function") {
    return { anchorPage: fallbackPage, rect: null, containerTop: 0 };
  }

  const containerTop = content.getBoundingClientRect().top;
  let fallbackRect: DOMRect | null = null;
  let fallbackDistance = Number.POSITIVE_INFINITY;
  let previousRect: DOMRect | null = null;
  let previousPage = fallbackPage;
  let nextRect: DOMRect | null = null;
  let nextPage = fallbackPage;

  for (let page = 1; page <= totalPages; page += 1) {
    const pageEl = document.getElementById(`page-${page}`);
    if (!pageEl) continue;
    if (typeof pageEl.getBoundingClientRect !== "function") continue;

    const rect = pageEl.getBoundingClientRect();
    if (rect.height <= 0) continue;

    if (rect.top <= containerTop && rect.bottom > containerTop) {
      return { anchorPage: page, rect, containerTop };
    }

    if (rect.top <= containerTop) {
      previousRect = rect;
      previousPage = page;
    } else if (!nextRect) {
      nextRect = rect;
      nextPage = page;
    }

    const distance = Math.abs(rect.top - containerTop);
    if (distance < fallbackDistance) {
      fallbackDistance = distance;
      fallbackRect = rect;
      fallbackPage = page;
    }
  }

  if (previousRect) {
    return { anchorPage: previousPage, rect: previousRect, containerTop };
  }

  if (nextRect) {
    return { anchorPage: nextPage, rect: nextRect, containerTop };
  }

  return { anchorPage: fallbackPage, rect: fallbackRect, containerTop };
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
