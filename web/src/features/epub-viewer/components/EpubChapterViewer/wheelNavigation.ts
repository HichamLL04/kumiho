import type { EpubViewerSettings } from "../../../../stores/epubViewerStore";
import type { EpubManagerSnapshot } from "./epubjsSnapshots";

export type WheelNavigationAction = "next" | "prev" | null;

const WHEEL_NAVIGATION_DELTA_THRESHOLD = 8;

interface WheelNavigationInput {
  deltaY: number;
  flow: EpubViewerSettings["flow"];
  wheelDirection: EpubViewerSettings["wheelDirection"];
  manager?: EpubManagerSnapshot;
}

export function getWheelNavigationAction({
  deltaY,
  flow,
  wheelDirection,
  manager,
}: WheelNavigationInput): WheelNavigationAction {
  if (Math.abs(deltaY) < WHEEL_NAVIGATION_DELTA_THRESHOLD) return null;

  const isNextDirection = wheelDirection === "down" ? deltaY > 0 : deltaY < 0;
  if (flow !== "paginated") {
    if (!manager || manager.isPaginated === true || !manager.container) return null;

    const { scrollHeight, clientHeight, scrollTop } = manager.container;
    if (scrollHeight > clientHeight + 5) {
      const atStart = scrollTop <= 5;
      const atEnd = scrollTop + clientHeight >= scrollHeight - 8;
      if ((isNextDirection && !atEnd) || (!isNextDirection && !atStart)) return null;
    }
  }

  return isNextDirection ? "next" : "prev";
}
