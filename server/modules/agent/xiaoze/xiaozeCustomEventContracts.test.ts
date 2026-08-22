import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/core";
import {
  XIAOZE_INTERRUPT_EVENT,
  XIAOZE_PROMPT_DEBUG_EVENT,
  XIAOZE_RUN_TIMING_EVENT,
  XIAOZE_TURN_REPLY_EVENT,
  XIAOZE_TURN_STATE_EVENT
} from "@wiseeff/xiaoze-protocol";
import {
  xiaozeInterruptCustomEventSchema,
  xiaozePromptDebugCustomEventSchema,
  xiaozeRunTimingCustomEventSchema,
  xiaozeTurnReplyCustomEventSchema,
  xiaozeTurnStateCustomEventSchema
} from "../../contracts/dtoSchemas";
import { createXiaozeTurnStream, type AgUiStreamEvent } from "./xiaozeTurnStream";

const ids = {
  threadId: "thread-contract",
  runId: "run-contract",
  assistantMessageId: "assistant-contract",
  reasoningMessageId: "reasoning-contract",
  runStartedAtMs: 1_700_000_000_000
};

function customFrame(frames: AgUiStreamEvent[], name: string) {
  const frame = frames.find((candidate) => candidate.event === EventType.CUSTOM && candidate.data.name === name);
  expect(frame, `missing real ${name} frame`).toBeDefined();
  return frame!;
}

function realCustomFrames() {
  const stateStream = createXiaozeTurnStream(ids);
  const state = customFrame(stateStream.open(), XIAOZE_TURN_STATE_EVENT);

  const replyStream = createXiaozeTurnStream(ids);
  replyStream.open();
  const finalized = replyStream.finalize({
    text: "合同答案",
    reasoning: "合同推理",
    citations: [{ type: "knowledge", id: "kb-1", label: "知识条目" }],
    runSteps: [{
      id: "step-1",
      kind: "tool",
      label: "搜索知识",
      toolName: "knowledge.search",
      status: "succeeded",
      startedAtMs: 100,
      durationMs: 12
    }],
    promptDebug: {
      threadId: ids.threadId,
      userMessage: "为什么充电慢？",
      context: { projectId: "aurora", pageKey: "parameters" },
      system: { policy: "policy", toolCatalog: "catalog" },
      llmMessages: [{ role: "user", content: "为什么充电慢？" }],
      tools: [{ name: "knowledge.search", description: "Search knowledge", schema: { type: "object" } }],
      promptVersion: "v1"
    },
    promptDebugModel: "test-model"
  });
  const reply = customFrame(finalized.events, XIAOZE_TURN_REPLY_EVENT);
  const promptDebug = customFrame(finalized.events, XIAOZE_PROMPT_DEBUG_EVENT);
  const timing = customFrame(replyStream.complete(), XIAOZE_RUN_TIMING_EVENT);

  const interruptStream = createXiaozeTurnStream(ids);
  interruptStream.open();
  const interrupt = customFrame(
    interruptStream.interrupt({
      approvalId: "approval-1",
      toolCallId: "tool-call-1",
      toolName: "action.submitParameterChange",
      payload: { projectId: "aurora" },
      citations: [{ type: "parameter", id: "pd-1", label: "充电电流" }]
    }),
    XIAOZE_INTERRUPT_EVENT
  );

  return { state, reply, timing, promptDebug, interrupt };
}

describe("Xiaoze emitted CUSTOM event contracts", () => {
  it.each([
    ["turn state", "state", xiaozeTurnStateCustomEventSchema],
    ["turn reply", "reply", xiaozeTurnReplyCustomEventSchema],
    ["run timing", "timing", xiaozeRunTimingCustomEventSchema],
    ["prompt debug", "promptDebug", xiaozePromptDebugCustomEventSchema],
    ["approval interrupt", "interrupt", xiaozeInterruptCustomEventSchema]
  ] as const)("validates the real %s frame emitted by xiaozeTurnStream", (_label, key, schema) => {
    expect(schema.safeParse(realCustomFrames()[key]).success).toBe(true);
  });

  it.each([
    ["turn state", XIAOZE_TURN_STATE_EVENT, xiaozeTurnStateCustomEventSchema],
    ["turn reply", XIAOZE_TURN_REPLY_EVENT, xiaozeTurnReplyCustomEventSchema],
    ["run timing", XIAOZE_RUN_TIMING_EVENT, xiaozeRunTimingCustomEventSchema],
    ["prompt debug", XIAOZE_PROMPT_DEBUG_EVENT, xiaozePromptDebugCustomEventSchema],
    ["approval interrupt", XIAOZE_INTERRUPT_EVENT, xiaozeInterruptCustomEventSchema]
  ] as const)("rejects a %s payload with no run/approval identity", (_label, name, schema) => {
    expect(
      schema.safeParse({
        event: EventType.CUSTOM,
        data: { type: EventType.CUSTOM, name, value: {} }
      }).success
    ).toBe(false);
  });
});
