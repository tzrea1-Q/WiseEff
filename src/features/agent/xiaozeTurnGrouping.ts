import type { AssistantMessage, Message, ReasoningMessage, UserMessage } from "@ag-ui/core";
import type { XiaozeTurnReplyPayload } from "./xiaozeTurnReplyTypes";
import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";
import { stripEmbeddedThinking, dedupeRepeatedAnswerText, looksLikeInternalReasoning } from "./xiaozeMessageContent";

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

export function shouldDeferTurnAnswer(input: {
  isActiveTurn: boolean;
  isRunning: boolean;
  turnReply?: XiaozeTurnReplyPayload;
  steps: XiaozeRunStepSnapshot[];
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
    const replyFacing =
      (fromReply.match(/[\u4e00-\u9fff]/g) ?? []).length > 0 || !looksLikeInternalReasoning(fromReply);
    if (replyFacing) {
      return dedupeRepeatedAnswerText(fromReply);
    }
  }

  const candidates = [fromMessage, fromReply].filter(Boolean);
  const userFacing = candidates.filter((text) => {
    const chineseCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    return chineseCount > 0 || !looksLikeInternalReasoning(text);
  });

  if (userFacing.length === 0) {
    return "";
  }

  return dedupeRepeatedAnswerText(userFacing.sort((left, right) => right.length - left.length)[0] ?? "");
}

export function shouldShowTurnThinking(_turn: XiaozeConversationTurn, isActiveTurn: boolean, answerText: string) {
  if (!isActiveTurn) {
    return false;
  }
  return !answerText;
}
