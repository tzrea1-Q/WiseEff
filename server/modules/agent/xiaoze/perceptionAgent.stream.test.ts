import { describe, expect, it } from "vitest";
import {
  appendStreamText,
  isLikelyUserFacingAnswerDelta,
  shouldBeginAnswerPhase,
  wrapLangChainChatModel
} from "./perceptionAgent";

describe("appendStreamText", () => {
  it("supports cumulative and delta chunk shapes", () => {
    expect(appendStreamText("The user", "The user said")).toEqual({
      next: "The user said",
      delta: " said"
    });
    expect(appendStreamText("The user said", " hello")).toEqual({
      next: "The user said hello",
      delta: " hello"
    });
  });
});

describe("shouldBeginAnswerPhase", () => {
  it("keeps english thinking in the reasoning phase", () => {
    expect(
      shouldBeginAnswerPhase({
        answerPhase: false,
        sawReasoningMetadata: false,
        chunkHasReasoningMetadata: false,
        reasoningFromContent: "The user just said hello.",
        rawContent: "The user just said hello. I should greet",
        delta: " I should greet"
      })
    ).toBe(false);
  });

  it("starts answer phase when chinese reply begins", () => {
    expect(
      isLikelyUserFacingAnswerDelta("你好！我是小泽", "The user just said hello. I should greet them back.")
    ).toBe(true);
  });
});

describe("wrapLangChainChatModel stream routing", () => {
  it("routes untagged english thinking in content to reasoning deltas", async () => {
    const chunks = [
      { content: "The user just said hello." },
      { content: "The user just said hello. I should greet them back in Chinese." },
      { content: "The user just said hello. I should greet them back in Chinese.\n\n你好！我是小泽。" }
    ];
    let index = 0;
    const wrapped = wrapLangChainChatModel({
      async invoke() {
        return { content: chunks.at(-1)?.content ?? "" };
      },
      async stream() {
        return (async function* () {
          while (index < chunks.length) {
            yield chunks[index]!;
            index += 1;
          }
        })();
      }
    });

    const events: Array<{ reasoningDelta?: string; answerDelta?: string }> = [];
    for await (const chunk of wrapped.stream!([])) {
      events.push(chunk);
    }

    expect(events.some((event) => event.answerDelta)).toBe(true);
    expect(events.filter((event) => event.reasoningDelta).length).toBeGreaterThan(0);
    expect(events.find((event) => event.answerDelta)?.answerDelta).toContain("你好");
    expect(events.some((event) => event.reasoningDelta?.includes("The user"))).toBe(true);
    expect(events.some((event) => event.answerDelta?.includes("The user"))).toBe(false);
  });

  it("routes redacted_thinking tags in content to reasoning deltas only", async () => {
    const OPEN = "<think>";
    const CLOSE = "</think>";
    const chunks = [
      { content: `${OPEN}The user said hello.` },
      { content: `${OPEN}The user said hello. I should greet them back.` },
      { content: `${OPEN}The user said hello. I should greet them back.${CLOSE}\n\n你好！我是小泽。` }
    ];
    let index = 0;
    const wrapped = wrapLangChainChatModel({
      async invoke() {
        return { content: chunks.at(-1)?.content ?? "" };
      },
      async stream() {
        return (async function* () {
          while (index < chunks.length) {
            yield chunks[index]!;
            index += 1;
          }
        })();
      }
    });

    const events: Array<{ reasoningDelta?: string; answerDelta?: string }> = [];
    for await (const chunk of wrapped.stream!([])) {
      events.push(chunk);
    }

    expect(events.some((event) => event.reasoningDelta?.includes("The user"))).toBe(true);
    expect(events.some((event) => event.answerDelta?.includes("你好"))).toBe(true);
    expect(events.some((event) => event.answerDelta?.includes("redacted_thinking"))).toBe(false);
    expect(events.some((event) => event.answerDelta?.includes("The user"))).toBe(false);
  });

  it("routes delta-only minimax chunks with redacted_thinking tags", async () => {
    const deltas = [
      "<think>The user greeted me in Chinese with \"你好\" (Hello). I should respond in Chinese and introduce m",
      "yself briefly.",
      "</think>\n\n你好！我是小泽。",
      " 我可以帮你查询参数。"
    ];
    let index = 0;
    const wrapped = wrapLangChainChatModel({
      async invoke() {
        return { content: deltas.join("") };
      },
      async stream() {
        return (async function* () {
          while (index < deltas.length) {
            yield { content: deltas[index]! };
            index += 1;
          }
        })();
      }
    });

    const events: Array<{ reasoningDelta?: string; answerDelta?: string }> = [];
    for await (const chunk of wrapped.stream!([])) {
      events.push(chunk);
    }

    expect(events.some((event) => event.reasoningDelta?.includes("The user greeted"))).toBe(true);
    expect(events.some((event) => event.answerDelta?.includes("你好"))).toBe(true);
    expect(events.some((event) => event.answerDelta?.includes("redacted_thinking"))).toBe(false);
    expect(events.some((event) => event.answerDelta?.includes("The user"))).toBe(false);
  });
});
