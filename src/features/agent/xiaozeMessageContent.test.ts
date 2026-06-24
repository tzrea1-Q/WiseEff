import { describe, expect, it } from "vitest";
import { stripEmbeddedThinking } from "./xiaozeMessageContent";

const OPEN = `<${"redacted"}_${"thinking"}>`;
const CLOSE = `</${"redacted"}_${"thinking"}>`;

describe("stripEmbeddedThinking", () => {
  it("removes redacted thinking blocks from assistant text", () => {
    expect(stripEmbeddedThinking(`${OPEN}internal${CLOSE}\n我是小泽。`)).toBe("我是小泽。");
  });
});
