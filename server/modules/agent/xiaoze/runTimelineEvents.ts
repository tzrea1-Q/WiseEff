import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import type { AgUiStreamEvent } from "./streamAssistantReply";
import type { RunEventSinkEvent, XiaozeRunStepRecord } from "./runEventSink";
import { getXiaozeToolLabel } from "./toolCatalog";

export const XIAOZE_RUN_TIMING_EVENT = "xiaoze_run_timing";

export type RunTimelineContext = {
  threadId: string;
  runId: string;
  assistantMessageId: string;
  reasoningMessageId: string;
  runStartedAtMs: number;
};

export function runStartedEvent(context: Pick<RunTimelineContext, "threadId" | "runId" | "runStartedAtMs">): AgUiStreamEvent {
  return {
    event: EventType.RUN_STARTED,
    data: {
      type: EventType.RUN_STARTED,
      threadId: context.threadId,
      runId: context.runId,
      startedAt: context.runStartedAtMs
    }
  };
}

export function runTimingEvent(input: {
  runId: string;
  reasoningMessageId: string;
  startedAt: number;
  durationMs: number;
  phase: "finished" | "error";
}): AgUiStreamEvent {
  return {
    event: EventType.CUSTOM,
    data: {
      type: EventType.CUSTOM,
      name: XIAOZE_RUN_TIMING_EVENT,
      value: input
    }
  };
}

export function assistantShellStartEvent(messageId: string): AgUiStreamEvent {
  return {
    event: EventType.TEXT_MESSAGE_START,
    data: { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" }
  };
}

export function mapSinkEventToAgUi(event: RunEventSinkEvent, context: RunTimelineContext): AgUiStreamEvent[] {
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
      return [
        {
          event: EventType.REASONING_MESSAGE_CONTENT,
          data: {
            type: EventType.REASONING_MESSAGE_CONTENT,
            messageId: context.reasoningMessageId,
            delta: event.delta
          }
        }
      ];
    case "answer_delta":
      return [
        {
          event: EventType.TEXT_MESSAGE_CONTENT,
          data: {
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: context.assistantMessageId,
            delta: event.delta
          }
        }
      ];
    case "tool_call":
      return toolCallTimelineEvents({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        parentMessageId: context.assistantMessageId,
        args: event.args
      });
    case "tool_result":
      return [
        toolCallResultEvent({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          summary: event.summary,
          status: event.status,
          messageId: context.assistantMessageId
        })
      ];
    default:
      return [];
  }
}

export function toolCallTimelineEvents(input: {
  toolCallId: string;
  toolName: string;
  parentMessageId: string;
  args: Record<string, unknown>;
  result?: { summary: string; status: "succeeded" | "failed" | "forbidden" };
}): AgUiStreamEvent[] {
  const argsPayload = JSON.stringify(input.args);
  const events: AgUiStreamEvent[] = [
    {
      event: EventType.TOOL_CALL_START,
      data: {
        type: EventType.TOOL_CALL_START,
        toolCallId: input.toolCallId,
        toolCallName: input.toolName,
        parentMessageId: input.parentMessageId
      }
    },
    {
      event: EventType.TOOL_CALL_ARGS,
      data: {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: input.toolCallId,
        delta: argsPayload
      }
    },
    {
      event: EventType.TOOL_CALL_END,
      data: { type: EventType.TOOL_CALL_END, toolCallId: input.toolCallId }
    }
  ];

  if (input.result) {
    events.push({
      event: EventType.TOOL_CALL_RESULT,
      data: {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: input.toolCallId,
        messageId: input.parentMessageId,
        content: JSON.stringify({
          label: getXiaozeToolLabel(input.toolName),
          summary: input.result.summary,
          status: input.result.status
        })
      }
    });
  }

  return events;
}

export function toolCallResultEvent(input: {
  toolCallId: string;
  toolName: string;
  summary: string;
  status: "succeeded" | "failed" | "forbidden";
  messageId: string;
}): AgUiStreamEvent {
  return {
    event: EventType.TOOL_CALL_RESULT,
    data: {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: input.toolCallId,
      messageId: input.messageId,
      content: JSON.stringify({
        label: getXiaozeToolLabel(input.toolName),
        summary: input.summary,
        status: input.status
      })
    }
  };
}

export function serializeTurnSteps(steps: XiaozeRunStepRecord[]) {
  return steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    label: step.label,
    toolName: step.toolName,
    status: step.status,
    summary: step.summary,
    startedAtMs: step.startedAtMs,
    durationMs: step.durationMs
  }));
}

export function createToolCallId() {
  return randomUUID();
}
