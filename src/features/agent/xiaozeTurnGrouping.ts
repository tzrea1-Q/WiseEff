import type { AssistantMessage, Message, ReasoningMessage, UserMessage } from "@ag-ui/core";
import { stripEmbeddedThinking, looksLikeInternalReasoning } from "./xiaozeMessageContent";

export type XiaozeConversationTurn = {
  id: string;
  user: UserMessage;
  reasoning?: ReasoningMessage;
  assistants: AssistantMessage[];
  tail: Message[];
};

export function readMessageText(content: Message["content"]) {
  return typeof content === "string" ? content.trim() : "";
}

export function groupMessagesIntoTurns(messages: Message[]): XiaozeConversationTurn[] {
  const turns: XiaozeConversationTurn[] = [];
  let current: XiaozeConversationTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      if (current) {
        turns.push(current);
      }
      current = {
        id: message.id,
        user: message as UserMessage,
        assistants: [],
        tail: []
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (message.role === "reasoning") {
      current.reasoning = message as ReasoningMessage;
      continue;
    }
    if (message.role === "assistant") {
      current.assistants.push(message as AssistantMessage);
      continue;
    }
    current.tail.push(message);
  }

  if (current) {
    turns.push(current);
  }

  return turns;
}

function scoreAssistantMessage(message: AssistantMessage) {
  const text = stripEmbeddedThinking(readMessageText(message.content));
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const internal = looksLikeInternalReasoning(text) && chineseCount === 0;
  return {
    chineseCount,
    length: text.length,
    internal,
    text
  };
}

export function pickAssistantForTurn(turn: XiaozeConversationTurn): AssistantMessage | undefined {
  if (turn.assistants.length === 0) {
    return undefined;
  }

  return [...turn.assistants].sort((left, right) => {
    const leftScore = scoreAssistantMessage(left);
    const rightScore = scoreAssistantMessage(right);
    if (leftScore.internal !== rightScore.internal) {
      return leftScore.internal ? 1 : -1;
    }
    if (leftScore.chineseCount !== rightScore.chineseCount) {
      return rightScore.chineseCount - leftScore.chineseCount;
    }
    return rightScore.length - leftScore.length;
  })[0];
}

