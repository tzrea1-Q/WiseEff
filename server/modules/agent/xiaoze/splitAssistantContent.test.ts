import { describe, expect, it } from "vitest";
import { mergeReasoningText, splitAssistantContent } from "./splitAssistantContent";

const OPEN = `<${"redacted"}_${"thinking"}>`;
const CLOSE = `</${"redacted"}_${"thinking"}>`;

describe("splitAssistantContent", () => {
  it("splits redacted_thinking tags from the answer", () => {
    const result = splitAssistantContent(`${OPEN}The user asked who I am.${CLOSE}\n我是小泽，WiseEff 的感知与行动助手。`);

    expect(result.reasoning).toBe("The user asked who I am.");
    expect(result.answer).toBe("我是小泽，WiseEff 的感知与行动助手。");
  });

  it("handles multiple thinking blocks", () => {
    const result = splitAssistantContent(`${OPEN}Step one${CLOSE}\n${OPEN}Step two${CLOSE}\nFinal answer`);

    expect(result.reasoning).toBe("Step one\n\nStep two");
    expect(result.answer).toBe("Final answer");
  });

  it("returns plain answers unchanged", () => {
    const result = splitAssistantContent("只有最终回答。");
    expect(result.reasoning).toBe("");
    expect(result.answer).toBe("只有最终回答。");
  });
});

describe("mergeReasoningText", () => {
  it("joins non-empty reasoning chunks", () => {
    expect(mergeReasoningText("a", "", "b")).toBe("a\n\nb");
  });
});
