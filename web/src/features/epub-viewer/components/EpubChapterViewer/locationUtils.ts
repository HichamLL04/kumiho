import type { EpubjsLocationsExtended } from "./epubjsSnapshots";

export const EPUB_LOCATION_STRIDE = 6144; // 6KB 단위로 가상 페이지(위치) 정의. backend/internal/util/epub.go의 EpubPositionStride와 일치해야 함.

export const toLocationRatio = (position: number, total: number): number => {
  if (!Number.isFinite(position) || !Number.isFinite(total) || total <= 1) return 0;
  return Math.max(0, Math.min(1, position / (total - 1)));
};

export const getSafeLocationLength = (locations: unknown): number => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.length !== "function") return 0;

  try {
    const total = locationSet.length();
    return Number.isFinite(total) && total > 0 ? total : 0;
  } catch (err) {
    console.warn("[EpubChapterViewer] location length unavailable:", err);
    return 0;
  }
};

export const getSafeCfiFromPercentage = (locations: unknown, ratio: number): string | undefined => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.cfiFromPercentage !== "function") return undefined;

  try {
    const cfi = locationSet.cfiFromPercentage(Math.max(0, Math.min(1, ratio)));
    return typeof cfi === "string" && cfi.trim().length > 0 ? cfi : undefined;
  } catch (err) {
    console.warn("[EpubChapterViewer] cfiFromPercentage failed:", err);
    return undefined;
  }
};

export const getSafeCfiFromLocation = (locations: unknown, location: number): string | undefined => {
  const locationSet = locations as Partial<EpubjsLocationsExtended> | null | undefined;
  if (typeof locationSet?.cfiFromLocation !== "function") return undefined;

  try {
    const cfi = locationSet.cfiFromLocation(location);
    return typeof cfi === "string" && cfi.trim().length > 0 ? cfi : undefined;
  } catch (err) {
    console.warn("[EpubChapterViewer] cfiFromLocation failed:", err);
    return undefined;
  }
};

export const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const safeDecodeFragment = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};
