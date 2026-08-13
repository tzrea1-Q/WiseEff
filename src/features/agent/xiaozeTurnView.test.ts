import { describe, expect, it } from "vitest";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { groupMessagesIntoTurns, pickAssistantForTurn } from "./xiaozeTurnGrouping";
import type { XiaozeRunStepSnapshot } from "./xiaozeRunTimingTypes";
import type { XiaozeTurnReplyPayload } from "./xiaozeTurnReplyTypes";
import type { XiaozeTurnStatePayload } from "./xiaozeTurnStateTypes";
import { resolveTurnAnswerText, resolveXiaozeTurnView, shouldDeferTurnAnswer, type XiaozeTurnViewInput } from "./xiaozeTurnView";

function step(overrides: Partial<XiaozeRunStepSnapshot> = {}): XiaozeRunStepSnapshot {
  return {
    id: "s1",
    kind: "tool",
    label: "搜索参数定义",
    status: "succeeded",
    startedAtMs: 0,
    ...overrides
  };
}

function reply(overrides: Partial<XiaozeTurnReplyPayload> = {}): XiaozeTurnReplyPayload {
  return {
    runId: "run-1",
    messageId: "a1",
    reasoningMessageId: "r1",
    text: "在 aurora 项目中找到 4 个参数。",
    ...overrides
  };
}

function state(overrides: Partial<XiaozeTurnStatePayload> = {}): XiaozeTurnStatePayload {
  return {
    runId: "run-1",
    messageId: "a1",
    reasoningMessageId: "r1",
    phase: "done",
    ...overrides
  };
}

function buildInput(overrides: Partial<XiaozeTurnViewInput> & { messages?: Message[] } = {}): XiaozeTurnViewInput {
  const messages: Message[] =
    overrides.messages ??
    ([
      { id: "u1", role: "user", content: "查一下 charge 参数" },
      { id: "a1", role: "assistant", content: "在 aurora 项目中找到 4 个参数。" }
    ] as Message[]);
  const turn = overrides.turn ?? groupMessagesIntoTurns(messages)[0]!;
  const assistant = "assistant" in overrides ? overrides.assistant : pickAssistantForTurn(turn);
  return {
    turn,
    assistant,
    messages,
    isLatest: true,
    isRunning: false,
    turnReply: undefined,
    turnState: undefined,
    liveRunSteps: [],
    ...overrides
  };
}

describe("shouldDeferTurnAnswer", () => {
  it("defers partial answer while tool steps are running without turn reply", () => {
    expect(
      shouldDeferTurnAnswer({
        isActiveTurn: true,
        isRunning: true,
        turnReply: undefined,
        steps: [step({ status: "running" })]
      })
    ).toBe(true);
  });

  it("does not defer answer once turn reply is available", () => {
    expect(
      shouldDeferTurnAnswer({
        isActiveTurn: true,
        isRunning: true,
        turnReply: reply({ text: "完整回答" }),
        steps: [step()]
      })
    ).toBe(false);
  });

  it("does not defer for inactive turns or model-only steps", () => {
    expect(
      shouldDeferTurnAnswer({ isActiveTurn: false, isRunning: true, turnReply: undefined, steps: [step()] })
    ).toBe(false);
    expect(
      shouldDeferTurnAnswer({
        isActiveTurn: true,
        isRunning: true,
        turnReply: undefined,
        steps: [step({ kind: "model" })]
      })
    ).toBe(false);
  });
});

describe("resolveTurnAnswerText", () => {
  it("prefers turn reply over duplicated streamed assistant content", () => {
    const assistant = {
      id: "a-dup",
      role: "assistant" as const,
      content: "在 aurora 项目中找到 4 个参数。\n\n在 aurora 项目中找到 4 个参数。"
    } as AssistantMessage;
    expect(resolveTurnAnswerText(assistant, reply({ messageId: "a-dup" }), false)).toBe(
      "在 aurora 项目中找到 4 个参数。"
    );
  });

  it("falls back to the streamed message when the reply looks internal-only", () => {
    const assistant = {
      id: "a1",
      role: "assistant" as const,
      content: "找到 4 个 charge 相关参数。"
    } as AssistantMessage;
    const internalReply = reply({ text: "The user is asking about charge parameters. I should search." });
    expect(resolveTurnAnswerText(assistant, internalReply, false)).toBe("找到 4 个 charge 相关参数。");
  });
});

describe("resolveXiaozeTurnView", () => {
  it("renders a persisted turn: answer from the message, no strip, no thinking", () => {
    const view = resolveXiaozeTurnView(buildInput());
    expect(view.isActiveTurn).toBe(false);
    expect(view.showAnswer).toBe(true);
    expect(view.answerText).toBe("在 aurora 项目中找到 4 个参数。");
    expect(view.showPhaseStrip).toBe(false);
    expect(view.showThinkingFallback).toBe(false);
    expect(view.showReasoningPanel).toBe(false);
    expect(view.answerStreaming).toBe(false);
  });

  it("prefers done turn-state text over the streamed message", () => {
    const view = resolveXiaozeTurnView(
      buildInput({ turnState: state({ phase: "done", text: "权威最终答案。" }) })
    );
    expect(view.answerText).toBe("权威最终答案。");
  });

  it("step precedence: live steps win on the active turn, then reply, then state, then metadata", () => {
    const liveStep = step({ id: "live", label: "实时步骤" });
    const replySteps = [step({ id: "from-reply" })];
    const stateSteps = [step({ id: "from-state" })];

    const live = resolveXiaozeTurnView(
      buildInput({
        isRunning: true,
        liveRunSteps: [liveStep],
        turnReply: reply({ runSteps: replySteps }),
        turnState: state({ steps: stateSteps })
      })
    );
    expect(live.steps.map((entry) => entry.id)).toEqual(["live"]);

    const persisted = resolveXiaozeTurnView(
      buildInput({
        turnReply: reply({ runSteps: replySteps }),
        turnState: state({ steps: stateSteps })
      })
    );
    expect(persisted.steps.map((entry) => entry.id)).toEqual(["from-reply"]);

    const fromState = resolveXiaozeTurnView(buildInput({ turnState: state({ steps: stateSteps }) }));
    expect(fromState.steps.map((entry) => entry.id)).toEqual(["from-state"]);

    const messages: Message[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "回答",
        metadata: { runSteps: [step({ id: "from-metadata" })] }
      } as unknown as Message
    ];
    const fromMetadata = resolveXiaozeTurnView(buildInput({ messages }));
    expect(fromMetadata.steps.map((entry) => entry.id)).toEqual(["from-metadata"]);
  });

  it("defers a partially streamed answer while tools run, then shows the reply", () => {
    const running = resolveXiaozeTurnView(
      buildInput({
        isRunning: true,
        liveRunSteps: [step({ status: "running" })]
      })
    );
    expect(running.showAnswer).toBe(false);
    expect(running.showPhaseStrip).toBe(true);
    expect(running.phase).toBe("tool");

    // While still streaming, the longer user-facing candidate (the streamed
    // message) wins; the reply text takes over once the turn settles.
    const replied = resolveXiaozeTurnView(
      buildInput({
        isRunning: true,
        liveRunSteps: [step()],
        turnReply: reply({ text: "工具跑完的答案。" })
      })
    );
    expect(replied.showAnswer).toBe(true);
    expect(replied.answerText).toBe("在 aurora 项目中找到 4 个参数。");

    const settled = resolveXiaozeTurnView(
      buildInput({
        assistant: undefined,
        turnReply: reply({ text: "工具跑完的答案。" })
      })
    );
    expect(settled.answerText).toBe("工具跑完的答案。");
  });

  it("reasoning precedence: message content, then reply, then state", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "r1", role: "reasoning", content: "来自消息的推理" },
      { id: "a1", role: "assistant", content: "回答" }
    ] as Message[];
    const fromMessage = resolveXiaozeTurnView(buildInput({ messages }));
    expect(fromMessage.reasoningText).toBe("来自消息的推理");
    expect(fromMessage.reasoningMessageId).toBe("r1");
    expect(fromMessage.showReasoningPanel).toBe(true);

    const fromReply = resolveXiaozeTurnView(buildInput({ turnReply: reply({ reasoning: "来自回复的推理" }) }));
    expect(fromReply.reasoningText).toBe("来自回复的推理");

    const fromState = resolveXiaozeTurnView(buildInput({ turnState: state({ reasoning: "来自状态的推理" }) }));
    expect(fromState.reasoningText).toBe("来自状态的推理");
  });

  it("streams reasoning on the active thinking turn without an answer", () => {
    const messages: Message[] = [{ id: "u1", role: "user", content: "hi" }] as Message[];
    const view = resolveXiaozeTurnView(
      buildInput({
        messages,
        assistant: undefined,
        isRunning: true,
        turnState: undefined,
        liveRunSteps: []
      })
    );
    expect(view.isReasoningStreaming).toBe(true);
    expect(view.showReasoningPanel).toBe(true);
    expect(view.showThinkingFallback).toBe(false);
  });

  it("shows the phase strip for a non-done turn state even without steps", () => {
    const view = resolveXiaozeTurnView(buildInput({ isRunning: true, turnState: state({ phase: "composing" }) }));
    expect(view.showPhaseStrip).toBe(true);
    expect(view.phase).toBe("composing");
    expect(view.answerStreaming).toBe(true);
  });

  it("prefers reply citations over persisted metadata citations", () => {
    const messages: Message[] = [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "回答",
        metadata: { citations: [{ id: "meta", label: "来自元数据" }] }
      } as unknown as Message
    ];
    const fromMetadata = resolveXiaozeTurnView(buildInput({ messages }));
    expect(fromMetadata.citations.map((entry) => entry.id)).toEqual(["meta"]);

    const fromReply = resolveXiaozeTurnView(
      buildInput({ messages, turnReply: reply({ citations: [{ id: "live", label: "来自回复" }] }) })
    );
    expect(fromReply.citations.map((entry) => entry.id)).toEqual(["live"]);
  });
});
