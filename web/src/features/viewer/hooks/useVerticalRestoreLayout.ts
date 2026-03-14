import { useMemo } from "react";
import type { PageMeta } from "../types";

export interface VerticalRestoreLayout {
  estimatedHeights: Map<number, number>;
}

interface UseVerticalRestoreLayoutParams {
  pageMetaMap: Map<number, PageMeta>;
  containerWidth: number;
  totalPages: number;
}

const DEFAULT_VERTICAL_WIDTH = 760;
const FALLBACK_PAGE_HEIGHT = 600;

export function useVerticalRestoreLayout({
  pageMetaMap,
  containerWidth,
  totalPages,
}: UseVerticalRestoreLayoutParams): VerticalRestoreLayout {
  return useMemo(() => {
    const effectiveWidth = containerWidth > 0 ? containerWidth : DEFAULT_VERTICAL_WIDTH;
    const estimatedHeights = new Map<number, number>();

    for (let page = 1; page <= totalPages; page += 1) {
      const meta = pageMetaMap.get(page);
      let estimatedHeight = FALLBACK_PAGE_HEIGHT;

      if (meta && meta.width > 0 && meta.height > 0) {
        estimatedHeight = Math.max(1, (effectiveWidth / meta.width) * meta.height);
      }

      estimatedHeights.set(page, estimatedHeight);
    }

    return {
      estimatedHeights,
    };
  }, [containerWidth, pageMetaMap, totalPages]);
}
