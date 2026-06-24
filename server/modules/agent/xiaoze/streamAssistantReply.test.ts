import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import {
  reasoningEndEvent,
  reasoningStartEvent,
  yieldAssistantReply,
  yieldReasoningTurn
} from "./streamAssistantReply";

describe("streamAssistantReply helpers", () => {
  it("emits reasoning events before the answer when bundled in yieldAssistantReply", () => {
    const events = [...yieldAssistantReply({ reasoning: "Thinking step", text: "Final answer" })];
    expect(events.map((event) => event.event)).toEqual([
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END
    ]);
  });

  it("emits only answer events when reasoning is absent", () => {
    const events = [...yieldAssistantReply({ text: "Final answer" })];
    expect(events.map((event) => event.event)).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END
    ]);
  });

  it("finishes a started reasoning turn before assistant text", () => {
    const reasoningMessageId = "reasoning-1";
    const events = [
      reasoningStartEvent(reasoningMessageId),
      ...yieldReasoningTurn({ reasoningMessageId, reasoning: "Thinking step" }),
      ...yieldAssistantReply({ text: "Final answer", messageId: "answer-1" })
    ];
    expect(events.map((event) => event.event)).toEqual([
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END
    ]);
  });

  it("ends an empty reasoning turn when no reasoning content exists", () => {
    const reasoningMessageId = "reasoning-1";
    const events = [...yieldReasoningTurn({ reasoningMessageId })];
    expect(events.map((event) => event.event)).toEqual([EventType.REASONING_MESSAGE_END]);
    expect(reasoningEndEvent(reasoningMessageId).event).toBe(EventType.REASONING_MESSAGE_END);
  });
});
