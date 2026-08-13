import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import type { AgentCitation } from "../types";
import { splitAssistantContent, mergeReasoningText } from "./splitAssistantContent";
import { getXiaozeToolLabel } from "./toolCatalog";
import type { XiaozePromptDebugSnapshot } from "./modelTypes";
import { serializeTurnSteps, type RunEventSinkEvent } from "./runEventSink";
import {
  XIAOZE_INTERRUPT_EVENT,
  XIAOZE_PROMPT_DEBUG_EVENT,
  XIAOZE_RUN_TIMING_EVENT,
  XIAOZE_TURN_REPLY_EVENT,
  XIAOZE_TURN_STATE_EVENT,
  type XiaozeRunStep,
  type XiaozeTurnPhase,
  type XiaozeTurnStatePayload
} from "@wiseeff/xiaoze-protocol";

export type AgUiStreamEvent = { event: string; data: Record<string, unknown> };

export { XIAOZE_INTERRUPT_EVENT, XIAOZE_RUN_TIMING_EVENT } from "@wiseeff/xiaoze-protocol";

export type XiaozeTurnStreamIds = {
  threadId: string;
  runId: string;
  assistantMessageId: string;
  reasoningMessageId: string;
  runStartedAtMs: number;
};

export type XiaozeTurnReply = {
  text: string;
  reasoning?: string;
};

export type XiaozeTurnFinalizeInput = {
  text: string;
  reasoning?: string;
  citations?: AgentCitation[];
  runSteps?: XiaozeRunStep[];
  promptDebug?: XiaozePromptDebugSnapshot;
  promptDebugModel?: string;
};

export type XiaozeApprovalInterrupt = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  payload: Record<string, unknown>;
  citations: AgentCitation[];
};

export function createReasoningMessageId() {
  return randomUUID();
}

function normalizeStreamText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function hasStreamedCompleteAnswer(finalText: string, streamedText: string) {
  const final = normalizeStreamText(finalText);
  const streamed = normalizeStreamText(streamedText);
  if (!final || !streamed) {
    return false;
  }
  if (final === streamed) {
    return true;
  }
  return final.startsWith(streamed) && streamed.length >= final.length * 0.9;
}

function computeRemainingStreamText(finalText: string, streamedText: string) {
  if (!finalText.trim()) {
    return "";
  }
  if (!streamedText) {
    return finalText;
  }
  if (finalText.startsWith(streamedText)) {
    return finalText.slice(streamedText.length);
  }
  return finalText;
}

function needsFullAnswerResync(finalText: string, streamedText: string) {
  return Boolean(finalText.trim() && streamedText && !finalText.startsWith(streamedText));
}

/** Split a run result into the user-visible reply, merging embedded reasoning. */
export function buildAssistantReply(result: { text: string; reasoning?: string }): XiaozeTurnReply {
  const raw = result.text.trim();
  const fallback = splitAssistantContent(raw);
  const reasoning = mergeReasoningText(result.reasoning, fallback.reasoning) || undefined;
  return {
    text: fallback.answer || raw,
    reasoning
  };
}

/**
 * The Xiaoze turn stream: a synchronous reducer that owns the single copy of
 * "what has streamed so far" for one AG-UI run and produces every frame the
 * endpoint writes. The endpoint keeps transport concerns only (auth, request
 * parsing, pumping the run event sink, persistence, SSE serialization); no
 * frame literal or streaming-progress state lives outside this module.
 */
export function createXiaozeTurnStream(ids: XiaozeTurnStreamIds) {
  // The only copy of streaming progress (previously mirrored across
  // TurnStreamFlags, XiaozeTurnStateTracker, and the classifier bookkeeping).
  let streamedReasoning = false;
  let streamedReasoningText = "";
  let streamedAnswer = false;
  let streamedAnswerText = "";
  let assistantShellStarted = false;
  let reasoningEnded = false;
  let phase: XiaozeTurnPhase = "thinking";
  let hadToolActivity = false;
  const steps = new Map<string, XiaozeRunStep>();

  function custom(name: string, value: unknown): AgUiStreamEvent {
    return {
      event: EventType.CUSTOM,
      data: { type: EventType.CUSTOM, name, value }
    };
  }

  function reasoningContentEvent(delta: string): AgUiStreamEvent {
    return {
      event: EventType.REASONING_MESSAGE_CONTENT,
      data: { type: EventType.REASONING_MESSAGE_CONTENT, messageId: ids.reasoningMessageId, delta }
    };
  }

  function reasoningEndEvents(): AgUiStreamEvent[] {
    if (reasoningEnded) {
      return [];
    }
    reasoningEnded = true;
    return [
      {
        event: EventType.REASONING_MESSAGE_END,
        data: { type: EventType.REASONING_MESSAGE_END, messageId: ids.reasoningMessageId }
      }
    ];
  }

  function assistantShellEvents(): AgUiStreamEvent[] {
    if (assistantShellStarted) {
      return [];
    }
    assistantShellStarted = true;
    return [
      {
        event: EventType.TEXT_MESSAGE_START,
        data: { type: EventType.TEXT_MESSAGE_START, messageId: ids.assistantMessageId, role: "assistant" }
      }
    ];
  }

  function answerContentEvent(delta: string): AgUiStreamEvent {
    return {
      event: EventType.TEXT_MESSAGE_CONTENT,
      data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: ids.assistantMessageId, delta }
    };
  }

  function answerEndEvent(): AgUiStreamEvent {
    return {
      event: EventType.TEXT_MESSAGE_END,
      data: { type: EventType.TEXT_MESSAGE_END, messageId: ids.assistantMessageId }
    };
  }

  function snapshot(extra?: Partial<Pick<XiaozeTurnStatePayload, "text" | "reasoning" | "answerStreaming">>): XiaozeTurnStatePayload {
    return {
      runId: ids.runId,
      messageId: ids.assistantMessageId,
      reasoningMessageId: ids.reasoningMessageId,
      phase,
      steps: [...steps.values()],
      text: extra?.text ?? (streamedAnswerText.trim() || undefined),
      reasoning: extra?.reasoning,
      answerStreaming: extra?.answerStreaming ?? (phase === "composing")
    };
  }

  function turnStateEvent(extra?: Parameters<typeof snapshot>[0]): AgUiStreamEvent {
    return custom(XIAOZE_TURN_STATE_EVENT, snapshot(extra));
  }

  function timingEvent(timingPhase: "finished" | "error"): AgUiStreamEvent {
    return custom(XIAOZE_RUN_TIMING_EVENT, {
      runId: ids.runId,
      reasoningMessageId: ids.reasoningMessageId,
      startedAt: ids.runStartedAtMs,
      durationMs: Math.max(0, Date.now() - ids.runStartedAtMs),
      phase: timingPhase
    });
  }

  function runFinishedEvent(outcome: Record<string, unknown>): AgUiStreamEvent {
    return {
      event: EventType.RUN_FINISHED,
      data: { type: EventType.RUN_FINISHED, threadId: ids.threadId, runId: ids.runId, outcome }
    };
  }

  function trackStep(event: RunEventSinkEvent) {
    if (event.type === "step_started") {
      hadToolActivity = true;
      phase = "tool";
      steps.set(event.step.id, event.step);
      return;
    }
    if (event.type === "step_finished") {
      const existing = steps.get(event.stepId);
      if (existing) {
        steps.set(event.stepId, {
          ...existing,
          status: event.status,
          summary: event.summary ?? existing.summary,
          durationMs: event.durationMs ?? existing.durationMs
        });
      }
      return;
    }
    if (event.type === "answer_delta") {
      if (hadToolActivity) {
        phase = "composing";
      }
      streamedAnswer = true;
      streamedAnswerText += event.delta;
      return;
    }
    if (event.type === "reasoning_delta") {
      streamedReasoning = true;
      streamedReasoningText += event.delta;
    }
  }

  function mapSinkEvent(event: RunEventSinkEvent): AgUiStreamEvent[] {
    switch (event.type) {
      case "step_started":
        return [
          {
            event: EventType.STEP_STARTED,
            data: {
              type: EventType.STEP_STARTED,
              stepName: event.step.id,
              metadata: {
                stepId: event.step.id,
                label: event.step.label,
                kind: event.step.kind,
                toolName: event.step.toolName,
                startedAt: event.step.startedAtMs
              }
            }
          }
        ];
      case "step_finished":
        return [
          {
            event: EventType.STEP_FINISHED,
            data: {
              type: EventType.STEP_FINISHED,
              stepName: event.stepId,
              metadata: {
                stepId: event.stepId,
                status: event.status,
                summary: event.summary,
                durationMs: event.durationMs
              }
            }
          }
        ];
      case "reasoning_delta":
        return [reasoningContentEvent(event.delta)];
      case "answer_delta":
        return [answerContentEvent(event.delta)];
      case "tool_call":
        return [
          {
            event: EventType.TOOL_CALL_START,
            data: {
              type: EventType.TOOL_CALL_START,
              toolCallId: event.toolCallId,
              toolCallName: event.toolName,
              parentMessageId: ids.assistantMessageId
            }
          },
          {
            event: EventType.TOOL_CALL_ARGS,
            data: { type: EventType.TOOL_CALL_ARGS, toolCallId: event.toolCallId, delta: JSON.stringify(event.args) }
          },
          {
            event: EventType.TOOL_CALL_END,
            data: { type: EventType.TOOL_CALL_END, toolCallId: event.toolCallId }
          }
        ];
      case "tool_result":
        return [
          {
            event: EventType.TOOL_CALL_RESULT,
            data: {
              type: EventType.TOOL_CALL_RESULT,
              toolCallId: event.toolCallId,
              messageId: ids.assistantMessageId,
              content: JSON.stringify({
                label: getXiaozeToolLabel(event.toolName),
                summary: event.summary,
                status: event.status
              })
            }
          }
        ];
      default:
        return [];
    }
  }

  return {
    /** RUN_STARTED, reasoning shell, initial turn-state snapshot, assistant shell. */
    open(): AgUiStreamEvent[] {
      return [
        {
          event: EventType.RUN_STARTED,
          data: {
            type: EventType.RUN_STARTED,
            threadId: ids.threadId,
            runId: ids.runId,
            startedAt: ids.runStartedAtMs
          }
        },
        {
          event: EventType.REASONING_MESSAGE_START,
          data: { type: EventType.REASONING_MESSAGE_START, messageId: ids.reasoningMessageId, role: "reasoning" }
        },
        turnStateEvent(),
        ...assistantShellEvents()
      ];
    },

    /** One sink event in, frames plus a turn-state snapshot out. */
    ingest(event: RunEventSinkEvent): AgUiStreamEvent[] {
      trackStep(event);
      const events: AgUiStreamEvent[] = [];
      if (event.type === "tool_call" || event.type === "answer_delta") {
        events.push(...assistantShellEvents());
      }
      events.push(...mapSinkEvent(event));
      events.push(turnStateEvent());
      return events;
    },

    /** Frames for a mutating-tool pause: approval card tool call, interrupt outcome. */
    interrupt(begin: XiaozeApprovalInterrupt): AgUiStreamEvent[] {
      const interruptValue = {
        approvalId: begin.approvalId,
        toolCallId: begin.toolCallId,
        toolName: begin.toolName,
        payload: begin.payload,
        citations: begin.citations
      };
      const frontendToolCallId = randomUUID();
      return [
        ...reasoningEndEvents(),
        {
          event: EventType.TOOL_CALL_START,
          data: {
            type: EventType.TOOL_CALL_START,
            toolCallId: frontendToolCallId,
            toolCallName: "xiaoze_approval",
            parentMessageId: ids.assistantMessageId
          }
        },
        {
          event: EventType.TOOL_CALL_ARGS,
          data: { type: EventType.TOOL_CALL_ARGS, toolCallId: frontendToolCallId, delta: JSON.stringify(interruptValue) }
        },
        {
          event: EventType.TOOL_CALL_END,
          data: { type: EventType.TOOL_CALL_END, toolCallId: frontendToolCallId }
        },
        // The assistant text message opened by `open()` must close before
        // RUN_FINISHED: the AG-UI client refuses to finish a run with an
        // active text message, which broke every browser approval interrupt.
        ...(assistantShellStarted ? [answerEndEvent()] : []),
        custom(XIAOZE_INTERRUPT_EVENT, interruptValue),
        timingEvent("finished"),
        runFinishedEvent({
          type: "interrupt",
          interrupts: [
            {
              id: begin.approvalId,
              reason: "tool_call",
              toolCallId: frontendToolCallId,
              message: "Approval is required before executing this action.",
              metadata: interruptValue
            }
          ]
        })
      ];
    },

    /**
     * Reconcile the final reply against what already streamed and close the
     * assistant/reasoning messages. Returns the reply so the endpoint can
     * persist it; `complete()` emits timing + RUN_FINISHED afterwards.
     */
    finalize(input: XiaozeTurnFinalizeInput): { events: AgUiStreamEvent[]; reply: XiaozeTurnReply; runSteps?: ReturnType<typeof serializeTurnSteps> } {
      const reply = buildAssistantReply(input);
      const runSteps = input.runSteps ? serializeTurnSteps(input.runSteps) : undefined;
      const events: AgUiStreamEvent[] = [];

      if (input.promptDebug) {
        events.push(
          custom(XIAOZE_PROMPT_DEBUG_EVENT, {
            runId: ids.runId,
            messageId: ids.assistantMessageId,
            snapshot: input.promptDebugModel
              ? { ...input.promptDebug, model: input.promptDebugModel }
              : input.promptDebug
          })
        );
      }

      if (reply.reasoning) {
        const remainingReasoning = streamedReasoning
          ? computeRemainingStreamText(reply.reasoning, streamedReasoningText)
          : reply.reasoning.trim();
        if (remainingReasoning) {
          events.push(reasoningContentEvent(remainingReasoning));
        }
      }
      events.push(...reasoningEndEvents());

      const resyncAnswer =
        needsFullAnswerResync(reply.text, streamedAnswerText) &&
        !hasStreamedCompleteAnswer(reply.text, streamedAnswerText);
      const remainingAnswer = resyncAnswer ? reply.text : computeRemainingStreamText(reply.text, streamedAnswerText);
      if (remainingAnswer && !hasStreamedCompleteAnswer(reply.text, streamedAnswerText)) {
        events.push(...assistantShellEvents());
        events.push(answerContentEvent(remainingAnswer));
        if (!resyncAnswer) {
          streamedAnswerText += remainingAnswer;
          streamedAnswer = true;
        }
      }
      if (reply.text || streamedAnswer) {
        events.push(answerEndEvent());
      }

      if (reply.text.trim()) {
        events.push(
          custom(XIAOZE_TURN_REPLY_EVENT, {
            runId: ids.runId,
            messageId: ids.assistantMessageId,
            reasoningMessageId: ids.reasoningMessageId,
            text: reply.text,
            reasoning: reply.reasoning,
            // Citation payloads are the Phase 2 grounding contract: the live
            // turn reply must carry them or Xiaoze source links only render
            // after a thread reload (persisted messages keep them separately).
            citations: input.citations,
            runSteps
          })
        );
        phase = "done";
        if (runSteps?.length) {
          for (const step of runSteps as XiaozeRunStep[]) {
            steps.set(step.id, step);
          }
        }
        streamedAnswerText = reply.text;
        events.push(turnStateEvent({ text: reply.text, reasoning: reply.reasoning }));
      }

      return { events, reply, runSteps };
    },

    /** Timing + RUN_FINISHED(success); emitted after the endpoint persists. */
    complete(): AgUiStreamEvent[] {
      return [timingEvent("finished"), runFinishedEvent({ type: "success" })];
    },

    /** Safe reply for FORBIDDEN failures; `complete()` follows after persistence. */
    forbidden(message: string): AgUiStreamEvent[] {
      return [...reasoningEndEvents(), ...assistantShellEvents(), answerContentEvent(message), answerEndEvent()];
    },

    /** Terminal error frames (no persistence follows). */
    fail(error: unknown): AgUiStreamEvent[] {
      phase = "error";
      return [
        ...reasoningEndEvents(),
        timingEvent("error"),
        {
          event: EventType.RUN_ERROR,
          data: {
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : "Xiaoze run failed."
          }
        }
      ];
    }
  };
}

export type XiaozeTurnStream = ReturnType<typeof createXiaozeTurnStream>;
