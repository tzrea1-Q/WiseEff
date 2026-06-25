import { describe, expect, it } from "vitest";
import { stripEmbeddedThinking, stripEmbeddedThinkingForStream } from "./xiaozeMessageContent";

const OPEN = `<${"redacted"}_${"thinking"}>`;
const CLOSE = `</${"redacted"}_${"thinking"}>`;

describe("stripEmbeddedThinking", () => {
  it("removes redacted thinking blocks from assistant text", () => {
    expect(stripEmbeddedThinking(`${OPEN}internal${CLOSE}\n我是小泽。`)).toBe("我是小泽。");
  });

  it("keeps streaming text stable without trimming whitespace", () => {
    expect(stripEmbeddedThinkingForStream("  第一行\n")).toBe("  第一行\n");
  });
});
