import { useMemo } from "react";
import type { FitMode } from "../../../stores/viewerStore";
import type { PageMeta, RestorePosition } from "../types";

export interface VerticalRestoreLayout {
  estimatedHeights: Map<number, number>;
  cumulativeOffsets: number[];
  targetScrollTop: number;
  canUsePreciseRestore: boolean;
}

interface UseVerticalRestoreLayoutParams {
  pageMetaMap: Map<number, PageMeta>;
  restorePosition: RestorePosition;
  fitMode: FitMode;
  containerWidth: number;
  totalPages: number;
}

const DEFAULT_VERTICAL_WIDTH = 760;
const FALLBACK_PAGE_HEIGHT = 600;

export function useVerticalRestoreLayout({
  pageMetaMap,
  restorePosition,
  fitMode,
  containerWidth,
  totalPages,
}: UseVerticalRestoreLayoutParams): VerticalRestoreLayout {
  return useMemo(() => {
    const effectiveWidth = containerWidth > 0 ? containerWidth : DEFAULT_VERTICAL_WIDTH;
    const estimatedHeights = new Map<number, number>();
    const cumulativeOffsets = new Array<number>(totalPages + 1).fill(0);
    let canUsePreciseRestore = totalPages > 0;

    for (let page = 1; page <= totalPages; page += 1) {
      const meta = pageMetaMap.get(page);
      let estimatedHeight = FALLBACK_PAGE_HEIGHT;

      if (meta && meta.width > 0 && meta.height > 0) {
        estimatedHeight = Math.max(1, (effectiveWidth / meta.width) * meta.height);
      } else {
        canUsePreciseRestore = false;
      }

      estimatedHeights.set(page, estimatedHeight);
      cumulativeOffsets[page] = cumulativeOffsets[page - 1] + estimatedHeight;
    }

    const anchorPage = Math.max(1, Math.min(restorePosition.anchorPage, Math.max(totalPages, 1)));
    const targetScrollTop = cumulativeOffsets[anchorPage - 1] ?? 0;

    return {
      estimatedHeights,
      cumulativeOffsets,
      targetScrollTop: fitMode === "height" ? 0 : targetScrollTop,
      canUsePreciseRestore,
    };
  }, [containerWidth, fitMode, pageMetaMap, restorePosition.anchorPage, totalPages]);
}
