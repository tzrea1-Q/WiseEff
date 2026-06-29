import { describe, expect, it } from "vitest";
import {
  createReasoningClassifier,
  readReasoningFromLangChainResponse,
  type ReasoningStreamRouter
} from "./reasoningClassifier";

const OPEN = `<${"redacted"}_${"thinking"}>`;
const CLOSE = `</${"redacted"}_${"thinking"}>`;

describe("readReasoningFromLangChainResponse", () => {
  it("reads reasoning_details array entries", () => {
    const text = readReasoningFromLangChainResponse({
      additional_kwargs: {
        reasoning_details: [{ text: "Step one" }, { text: "Step two" }]
      }
    });
    expect(text).toBe("Step one\n\nStep two");
  });

  it("reads reasoning_content string", () => {
    const text = readReasoningFromLangChainResponse({
      response_metadata: { reasoning_content: "  internal note  " }
    });
    expect(text).toBe("internal note");
  });
});

describe("createReasoningClassifier", () => {
  describe("fallbackHeuristic=false (default production)", () => {
    const classifier = createReasoningClassifier({ fallbackHeuristic: false });

    it("treats plain english answers as answer-only content", () => {
      const result = classifier.classifyContentBuffer("Hello! I am Xiaoze, your assistant.");
      expect(result.reasoning).toBe("");
      expect(result.answer).toBe("Hello! I am Xiaoze, your assistant.");
    });

    it("does not split english thinking mixed into untagged content", () => {
      const raw = "The user just said hello. I should greet them back in Chinese.\n\n你好！我是小泽。";
      const result = classifier.classifyContentBuffer(raw);
      expect(result.reasoning).toBe("");
      expect(result.answer).toBe(raw);
    });

    it("extracts reasoning from redacted_thinking tags", () => {
      const raw = `${OPEN}The user asked who I am.${CLOSE}\n我是小泽。`;
      const result = classifier.classifyContentBuffer(raw);
      expect(result.reasoning).toBe("The user asked who I am.");
      expect(result.answer).toBe("我是小泽。");
    });

    it("merges structured metadata reasoning with tagged content reasoning", () => {
      const raw = `${OPEN}tagged thought${CLOSE}\nanswer text`;
      const result = classifier.classifyContentBuffer(raw, "metadata reasoning");
      expect(result.reasoning).toBe("metadata reasoning\n\ntagged thought");
      expect(result.answer).toBe("answer text");
    });

    it("routes metadata-only reasoning separately from answer content", () => {
      const result = classifier.classifyContentBuffer("Final answer only.", "Need to check parameters.");
      expect(result.reasoning).toBe("Need to check parameters.");
      expect(result.answer).toBe("Final answer only.");
    });

    it("passes answer_delta through without rerouting to reasoning", () => {
      const flags = {
        streamedReasoning: false,
        streamedReasoningText: "",
        streamedAnswer: false,
        streamedAnswerText: ""
      };
      const normalized = classifier.normalizeSinkEvent(
        { type: "answer_delta", delta: "The user asked about charge parameters." },
        flags
      );
      expect(normalized).toEqual({
        type: "answer_delta",
        delta: "The user asked about charge parameters."
      });
      expect(flags.streamedAnswerText).toBe("The user asked about charge parameters.");
      expect(flags.streamedReasoningText).toBe("");
    });
  });

  describe("fallbackHeuristic=true (legacy opt-in)", () => {
    const classifier = createReasoningClassifier({ fallbackHeuristic: true });

    it("splits untagged english thinking before chinese answer text", () => {
      const raw = "The user just said hello. I should greet them back.\n\n你好！我是小泽。";
      const result = classifier.classifyContentBuffer(raw);
      expect(result.reasoning).toContain("The user");
      expect(result.answer).toContain("你好");
    });

    it("keeps pure english internal monologue as reasoning", () => {
      const result = classifier.classifyContentBuffer("The user asked about charge parameters.");
      expect(result.reasoning).toBe("The user asked about charge parameters.");
      expect(result.answer).toBe("");
    });
  });
});

describe("ReasoningStreamRouter", () => {
  it("routes structured metadata reasoning and tagged answer through streaming chunks", () => {
    const classifier = createReasoningClassifier({ fallbackHeuristic: false });
    const router = classifier.createStreamRouter();
    const chunks = [
      { additional_kwargs: { reasoning_content: "Need to" } },
      { additional_kwargs: { reasoning_content: "Need to summarize." }, content: `${OPEN}Check` },
      {
        additional_kwargs: { reasoning_content: "Need to summarize." },
        content: `${OPEN}Check params${CLOSE}\n\nFound 3 items.`
      }
    ];

    const events: Array<{ reasoningDelta?: string; answerDelta?: string }> = [];
    for (const chunk of chunks) {
      events.push(...router.ingestChunk(chunk));
    }

    const reasoning = events.map((event) => event.reasoningDelta ?? "").join("");
    const answer = events.map((event) => event.answerDelta ?? "").join("");
    expect(reasoning).toContain("Need to summarize.");
    expect(reasoning).toContain("Check params");
    expect(answer).toBe("Found 3 items.");
    expect(answer).not.toContain("Need to");
  });
});
