interface EpubjsLocationsWithCfi {
  locationFromCfi?: (cfi: string) => number;
}

export const isLikelyEpubCfi = (value: string | null | undefined): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return /^epubcfi\(.+\)$/i.test(trimmed);
};

export const getSafeLocationFromCfi = (locations: unknown, cfi: string): number | null => {
  if (!isLikelyEpubCfi(cfi)) return null;

  const locationSet = locations as EpubjsLocationsWithCfi | null | undefined;
  if (typeof locationSet?.locationFromCfi !== "function") return null;

  try {
    const position = locationSet.locationFromCfi(cfi.trim());
    return typeof position === "number" && Number.isFinite(position) && position >= 0 ? position : null;
  } catch (err) {
    console.warn("[EpubChapterViewer] locationFromCfi failed:", err);
    return null;
  }
};
