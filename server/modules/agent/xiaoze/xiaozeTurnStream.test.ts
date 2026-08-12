import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import { createXiaozeTurnStream, XIAOZE_INTERRUPT_EVENT, XIAOZE_RUN_TIMING_EVENT } from "./xiaozeTurnStream";
import { XIAOZE_TURN_STATE_EVENT, type XiaozeTurnStatePayload } from "./xiaozeTurnState";
import { XIAOZE_TURN_REPLY_EVENT } from "./xiaozeTurnReply";

const ids = {
  threadId: "thread-1",
  runId: "run-1",
  assistantMessageId: "assistant-1",
  reasoningMessageId: "reasoning-1",
  runStartedAtMs: 1_700_000_000_000
};

type Frame = { event: string; data: Record<string, unknown> };

function names(frames: Frame[]) {
  return frames.map((frame) => {
    if (frame.event === EventType.CUSTOM) {
      return `CUSTOM:${String(frame.data.name)}`;
    }
    return frame.event;
  });
}

function turnStates(frames: Frame[]): XiaozeTurnStatePayload[] {
  return frames
    .filter((frame) => frame.event === EventType.CUSTOM && frame.data.name === XIAOZE_TURN_STATE_EVENT)
    .map((frame) => frame.data.value as XiaozeTurnStatePayload);
}

describe("createXiaozeTurnStream", () => {
  it("opens with run/reasoning/turn-state/assistant shells", () => {
    const stream = createXiaozeTurnStream(ids);
    expect(names(stream.open())).toEqual([
      EventType.RUN_STARTED,
      EventType.REASONING_MESSAGE_START,
      `CUSTOM:${XIAOZE_TURN_STATE_EVENT}`,
      EventType.TEXT_MESSAGE_START
    ]);
  });

  it("streams a full reply that never streamed: reasoning first, then answer, reply, done snapshot", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    const finalized = stream.finalize({ text: "Final answer", reasoning: "Thinking step" });
    expect(names(finalized.events)).toEqual([
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      `CUSTOM:${XIAOZE_TURN_REPLY_EVENT}`,
      `CUSTOM:${XIAOZE_TURN_STATE_EVENT}`
    ]);
    expect(finalized.reply).toEqual({ text: "Final answer", reasoning: "Thinking step" });
    const done = turnStates(finalized.events)[0];
    expect(done?.phase).toBe("done");
    expect(done?.text).toBe("Final answer");
    expect(names(stream.complete())).toEqual([`CUSTOM:${XIAOZE_RUN_TIMING_EVENT}`, EventType.RUN_FINISHED]);
    expect(stream.complete()[1]?.data.outcome).toEqual({ type: "success" });
  });

  it("does not re-send an answer that fully streamed", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    stream.ingest({ type: "answer_delta", delta: "Final " });
    stream.ingest({ type: "answer_delta", delta: "answer" });
    const finalized = stream.finalize({ text: "Final answer" });
    expect(names(finalized.events)).toEqual([
      EventType.REASONING_MESSAGE_END,
      EventType.TEXT_MESSAGE_END,
      `CUSTOM:${XIAOZE_TURN_REPLY_EVENT}`,
      `CUSTOM:${XIAOZE_TURN_STATE_EVENT}`
    ]);
  });

  it("sends only the remaining tail when the final text extends the streamed prefix", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    stream.ingest({ type: "answer_delta", delta: "Final" });
    const finalized = stream.finalize({ text: "Final answer" });
    const content = finalized.events.find((event) => event.event === EventType.TEXT_MESSAGE_CONTENT);
    expect(content?.data.delta).toBe(" answer");
  });

  it("resyncs the full text when the stream diverged", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    stream.ingest({ type: "answer_delta", delta: "Draft that diverged" });
    const finalized = stream.finalize({ text: "Actual final answer" });
    const content = finalized.events.find((event) => event.event === EventType.TEXT_MESSAGE_CONTENT);
    expect(content?.data.delta).toBe("Actual final answer");
  });

  it("tolerates a >=90% streamed prefix as complete", () => {
    const text = "0123456789";
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    stream.ingest({ type: "answer_delta", delta: text.slice(0, 9) });
    const finalized = stream.finalize({ text });
    expect(finalized.events.some((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)).toBe(false);
  });

  it("sends the remaining reasoning tail when reasoning partially streamed", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    stream.ingest({ type: "reasoning_delta", delta: "Thinking" });
    const finalized = stream.finalize({ text: "Answer", reasoning: "Thinking harder" });
    const content = finalized.events.find((event) => event.event === EventType.REASONING_MESSAGE_CONTENT);
    expect(content?.data.delta).toBe(" harder");
  });

  it("maps tool steps to STEP/TOOL_CALL frames with turn-state phases tool → composing → done", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    const step = {
      id: "step-1",
      kind: "tool" as const,
      label: "搜索参数定义",
      toolName: "perception.searchParameters",
      status: "running" as const,
      startedAtMs: 1
    };
    const started = stream.ingest({ type: "step_started", step });
    expect(names(started)).toEqual([EventType.STEP_STARTED, `CUSTOM:${XIAOZE_TURN_STATE_EVENT}`]);
    expect(turnStates(started)[0]?.phase).toBe("tool");

    const toolCall = stream.ingest({
      type: "tool_call",
      toolCallId: "tool-1",
      toolName: "perception.searchParameters",
      args: { query: "charge" }
    });
    expect(names(toolCall)).toEqual([
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      `CUSTOM:${XIAOZE_TURN_STATE_EVENT}`
    ]);

    const toolResult = stream.ingest({
      type: "tool_result",
      toolCallId: "tool-1",
      toolName: "perception.searchParameters",
      summary: "3 matches",
      status: "succeeded"
    });
    expect(names(toolResult)).toEqual([EventType.TOOL_CALL_RESULT, `CUSTOM:${XIAOZE_TURN_STATE_EVENT}`]);

    const finished = stream.ingest({
      type: "step_finished",
      stepId: "step-1",
      status: "succeeded",
      summary: "4 parameters",
      durationMs: 12
    });
    expect(turnStates(finished)[0]?.steps?.[0]?.status).toBe("succeeded");

    const answer = stream.ingest({ type: "answer_delta", delta: "找到 4 个参数。" });
    expect(turnStates(answer)[0]?.phase).toBe("composing");
    expect(turnStates(answer)[0]?.text).toContain("找到 4 个");

    const finalized = stream.finalize({ text: "找到 4 个 charge 相关参数。" });
    const done = turnStates(finalized.events)[0];
    expect(done?.phase).toBe("done");
    expect(done?.text).toBe("找到 4 个 charge 相关参数。");
  });

  it("emits the approval tool call and interrupt outcome for a mutating pause", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    const frames = stream.interrupt({
      approvalId: "approval-1",
      toolCallId: "call-1",
      toolName: "action.submitParameterChange",
      payload: { changes: [] },
      citations: []
    });
    expect(names(frames)).toEqual([
      EventType.REASONING_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      // The assistant shell opened by open() closes before RUN_FINISHED: the
      // AG-UI client refuses to finish a run with an active text message.
      EventType.TEXT_MESSAGE_END,
      `CUSTOM:${XIAOZE_INTERRUPT_EVENT}`,
      `CUSTOM:${XIAOZE_RUN_TIMING_EVENT}`,
      EventType.RUN_FINISHED
    ]);
    const toolStart = frames.find((frame) => frame.event === EventType.TOOL_CALL_START);
    expect(toolStart?.data.toolCallName).toBe("xiaoze_approval");
    const runFinished = frames.at(-1);
    const outcome = runFinished?.data.outcome as {
      type: string;
      interrupts: Array<{ id: string; metadata: { approvalId: string } }>;
    };
    expect(outcome.type).toBe("interrupt");
    expect(outcome.interrupts[0]?.id).toBe("approval-1");
    expect(outcome.interrupts[0]?.metadata.approvalId).toBe("approval-1");
  });

  it("renders the forbidden safe reply without a duplicate assistant shell", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    const frames = stream.forbidden("You are not permitted to perform that action.");
    expect(names(frames)).toEqual([
      EventType.REASONING_MESSAGE_END,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END
    ]);
  });

  it("fails with reasoning end, error timing, and RUN_ERROR", () => {
    const stream = createXiaozeTurnStream(ids);
    stream.open();
    const frames = stream.fail(new Error("boom"));
    expect(names(frames)).toEqual([
      EventType.REASONING_MESSAGE_END,
      `CUSTOM:${XIAOZE_RUN_TIMING_EVENT}`,
      EventType.RUN_ERROR
    ]);
    expect(frames.at(-1)?.data.message).toBe("boom");
    const timing = frames[1]?.data.value as { phase: string };
    expect(timing.phase).toBe("error");
  });

  it("never emits the assistant shell twice and ends reasoning once", () => {
    const stream = createXiaozeTurnStream(ids);
    const opened = stream.open();
    const shellCount = (frames: Frame[]) => frames.filter((frame) => frame.event === EventType.TEXT_MESSAGE_START).length;
    expect(shellCount(opened)).toBe(1);
    const ingested = stream.ingest({ type: "answer_delta", delta: "hello" });
    expect(shellCount(ingested)).toBe(0);
    const finalized = stream.finalize({ text: "hello world", reasoning: "r" });
    expect(shellCount(finalized.events)).toBe(0);
    const reasoningEnds = finalized.events.filter((frame) => frame.event === EventType.REASONING_MESSAGE_END);
    expect(reasoningEnds).toHaveLength(1);
    expect(stream.forbidden("x").filter((frame) => frame.event === EventType.REASONING_MESSAGE_END)).toHaveLength(0);
  });
});
