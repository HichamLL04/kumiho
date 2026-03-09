const CONTEXT_WINDOW = 32;

export interface ParsedParagraph {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface SavedTextAnchorV2 {
  kind: "txt_anchor_v2";
  paragraphId: string;
  offsetInParagraph: number;
  absoluteOffset: number;
  before: string;
  after: string;
  relativeX?: number;
  relativeY?: number;
}

export interface LegacySavedTextAnchor {
  kind?: string;
  offset?: number;
  before?: string;
  after?: string;
  hash?: string;
}

export type SavedTextAnchor = SavedTextAnchorV2 | LegacySavedTextAnchor;
export type ViewportAnchor = SavedTextAnchorV2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const normalizeTextContent = (value: string): string => value.replace(/\r\n?/g, "\n");

export const parseTextParagraphs = (rawText: string): ParsedParagraph[] => {
  const text = normalizeTextContent(rawText);
  const lines = text.split("\n");
  const paragraphs: ParsedParagraph[] = [];

  let cursor = 0;
  let currentLines: string[] = [];
  let currentStart = 0;
  let currentEnd = 0;

  const flushParagraph = () => {
    if (currentLines.length === 0) return;
    paragraphs.push({
      id: `para-${paragraphs.length}`,
      text: currentLines.join("\n"),
      startOffset: currentStart,
      endOffset: currentEnd,
    });
    currentLines = [];
  };

  lines.forEach((line, index) => {
    const lineStart = cursor;
    const lineEnd = lineStart + line.length;
    const hasTrailingNewline = index < lines.length - 1;
    cursor = lineEnd + (hasTrailingNewline ? 1 : 0);

    if (/^\s*$/.test(line)) {
      flushParagraph();
      return;
    }

    if (currentLines.length === 0) {
      currentStart = lineStart;
    }

    currentLines.push(line);
    currentEnd = lineEnd;
  });

  flushParagraph();

  if (paragraphs.length > 0) {
    return paragraphs;
  }

  return [
    {
      id: "para-0",
      text: "",
      startOffset: 0,
      endOffset: 0,
    },
  ];
};

export const getAnchorContext = (text: string, absoluteOffset: number) => {
  const safeOffset = clamp(absoluteOffset, 0, text.length);
  return {
    before: text.slice(Math.max(0, safeOffset - CONTEXT_WINDOW), safeOffset),
    after: text.slice(safeOffset, Math.min(text.length, safeOffset + CONTEXT_WINDOW)),
  };
};

export const findParagraphForAbsoluteOffset = (
  paragraphs: ParsedParagraph[],
  absoluteOffset: number,
): ParsedParagraph | null => {
  if (paragraphs.length === 0) return null;
  const safeOffset = clamp(absoluteOffset, 0, Math.max(0, paragraphs[paragraphs.length - 1].endOffset));

  for (const paragraph of paragraphs) {
    if (safeOffset >= paragraph.startOffset && safeOffset <= paragraph.endOffset) {
      return paragraph;
    }
  }

  let nearest = paragraphs[0];
  let nearestDistance = Math.abs(safeOffset - nearest.startOffset);

  for (const paragraph of paragraphs) {
    const distance = Math.min(
      Math.abs(safeOffset - paragraph.startOffset),
      Math.abs(safeOffset - paragraph.endOffset),
    );
    if (distance < nearestDistance) {
      nearest = paragraph;
      nearestDistance = distance;
    }
  }

  return nearest;
};

export const createViewportAnchor = (
  text: string,
  paragraphs: ParsedParagraph[],
  paragraphId: string,
  offsetInParagraph: number,
): ViewportAnchor | null => {
  const paragraph = paragraphs.find((item) => item.id === paragraphId);
  if (!paragraph) return null;

  const safeOffsetInParagraph = clamp(offsetInParagraph, 0, paragraph.text.length);
  const absoluteOffset = paragraph.startOffset + safeOffsetInParagraph;
  const context = getAnchorContext(text, absoluteOffset);

  return {
    kind: "txt_anchor_v2",
    paragraphId,
    offsetInParagraph: safeOffsetInParagraph,
    absoluteOffset,
    before: context.before,
    after: context.after,
  };
};

const isSavedTextAnchorV2 = (anchor: SavedTextAnchor): anchor is SavedTextAnchorV2 => anchor.kind === "txt_anchor_v2";

export const resolveSavedAnchorToAbsoluteOffset = (
  text: string,
  paragraphs: ParsedParagraph[],
  anchor: SavedTextAnchor | null,
): number | null => {
  if (!anchor) return null;

  const searchByContext = () => {
    const before = "before" in anchor && typeof anchor.before === "string" ? anchor.before : "";
    const after = "after" in anchor && typeof anchor.after === "string" ? anchor.after : "";
    const seed = `${before}${after}`;
    if (!seed) return null;
    const index = text.indexOf(seed);
    if (index < 0) return null;
    return index + before.length;
  };

  if (isSavedTextAnchorV2(anchor)) {
    const paragraph = paragraphs.find((item) => item.id === anchor.paragraphId);
    if (paragraph) {
      return clamp(paragraph.startOffset + anchor.offsetInParagraph, 0, text.length);
    }

    const contextMatch = searchByContext();
    if (contextMatch !== null) return contextMatch;

    return clamp(anchor.absoluteOffset, 0, text.length);
  }

  const contextMatch = searchByContext();
  if (contextMatch !== null) return contextMatch;

  if ("offset" in anchor && typeof anchor.offset === "number") {
    return clamp(anchor.offset, 0, text.length);
  }

  return null;
};
