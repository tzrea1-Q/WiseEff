import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createReasoningClassifier, readReasoningFromLangChainResponse } from "./reasoningClassifier";
import { mergeReasoningText, splitStreamingAssistantContent } from "./splitAssistantContent";

const SEED = 20260629;
const NUM_RUNS = 60;

type StructuredTurn = {
  metadataReasoning?: string;
  answer: string;
};

function expectedClassification(turn: StructuredTurn, fallbackHeuristic: boolean) {
  const tagSplit = splitStreamingAssistantContent(turn.answer);
  const combinedReasoning = mergeReasoningText(turn.metadataReasoning, tagSplit.reasoning);

  if (combinedReasoning) {
    return { reasoning: combinedReasoning, answer: tagSplit.answer };
  }

  if (fallbackHeuristic) {
    return createReasoningClassifier({ fallbackHeuristic: true }).classifyContentBuffer(turn.answer);
  }

  return { reasoning: "", answer: tagSplit.answer || turn.answer.trim() };
}

function cumulativeChunks(text: string, boundaries: number[]) {
  if (!text) {
    return [] as string[];
  }
  const cuts = [0, ...boundaries.filter((value) => value > 0 && value < text.length).sort((a, b) => a - b), text.length];
  const uniqueCuts = [...new Set(cuts)];
  return uniqueCuts.slice(1).map((end) => text.slice(0, end));
}

function simulateStreamingTurn(
  turn: StructuredTurn,
  fallbackHeuristic: boolean,
  metadataBoundaries: number[],
  contentBoundaries: number[],
  schedule: Array<"metadata" | "content">
) {
  const classifier = createReasoningClassifier({ fallbackHeuristic });
  const router = classifier.createStreamRouter();
  const metadata = turn.metadataReasoning ?? "";
  const content = turn.answer;

  const metadataChunks = cumulativeChunks(metadata, metadataBoundaries);
  const contentChunks = cumulativeChunks(content, contentBoundaries);
  const events: Array<{ reasoningDelta?: string; answerDelta?: string }> = [];

  let metadataIndex = 0;
  let contentIndex = 0;
  for (const channel of schedule) {
    if (channel === "metadata") {
      if (metadataIndex >= metadataChunks.length) {
        continue;
      }
      events.push(
        ...router.ingestChunk({
          additional_kwargs: { reasoning_content: metadataChunks[metadataIndex] }
        })
      );
      metadataIndex += 1;
      continue;
    }
    if (contentIndex >= contentChunks.length) {
      continue;
    }
    events.push(...router.ingestChunk({ content: contentChunks[contentIndex] }));
    contentIndex += 1;
  }

  while (metadataIndex < metadataChunks.length) {
    events.push(
      ...router.ingestChunk({
        additional_kwargs: { reasoning_content: metadataChunks[metadataIndex] }
      })
    );
    metadataIndex += 1;
  }
  while (contentIndex < contentChunks.length) {
    events.push(...router.ingestChunk({ content: contentChunks[contentIndex] }));
    contentIndex += 1;
  }

  const reasoning = events.map((event) => event.reasoningDelta ?? "").join("");
  const answer = events.map((event) => event.answerDelta ?? "").join("");

  let cumulativeAnswer = "";
  for (const event of events) {
    if (event.answerDelta) {
      cumulativeAnswer += event.answerDelta;
      expect(cumulativeAnswer.length).toBeGreaterThanOrEqual(cumulativeAnswer.trim().length === 0 ? 0 : 1);
    }
  }

  return { reasoning, answer };
}

const structuredTurnArb = fc.record({
  metadataReasoning: fc.option(fc.string({ minLength: 1, maxLength: 24 }), { nil: undefined }),
  answer: fc.string({ minLength: 0, maxLength: 40 })
});

describe("reasoningClassifier property tests", () => {
  it("reconstructs reasoning and answer from arbitrary interleaved chunks (fallback off)", () => {
    fc.assert(
      fc.property(
        structuredTurnArb,
        fc.array(fc.nat({ max: 20 }), { maxLength: 6 }),
        fc.array(fc.nat({ max: 20 }), { maxLength: 6 }),
        fc.array(fc.constantFrom("metadata", "content"), { minLength: 1, maxLength: 12 }),
        (turn, metadataBoundaries, contentBoundaries, schedule) => {
          const expected = expectedClassification(turn, false);
          const streamed = simulateStreamingTurn(turn, false, metadataBoundaries, contentBoundaries, schedule);
          expect(streamed.reasoning).toBe(expected.reasoning);
          expect(streamed.answer).toBe(expected.answer);
        }
      ),
      { seed: SEED, numRuns: NUM_RUNS }
    );
  });

  it("reconstructs reasoning and answer from arbitrary interleaved chunks (fallback on)", () => {
    fc.assert(
      fc.property(
        structuredTurnArb,
        fc.array(fc.nat({ max: 20 }), { maxLength: 6 }),
        fc.array(fc.nat({ max: 20 }), { maxLength: 6 }),
        fc.array(fc.constantFrom("metadata", "content"), { minLength: 1, maxLength: 12 }),
        (turn, metadataBoundaries, contentBoundaries, schedule) => {
          const expected = expectedClassification(turn, true);
          const streamed = simulateStreamingTurn(turn, true, metadataBoundaries, contentBoundaries, schedule);
          expect(streamed.reasoning).toBe(expected.reasoning);
          expect(streamed.answer).toBe(expected.answer);
        }
      ),
      { seed: SEED + 1, numRuns: NUM_RUNS }
    );
  });

  it("never misclassifies plain english answers as reasoning when fallback is off", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }).filter((value) => /^[\x20-\x7E]+$/.test(value)), (answer) => {
        const classifier = createReasoningClassifier({ fallbackHeuristic: false });
        const result = classifier.classifyContentBuffer(answer);
        expect(result.reasoning).toBe("");
        expect(result.answer).toBe(answer.trim());
      }),
      { seed: SEED + 2, numRuns: NUM_RUNS }
    );
  });

  it("reads reasoning_content cumulatively from partial langchain chunks", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 4 }), (parts) => {
        let cumulative = "";
        let last: string | undefined;
        for (const part of parts) {
          cumulative += part;
          last = readReasoningFromLangChainResponse({
            additional_kwargs: { reasoning_content: cumulative }
          });
        }
        expect(last).toBe(cumulative.trim());
      }),
      { seed: SEED + 3, numRuns: NUM_RUNS }
    );
  });
});
