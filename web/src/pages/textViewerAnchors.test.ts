import { describe, expect, it } from "vitest";
import {
  createViewportAnchor,
  findParagraphForAbsoluteOffset,
  normalizeTextContent,
  parseTextParagraphs,
  resolveSavedAnchorToAbsoluteOffset,
} from "./textViewerAnchors";

describe("textViewerAnchors", () => {
  it("연속 빈 줄을 문단 경계로 사용하고 내부 개행은 유지한다", () => {
    const paragraphs = parseTextParagraphs("첫 줄\n둘째 줄\n\n셋째 줄\n넷째 줄\n\n\n다섯째 줄");

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toMatchObject({
      id: "para-0",
      text: "첫 줄\n둘째 줄",
      startOffset: 0,
      endOffset: 8,
    });
    expect(paragraphs[1].text).toBe("셋째 줄\n넷째 줄");
    expect(paragraphs[2].text).toBe("다섯째 줄");
  });

  it("개행을 정규화한다", () => {
    expect(normalizeTextContent("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("v2 anchor를 절대 offset으로 복원한다", () => {
    const text = "첫 줄\n둘째 줄\n\n셋째 줄";
    const paragraphs = parseTextParagraphs(text);
    const anchor = createViewportAnchor(text, paragraphs, "para-1", 2);

    expect(anchor).not.toBeNull();
    expect(resolveSavedAnchorToAbsoluteOffset(text, paragraphs, anchor)).toBe(paragraphs[1].startOffset + 2);
  });

  it("구형 anchor는 context 또는 offset으로 복원한다", () => {
    const text = "AAAA BBBB CCCC";
    const paragraphs = parseTextParagraphs(text);

    expect(
      resolveSavedAnchorToAbsoluteOffset(text, paragraphs, {
        kind: "txt_anchor",
        before: "AAAA ",
        after: "BBBB",
      }),
    ).toBe(5);

    expect(
      resolveSavedAnchorToAbsoluteOffset(text, paragraphs, {
        kind: "txt_anchor",
        offset: 3,
      }),
    ).toBe(3);
  });

  it("절대 offset으로 가장 가까운 문단을 찾는다", () => {
    const paragraphs = parseTextParagraphs("하나\n둘\n\n셋");
    expect(findParagraphForAbsoluteOffset(paragraphs, 1)?.id).toBe("para-0");
    expect(findParagraphForAbsoluteOffset(paragraphs, 999)?.id).toBe("para-1");
  });
});
