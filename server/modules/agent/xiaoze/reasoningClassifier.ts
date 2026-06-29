import type { RunEventSinkEvent } from "./runEventSink";
import {
  classifyStreamingModelContent,
  mergeReasoningText,
  splitAssistantContent,
  splitStreamingAssistantContent
} from "./splitAssistantContent";

export type ReasoningClassifierOptions = {
  fallbackHeuristic: boolean;
};

export type ClassifiedContent = {
  reasoning: string;
  answer: string;
};

export type ReasoningStreamChunk = {
  reasoningDelta?: string;
  answerDelta?: string;
};

export type ReasoningStreamRouter = {
  ingestChunk(chunk: LangChainChunkLike): ReasoningStreamChunk[];
};

export type LangChainChunkLike = {
  content?: unknown;
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
};

type TurnStreamFlags = {
  streamedReasoning: boolean;
  streamedReasoningText: string;
  streamedAnswer: boolean;
  streamedAnswerText: string;
};

function appendStreamText(previous: string, incoming: string): { next: string; delta: string } {
  if (!incoming) {
    return { next: previous, delta: "" };
  }
  if (previous && incoming.startsWith(previous)) {
    return { next: incoming, delta: incoming.slice(previous.length) };
  }
  if (previous && previous.startsWith(incoming)) {
    return { next: previous, delta: "" };
  }
  return { next: previous + incoming, delta: incoming };
}

export function readReasoningFromLangChainResponse(response: LangChainChunkLike): string | undefined {
  const additional = response.additional_kwargs ?? {};
  const metadata = response.response_metadata ?? {};
  const reasoningDetails = additional.reasoning_details ?? metadata.reasoning_details;
  if (Array.isArray(reasoningDetails)) {
    const text = reasoningDetails
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (entry && typeof entry === "object" && "text" in entry) {
          return String((entry as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text) {
      return text;
    }
  }

  const reasoningContent = additional.reasoning_content ?? metadata.reasoning_content;
  return typeof reasoningContent === "string" ? reasoningContent.trim() : undefined;
}

function classifyTaggedOrFallbackContent(contentBuffer: string, fallbackHeuristic: boolean): ClassifiedContent {
  const tagged = splitStreamingAssistantContent(contentBuffer);
  if (tagged.reasoning || !fallbackHeuristic) {
    return tagged;
  }
  return classifyStreamingModelContent(contentBuffer);
}

export function createReasoningClassifier(options: ReasoningClassifierOptions) {
  function classifyContentBuffer(contentBuffer: string, reasoningFromMetadata = ""): ClassifiedContent {
    const split = classifyTaggedOrFallbackContent(contentBuffer, options.fallbackHeuristic);
    return {
      reasoning: mergeReasoningText(reasoningFromMetadata, split.reasoning),
      answer: split.answer
    };
  }

  function normalizeModelResponse(response: { content?: string; reasoning?: string }) {
    const split = splitAssistantContent(response.content ?? "");
    const reasoning = mergeReasoningText(response.reasoning, split.reasoning);
    const answer = split.answer || (reasoning ? "" : response.content ?? "");
    return {
      answer: answer.trim(),
      reasoning: reasoning || undefined
    };
  }

  function normalizeSinkEvent(event: RunEventSinkEvent, flags: TurnStreamFlags): RunEventSinkEvent {
    if (event.type === "reasoning_delta") {
      flags.streamedReasoning = true;
      flags.streamedReasoningText += event.delta;
      return event;
    }
    if (event.type === "answer_delta") {
      flags.streamedAnswer = true;
      flags.streamedAnswerText += event.delta;
      return event;
    }
    return event;
  }

  function createStreamRouter(): ReasoningStreamRouter {
    let contentBuffer = "";
    let emittedReasoningLength = 0;
    let emittedAnswerLength = 0;
    let reasoningFromMetadata = "";

    return {
      ingestChunk(chunk: LangChainChunkLike): ReasoningStreamChunk[] {
        const events: ReasoningStreamChunk[] = [];
        const chunkReasoningFull = readReasoningFromLangChainResponse(chunk);
        if (chunkReasoningFull) {
          const { next, delta } = appendStreamText(reasoningFromMetadata, chunkReasoningFull);
          if (delta) {
            reasoningFromMetadata = next;
          }
        }

        const rawContent = typeof chunk.content === "string" ? chunk.content : "";
        if (rawContent) {
          contentBuffer = appendStreamText(contentBuffer, rawContent).next;
        }

        if (!chunkReasoningFull && !rawContent) {
          return events;
        }

        const split = classifyContentBuffer(contentBuffer, reasoningFromMetadata);
        if (split.reasoning.length > emittedReasoningLength) {
          const reasoningDelta = split.reasoning.slice(emittedReasoningLength);
          emittedReasoningLength = split.reasoning.length;
          if (reasoningDelta) {
            events.push({ reasoningDelta });
          }
        }

        if (split.answer.length > emittedAnswerLength) {
          const answerDelta = split.answer.slice(emittedAnswerLength);
          emittedAnswerLength = split.answer.length;
          if (answerDelta) {
            events.push({ answerDelta });
          }
        }

        return events;
      }
    };
  }

  return {
    classifyContentBuffer,
    normalizeModelResponse,
    normalizeSinkEvent,
    createStreamRouter
  };
}

export type ReasoningClassifier = ReturnType<typeof createReasoningClassifier>;

export function createDefaultReasoningClassifier(env: Pick<{ XIAOZE_REASONING_FALLBACK_HEURISTIC?: boolean }, "XIAOZE_REASONING_FALLBACK_HEURISTIC">) {
  return createReasoningClassifier({
    fallbackHeuristic: env.XIAOZE_REASONING_FALLBACK_HEURISTIC ?? false
  });
}
