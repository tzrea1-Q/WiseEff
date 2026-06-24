import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";

export type AgUiStreamEvent = { event: string; data: Record<string, unknown> };

export function createReasoningMessageId() {
  return randomUUID();
}

export function reasoningStartEvent(reasoningMessageId: string): AgUiStreamEvent {
  return {
    event: EventType.REASONING_MESSAGE_START,
    data: { type: EventType.REASONING_MESSAGE_START, messageId: reasoningMessageId, role: "reasoning" }
  };
}

export function reasoningContentEvent(reasoningMessageId: string, delta: string): AgUiStreamEvent {
  return {
    event: EventType.REASONING_MESSAGE_CONTENT,
    data: { type: EventType.REASONING_MESSAGE_CONTENT, messageId: reasoningMessageId, delta }
  };
}

export function reasoningEndEvent(reasoningMessageId: string): AgUiStreamEvent {
  return {
    event: EventType.REASONING_MESSAGE_END,
    data: { type: EventType.REASONING_MESSAGE_END, messageId: reasoningMessageId }
  };
}

export function* yieldReasoningTurn(options: {
  reasoningMessageId: string;
  reasoning?: string;
}): Generator<AgUiStreamEvent> {
  const reasoning = options.reasoning?.trim();
  if (reasoning) {
    yield reasoningContentEvent(options.reasoningMessageId, reasoning);
  }
  yield reasoningEndEvent(options.reasoningMessageId);
}

export function* yieldAssistantReply(options: {
  text: string;
  reasoning?: string;
  messageId?: string;
  reasoningMessageId?: string;
}): Generator<AgUiStreamEvent> {
  const answerMessageId = options.messageId ?? randomUUID();
  const reasoning = options.reasoning?.trim();

  if (reasoning) {
    const reasoningMessageId = options.reasoningMessageId ?? randomUUID();
    yield reasoningStartEvent(reasoningMessageId);
    yield reasoningContentEvent(reasoningMessageId, reasoning);
    yield reasoningEndEvent(reasoningMessageId);
  }

  const answer = options.text.trim();
  if (!answer) {
    return;
  }

  yield {
    event: EventType.TEXT_MESSAGE_START,
    data: { type: EventType.TEXT_MESSAGE_START, messageId: answerMessageId, role: "assistant" }
  };
  yield {
    event: EventType.TEXT_MESSAGE_CONTENT,
    data: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: answerMessageId, delta: answer }
  };
  yield {
    event: EventType.TEXT_MESSAGE_END,
    data: { type: EventType.TEXT_MESSAGE_END, messageId: answerMessageId }
  };
}
