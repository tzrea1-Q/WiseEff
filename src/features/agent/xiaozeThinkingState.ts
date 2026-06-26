import type { Message } from "@ag-ui/core";

function findLastUserMessageIndex(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function hasAssistantReplyAfter(messages: Message[], fromIndex: number) {
  return messages.slice(fromIndex + 1).some((entry) => {
    if (entry.role !== "assistant") {
      return false;
    }
    return String(entry.content ?? "").trim().length > 0;
  });
}

function hasAssistantActivityAfter(messages: Message[], fromIndex: number) {
  return messages.slice(fromIndex + 1).some((entry) => {
    if (entry.role !== "assistant") {
      return false;
    }
    const content = String(entry.content ?? "").trim();
    const toolCalls = (entry as { toolCalls?: unknown[] }).toolCalls;
    return content.length > 0 || (Array.isArray(toolCalls) && toolCalls.length > 0);
  });
}

export function isXiaozeReasoningStreaming(
  message: { id: string },
  messages: Message[] | undefined,
  isRunning: boolean | undefined
) {
  if (!isRunning || !messages?.length) {
    return false;
  }

  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) {
    return false;
  }

  return !hasAssistantReplyAfter(messages, index);
}

export function shouldShowXiaozeReasoningTimeline(
  message: { id: string },
  messages: Message[] | undefined,
  isRunning: boolean | undefined
) {
  if (!isRunning || !messages?.length) {
    return false;
  }
  const index = messages.findIndex((entry) => entry.id === message.id);
  if (index < 0) {
    return false;
  }
  return !hasAssistantActivityAfter(messages, index);
}

export function shouldShowXiaozeThinkingFallback(messages: Message[], isRunning: boolean) {
  if (!isRunning) {
    return false;
  }

  const lastUserIndex = findLastUserMessageIndex(messages);
  if (lastUserIndex < 0) {
    return false;
  }

  const tail = messages.slice(lastUserIndex + 1);
  if (tail.some((entry) => entry.role === "reasoning")) {
    return false;
  }

  return !tail.some((entry) => entry.role === "assistant" && String(entry.content ?? "").trim().length > 0);
}
