import { type XiaozeCitation, type XiaozeRunStep, type XiaozeTurnReplyPayload, type XiaozeTurnPhase, type XiaozeTurnStatePayload } from "@wiseeff/xiaoze-protocol";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { readCitationsFromMetadata } from "./XiaozeCitationSources";
import { readRunStepsFromMetadata } from "./XiaozeTurnTimeline";
import { presentRunStep } from "./xiaozeStepPresentation";
import { isXiaozeReasoningStreaming } from "./xiaozeThinkingState";
import { dedupeRepeatedAnswerText, looksLikeInternalReasoning, stripEmbeddedThinking } from "./xiaozeMessageContent";
import { readMessageText, type XiaozeConversationTurn } from "./xiaozeTurnGrouping";

export type XiaozeTurnViewInput = {
  turn: XiaozeConversationTurn;
  assistant: AssistantMessage | undefined;
  messages: Message[];
  isLatest: boolean;
  isRunning: boolean;
  turnReply: XiaozeTurnReplyPayload | undefined;
  turnState: XiaozeTurnStatePayload | undefined;
  liveRunSteps: XiaozeRunStep[];
};

export type XiaozeTurnView = {
  isActiveTurn: boolean;
  userMessageText: string;
  promptDebugRunId: string | undefined;
  steps: XiaozeRunStep[];
  citations: XiaozeCitation[];
  answerText: string;
  answerStreaming: boolean;
  reasoningText: string;
  reasoningMessageId: string | undefined;
  isReasoningStreaming: boolean;
  showReasoningPanel: boolean;
  showThinkingFallback: boolean;
  showAnswer: boolean;
  showPhaseStrip: boolean;
  phase: XiaozeTurnPhase | undefined;
};

function countChinese(text: string) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

/** Hold back a partially streamed answer while tools are still running and no authoritative reply exists. */
export function shouldDeferTurnAnswer(input: {
  isActiveTurn: boolean;
  isRunning: boolean;
  turnReply?: XiaozeTurnReplyPayload;
  steps: XiaozeRunStep[];
}) {
  if (!input.isActiveTurn || !input.isRunning) {
    return false;
  }
  if (input.turnReply?.text?.trim()) {
    return false;
  }
  const hasToolSteps = input.steps.some((step) => step.kind === "tool");
  if (!hasToolSteps) {
    return false;
  }
  return true;
}

/** Pick the user-facing answer between the streamed message and the authoritative turn reply. */
export function resolveTurnAnswerText(
  assistant: AssistantMessage | undefined,
  turnReply: XiaozeTurnReplyPayload | undefined,
  isStreaming = false,
  deferPartial = false
) {
  if (deferPartial) {
    return "";
  }
  const fromReply = turnReply?.text?.trim() ?? "";
  const fromMessage = assistant ? stripEmbeddedThinking(readMessageText(assistant.content)) : "";

  if (!isStreaming && fromReply) {
    const replyFacing = countChinese(fromReply) > 0 || !looksLikeInternalReasoning(fromReply);
    if (replyFacing) {
      return dedupeRepeatedAnswerText(fromReply);
    }
  }

  const candidates = [fromMessage, fromReply].filter(Boolean);
  const userFacing = candidates.filter((text) => countChinese(text) > 0 || !looksLikeInternalReasoning(text));

  if (userFacing.length === 0) {
    return "";
  }

  return dedupeRepeatedAnswerText(userFacing.sort((left, right) => right.length - left.length)[0] ?? "");
}

/**
 * The single adjudication point for rendering one Xiaoze turn. Seven sources
 * feed a turn (streamed assistant message, authoritative turn reply, live
 * turn-state snapshots, live run steps, persisted metadata, the reasoning
 * message, and run flags); this pure function owns every precedence rule and
 * display gate so `XiaozeTurnBlock` can render the result without deciding
 * anything.
 */
export function resolveXiaozeTurnView(input: XiaozeTurnViewInput): XiaozeTurnView {
  const { turn, assistant, messages, isLatest, isRunning, turnReply, turnState, liveRunSteps } = input;

  const isActiveTurn = isLatest && isRunning;
  const userMessageText = readMessageText(turn.user.content);
  const promptDebugRunId = turnState?.runId ?? turnReply?.runId;

  const metadata = (assistant as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  // Step precedence: live frames while the turn runs, then the authoritative
  // reply, then the last turn-state snapshot, then persisted thread metadata.
  const persistedSteps = turnReply?.runSteps?.length
    ? turnReply.runSteps
    : turnState?.steps?.length
      ? turnState.steps
      : readRunStepsFromMetadata(metadata);
  const rawSteps = isActiveTurn && liveRunSteps.length > 0 ? liveRunSteps : persistedSteps;
  const steps = rawSteps.map(presentRunStep);

  const citations = turnReply?.citations?.length ? turnReply.citations : readCitationsFromMetadata(metadata);

  const deferPartial = shouldDeferTurnAnswer({ isActiveTurn, isRunning, turnReply, steps });
  const answerText =
    turnState?.phase === "done" && turnState.text?.trim()
      ? turnState.text.trim()
      : resolveTurnAnswerText(assistant, turnReply, isActiveTurn, deferPartial);

  const reasoningText =
    readMessageText(turn.reasoning?.content) || turnReply?.reasoning?.trim() || turnState?.reasoning?.trim() || "";
  const reasoningMessageId = turn.reasoning?.id ?? turnReply?.reasoningMessageId ?? turnState?.reasoningMessageId;
  const isReasoningStreaming =
    turn.reasoning && isXiaozeReasoningStreaming(turn.reasoning, messages, isRunning)
      ? true
      : isActiveTurn && isRunning && !answerText && (turnState?.phase === "thinking" || (!turnState && steps.length === 0));

  const showReasoningPanel = isReasoningStreaming || reasoningText.length > 0;
  const showThinkingFallback = isActiveTurn && !answerText && !showReasoningPanel;
  const showAnswer = answerText.length > 0;
  const showPhaseStrip = steps.length > 0 || (turnState !== undefined && turnState.phase !== "done");
  const phase =
    turnState?.phase ?? (isActiveTurn && steps.some((step) => step.status === "running") ? "tool" : undefined);
  const answerStreaming = isActiveTurn && isRunning && turnState?.phase === "composing";

  return {
    isActiveTurn,
    userMessageText,
    promptDebugRunId,
    steps,
    citations,
    answerText,
    answerStreaming,
    reasoningText,
    reasoningMessageId,
    isReasoningStreaming,
    showReasoningPanel,
    showThinkingFallback,
    showAnswer,
    showPhaseStrip,
    phase
  };
}
