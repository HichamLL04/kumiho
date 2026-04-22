import { EPUB_SCROLLED_PULL_THRESHOLD } from "./constants";

export type ScrolledPullCompletionAction = "nav-prev" | "nav-next" | "decay" | "none";

/**
 * 스크롤 당김 완료 시 취해야 할 액션을 결정한다.
 * - 임계값 초과 + canPrev/canNext → 네비게이션
 * - 임계값 미만 + offset ≠ 0 → decay
 * - 그 외 → none
 */
export function getScrolledPullCompletionAction(
  offset: number,
  canPrev: boolean,
  canNext: boolean,
  threshold = EPUB_SCROLLED_PULL_THRESHOLD,
): ScrolledPullCompletionAction {
  if (Math.abs(offset) >= threshold) {
    if (offset > 0 && canPrev) return "nav-prev";
    if (offset < 0 && canNext) return "nav-next";
    return "none";
  }
  if (offset !== 0) return "decay";
  return "none";
}
