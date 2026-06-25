import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { mapSinkEventToAgUi, toolCallTimelineEvents } from "./runTimelineEvents";

describe("runTimelineEvents", () => {
  const context = {
    threadId: "thread-1",
    runId: "run-1",
    assistantMessageId: "assistant-1",
    reasoningMessageId: "reasoning-1",
    runStartedAtMs: 1_700_000_000_000
  };

  it("maps reasoning and answer deltas to AG-UI content events", () => {
    const reasoning = mapSinkEventToAgUi({ type: "reasoning_delta", delta: "thinking" }, context);
    const answer = mapSinkEventToAgUi({ type: "answer_delta", delta: "hello" }, context);
    expect(reasoning[0]?.event).toBe(EventType.REASONING_MESSAGE_CONTENT);
    expect(answer[0]?.event).toBe(EventType.TEXT_MESSAGE_CONTENT);
  });

  it("emits tool call lifecycle events", () => {
    const events = toolCallTimelineEvents({
      toolCallId: "tool-1",
      toolName: "perception.searchParameters",
      parentMessageId: "assistant-1",
      args: { query: "charge" },
      result: { summary: "3 matches", status: "succeeded" }
    });
    expect(events.map((event) => event.event)).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT
    ]);
  });
});
