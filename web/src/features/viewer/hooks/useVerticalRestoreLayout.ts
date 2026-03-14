import { useMemo } from "react";
import type { PageMeta } from "../types";
import { VERTICAL_MAX_WIDTH } from "../utils/constants";

export interface VerticalRestoreLayout {
  estimatedHeights: Map<number, number>;
}

interface UseVerticalRestoreLayoutParams {
  pageMetaMap: Map<number, PageMeta>;
  containerWidth: number;
  totalPages: number;
  fitMode: string;
}

const FALLBACK_PAGE_HEIGHT = 600;

export function useVerticalRestoreLayout({
  pageMetaMap,
  containerWidth,
  totalPages,
  fitMode,
}: UseVerticalRestoreLayoutParams): VerticalRestoreLayout {
  return useMemo(() => {
    const effectiveWidth = containerWidth > 0 ? containerWidth : VERTICAL_MAX_WIDTH;
    const estimatedHeights = new Map<number, number>();

    for (let page = 1; page <= totalPages; page += 1) {
      const meta = pageMetaMap.get(page);
      let estimatedHeight = FALLBACK_PAGE_HEIGHT;

      if (meta && meta.width > 0 && meta.height > 0) {
        if (fitMode === "original") {
          // 원본 크기 모드: 컨테이너보다 크면 줄어들고, 작으면 그대로 유지
          const renderedWidth = Math.min(meta.width, effectiveWidth);
          estimatedHeight = (renderedWidth / meta.width) * meta.height;
        } else {
          // 가로 맞춤(Width) / 화면 맞춤(Screen): 항상 컨테이너 너비에 맞춤
          estimatedHeight = (effectiveWidth / meta.width) * meta.height;
        }
      }

      estimatedHeights.set(page, estimatedHeight);
    }

    return {
      estimatedHeights,
    };
  }, [containerWidth, pageMetaMap, totalPages, fitMode]);
}
