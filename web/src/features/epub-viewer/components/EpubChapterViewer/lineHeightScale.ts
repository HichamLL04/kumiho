import {
  EPUB_LINE_HEIGHT_SCALE_DEFAULT,
  EPUB_LINE_HEIGHT_SCALE_MAX,
  EPUB_LINE_HEIGHT_SCALE_MIN,
} from "../../../../stores/epubViewerStore";
import { EPUB_TEXT_STYLE_SELECTOR } from "./styleBuilder";

const SCALED_ATTR = "data-kumiho-line-height-scaled";
const INLINE_VALUE_ATTR = "data-kumiho-line-height-inline-value";
const INLINE_PRIORITY_ATTR = "data-kumiho-line-height-inline-priority";

const parsePixelValue = (raw: string, fontSizePx: number): number => {
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "normal") {
    return fontSizePx * 1.2;
  }

  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric)) {
    return fontSizePx * 1.2;
  }

  if (normalized.endsWith("px")) return numeric;
  if (normalized.endsWith("rem") || normalized.endsWith("em")) return numeric * fontSizePx;
  if (normalized.endsWith("%")) return (numeric / 100) * fontSizePx;
  return numeric * fontSizePx;
};

const collectLineHeightTargets = (doc: Document): HTMLElement[] => {
  const body = doc.body;
  if (!body) return [];

  const elements = Array.from(doc.querySelectorAll<HTMLElement>(EPUB_TEXT_STYLE_SELECTOR));
  return Array.from(new Set([body, ...elements]));
};

const restoreOriginalInlineLineHeight = (element: HTMLElement) => {
  const originalValue = element.getAttribute(INLINE_VALUE_ATTR) ?? "";
  const originalPriority = element.getAttribute(INLINE_PRIORITY_ATTR) ?? "";

  if (originalValue) {
    element.style.setProperty("line-height", originalValue, originalPriority);
  } else {
    element.style.removeProperty("line-height");
  }

  element.removeAttribute(SCALED_ATTR);
  element.removeAttribute(INLINE_VALUE_ATTR);
  element.removeAttribute(INLINE_PRIORITY_ATTR);
};

export function applyEpubLineHeightScale(doc: Document, scale: number): void {
  const safeScale = Math.max(EPUB_LINE_HEIGHT_SCALE_MIN, Math.min(EPUB_LINE_HEIGHT_SCALE_MAX, scale));
  const targets = collectLineHeightTargets(doc);
  const defaultView = doc.defaultView;

  if (!defaultView || targets.length === 0) return;

  targets.forEach((element) => {
    if (element.getAttribute(SCALED_ATTR) === "true") {
      restoreOriginalInlineLineHeight(element);
    }
  });

  if (Math.abs(safeScale - EPUB_LINE_HEIGHT_SCALE_DEFAULT) < 0.001) {
    return;
  }

  targets.forEach((element) => {
    const computedStyle = defaultView.getComputedStyle(element);
    const fontSizePx = parsePixelValue(computedStyle.fontSize, 16);
    const baseLineHeightPx = parsePixelValue(computedStyle.lineHeight, fontSizePx);

    element.setAttribute(INLINE_VALUE_ATTR, element.style.getPropertyValue("line-height"));
    element.setAttribute(INLINE_PRIORITY_ATTR, element.style.getPropertyPriority("line-height"));
    element.style.setProperty("line-height", `${baseLineHeightPx * safeScale}px`, "important");
    element.setAttribute(SCALED_ATTR, "true");
  });
}
