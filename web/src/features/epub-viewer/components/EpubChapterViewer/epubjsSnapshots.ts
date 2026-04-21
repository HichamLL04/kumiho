import type { Rendition } from "epubjs";

export interface EpubjsLocation {
  start: {
    cfi: string;
    displayed: {
      page: number;
      total: number;
    };
    percentage: number;
    index: number;
  };
  end: {
    cfi: string;
  };
  atStart?: boolean;
  atEnd?: boolean;
}

export interface EpubjsNavigationItem {
  id: string;
  label: string;
  href: string;
  subitems?: EpubjsNavigationItem[];
}

export interface EpubjsLocationsExtended {
  length: () => number;
  locationFromCfi?: (cfi: string) => number;
  cfiFromPercentage?: (percentage: number) => string;
  cfiFromLocation?: (location: number) => string;
  save: () => string;
}

export interface EpubjsSpine {
  spineItems: Array<{ index: number; href: string }>;
}

export interface EpubjsSection {
  cfiBase?: string;
  document?: Document;
  load?: () => Promise<unknown>;
  unload?: () => void;
  cfiFromElement?: (el: Element) => string;
}

export interface EpubManagerSnapshot {
  container?: HTMLElement;
  isPaginated?: boolean;
  settings?: {
    direction?: "ltr" | "rtl";
  };
  layout?: {
    delta?: number;
  };
  updateOffset?: () => void;
}

export interface EpubContentSnapshot {
  document?: Document;
}

export interface EpubRenditionSnapshot {
  manager?: EpubManagerSnapshot;
  currentLocation?: () => EpubjsLocation | undefined;
  resize?: (width: number, height: number) => void;
  display: (target?: string) => Promise<unknown>;
  spread?: (value: "auto" | "none") => void;
  getContents?: () => EpubContentSnapshot[];
}

export const asEpubRenditionSnapshot = (rendition: Rendition): EpubRenditionSnapshot =>
  rendition as unknown as EpubRenditionSnapshot;
