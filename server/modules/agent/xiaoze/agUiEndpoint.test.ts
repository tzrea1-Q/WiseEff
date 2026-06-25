import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/core";
import { createXiaozeAgUiHandler } from "./agUiEndpoint";

const anyAuth = {
  organization: { id: "org1" },
  user: { id: "u1", isActive: true },
  permissions: ["parameter:edit"],
  roles: []
} as never;

async function collectSseEvents(response: { sse: AsyncIterable<{ event: string; data: unknown }> }) {
  const events: Array<{ event: string; data: unknown }> = [];
  for await (const event of response.sse) {
    events.push(event);
  }
  return events;
}

describe("createXiaozeAgUiHandler", () => {
  it("rejects unauthenticated AG-UI runs", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () => undefined,
      createAgent: () => ({ run: async () => ({ text: "", citations: [] }) })
    });
    await expect(handler({ headers: {}, body: { messages: [] }, requestId: "req-1" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED"
    });
  });

  it("keeps reasoning open while streaming and ends it when the turn is finalized", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn(async ({ sink }: { sink?: { push: (event: unknown) => void } }) => {
          sink?.push({ type: "reasoning_delta", delta: "thinking" });
          sink?.push({ type: "answer_delta", delta: "hello" });
          return { text: "hello", reasoning: "thinking", citations: [] };
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: { threadId: "thread-stream", runId: "run-stream", messages: [{ role: "user", content: "你好" }] },
      requestId: "req-stream"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const reasoningEndIndex = events.findIndex((event) => event.event === EventType.REASONING_MESSAGE_END);
    const answerIndex = events.findIndex((event) => event.event === EventType.TEXT_MESSAGE_CONTENT);
    const runFinishedIndex = events.findIndex((event) => event.event === EventType.RUN_FINISHED);
    expect(reasoningEndIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThanOrEqual(0);
    expect(reasoningEndIndex).toBeGreaterThan(answerIndex);
    expect(runFinishedIndex).toBeGreaterThan(reasoningEndIndex);
  });

  it("emits the final answer when only non-user-facing text was streamed as answer deltas", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn(async ({ sink }: { sink?: { push: (event: unknown) => void } }) => {
          sink?.push({ type: "reasoning_delta", delta: "The user asked about charge parameters." });
          sink?.push({ type: "answer_delta", delta: "The user asked about charge parameters." });
          return {
            text: "aurora 项目里与 charge 相关的参数有 3 个。",
            reasoning: "The user asked about charge parameters.",
            citations: []
          };
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-reroute",
        runId: "run-reroute",
        messages: [{ role: "user", content: "charge 参数有哪些？" }]
      },
      requestId: "req-reroute"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const assistantDeltas = events
      .filter((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => (event.data as { delta?: string }).delta ?? "")
      .join("");
    expect(assistantDeltas).toContain("aurora 项目里与 charge 相关的参数有 3 个。");
    expect(events.some((event) => event.event === EventType.STEP_STARTED)).toBe(false);
  });

  it("streams tool steps and emits the final answer after tool execution", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn(async ({ sink }: { sink?: { push: (event: unknown) => void; close?: () => void } }) => {
          sink?.push({ type: "reasoning_delta", delta: "Need to search parameters." });
          sink?.push({
            type: "step_started",
            step: {
              id: "step-1",
              kind: "tool",
              label: "搜索参数定义",
              toolName: "perception.searchParameters",
              startedAtMs: Date.now()
            }
          });
          sink?.push({
            type: "tool_call",
            toolCallId: "tool-1",
            toolName: "perception.searchParameters",
            args: { projectId: "aurora", query: "charge" }
          });
          sink?.push({
            type: "tool_result",
            toolCallId: "tool-1",
            toolName: "perception.searchParameters",
            summary: "3 parameters",
            status: "succeeded"
          });
          sink?.push({
            type: "step_finished",
            stepId: "step-1",
            status: "succeeded",
            summary: "3 parameters",
            durationMs: 12
          });
          sink?.push({ type: "answer_delta", delta: "找到 3 个 charge 相关参数。" });
          return {
            text: "找到 3 个 charge 相关参数。",
            reasoning: "Need to search parameters.",
            citations: []
          };
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-tool",
        runId: "run-tool",
        messages: [{ role: "user", content: "charge 参数有哪些？" }]
      },
      requestId: "req-tool"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    expect(events.some((event) => event.event === EventType.STEP_STARTED)).toBe(true);
    expect(events.some((event) => event.event === EventType.TOOL_CALL_START)).toBe(true);
    const assistantDeltas = events
      .filter((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)
      .map((event) => (event.data as { delta?: string }).delta ?? "")
      .join("");
    expect(assistantDeltas).toContain("找到 3 个 charge 相关参数。");
    const turnReply = events.find(
      (event) =>
        event.event === EventType.CUSTOM &&
        (event.data as { name?: string }).name === "xiaoze_turn_reply"
    );
    expect((turnReply?.data as { value?: { text?: string } }).value?.text).toContain("找到 3 个");
  });

  it("emits xiaoze_turn_state with phase done after tool execution", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn(async ({ sink }: { sink?: { push: (event: unknown) => void } }) => {
          sink?.push({
            type: "step_started",
            step: {
              id: "step-1",
              kind: "tool",
              label: "搜索参数定义",
              toolName: "perception.searchParameters",
              startedAtMs: Date.now()
            }
          });
          sink?.push({
            type: "step_finished",
            stepId: "step-1",
            status: "succeeded",
            summary: "3 parameters",
            durationMs: 8
          });
          sink?.push({ type: "answer_delta", delta: "找到 3 个 charge 相关参数。" });
          return {
            text: "找到 3 个 charge 相关参数。",
            reasoning: "Need to search parameters.",
            citations: []
          };
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-state",
        runId: "run-state",
        messages: [{ role: "user", content: "charge 参数有哪些？" }]
      },
      requestId: "req-state"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const turnStates = events.filter(
      (event) =>
        event.event === EventType.CUSTOM && (event.data as { name?: string }).name === "xiaoze_turn_state"
    );
    expect(turnStates.length).toBeGreaterThan(0);
    const finalState = turnStates[turnStates.length - 1]?.data as {
      value?: { phase?: string; text?: string; steps?: Array<{ label?: string }> };
    };
    expect(finalState.value?.phase).toBe("done");
    expect(finalState.value?.text).toContain("找到 3 个");
    expect(finalState.value?.steps?.[0]?.label).toBe("搜索参数定义");
  });

  it("emits reasoning and answer events separately when reasoning is present", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn().mockResolvedValue({
          reasoning: "The user asked who I am.",
          text: "我是小泽，WiseEff 的感知与行动助手。",
          citations: []
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: { threadId: "thread-reasoning", runId: "run-reasoning", messages: [{ role: "user", content: "你是谁" }] },
      requestId: "req-reasoning"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const runStartedIndex = events.findIndex((event) => event.event === EventType.RUN_STARTED);
    const reasoningStartIndex = events.findIndex((event) => event.event === EventType.REASONING_MESSAGE_START);
    expect(runStartedIndex).toBeGreaterThanOrEqual(0);
    expect(reasoningStartIndex).toBeGreaterThan(runStartedIndex);
    expect(events.some((event) => event.event === EventType.REASONING_MESSAGE_CONTENT)).toBe(true);
    const answerEvent = events.find((event) => event.event === EventType.TEXT_MESSAGE_CONTENT);
    expect((answerEvent?.data as { delta?: string }).delta).toBe("我是小泽，WiseEff 的感知与行动助手。");
  });

  it("emits a prompt debug custom event when requested in debug mode", async () => {
    const handler = createXiaozeAgUiHandler({
      allowPromptDebug: true,
      resolveModelLabel: () => "test-model",
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn().mockResolvedValue({
          text: "Answer",
          citations: [],
          promptDebug: {
            threadId: "thread-debug",
            userMessage: "hello",
            context: {},
            system: { policy: "policy", toolCatalog: "tools" },
            llmMessages: [{ role: "system", content: "policy" }],
            tools: []
          }
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-debug",
        runId: "run-debug",
        messages: [{ role: "user", content: "hello" }],
        context: [{ description: "wiseeff.debug", value: { promptDebug: true } }]
      },
      requestId: "req-debug"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const custom = events.find(
      (event) =>
        event.event === EventType.CUSTOM && (event.data as { name?: string }).name === "xiaoze_prompt_debug"
    );
    expect((custom?.data as { name?: string }).name).toBe("xiaoze_prompt_debug");
    expect((custom?.data as { value?: { snapshot?: { model?: string } } }).value?.snapshot?.model).toBe("test-model");
  });

  it("emits prompt debug when wiseeff.debug context is JSON-stringified like CopilotKit sends", async () => {
    const handler = createXiaozeAgUiHandler({
      allowPromptDebug: true,
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn().mockResolvedValue({
          text: "Answer",
          citations: [],
          promptDebug: {
            threadId: "thread-debug",
            userMessage: "hello",
            context: {},
            system: { policy: "policy", toolCatalog: "tools" },
            llmMessages: [{ role: "system", content: "policy" }],
            tools: []
          }
        })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-debug",
        runId: "run-debug",
        messages: [{ role: "user", content: "hello" }],
        context: [{ description: "wiseeff.debug", value: JSON.stringify({ promptDebug: true }) }]
      },
      requestId: "req-debug-string"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const custom = events.find(
      (event) =>
        event.event === EventType.CUSTOM && (event.data as { name?: string }).name === "xiaoze_prompt_debug"
    );
    expect((custom?.data as { name?: string }).name).toBe("xiaoze_prompt_debug");
  });

  it("emits RUN_STARTED and RUN_FINISHED for authenticated runs", async () => {
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () =>
        ({
          organization: { id: "org1" },
          user: { id: "u1", isActive: true },
          permissions: [],
          roles: []
        }) as never,
      createAgent: () => ({
        run: vi.fn().mockResolvedValue({ text: "Grounded answer with 12 parameters.", citations: [] })
      })
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: { threadId: "thread-1", runId: "run-1", messages: [{ role: "user", content: "summarize" }] },
      requestId: "req-2"
    });

    expect("sse" in response).toBe(true);
    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    expect(events[0]?.event).toBe(EventType.RUN_STARTED);
    expect(events.some((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)).toBe(true);
    expect(events.at(-1)?.event).toBe(EventType.RUN_FINISHED);
  });

  it("emits addressable interrupt ids in RUN_FINISHED outcome", async () => {
    const approvalBridge = {
      begin: vi.fn().mockResolvedValue({
        approvalId: "approval-addr-1",
        toolCallId: "tool-call-1",
        toolName: "action.submitParameterChange",
        payload: { projectId: "aurora", parameterId: "pd1", targetValue: "18A" },
        citations: []
      }),
      resume: vi.fn()
    };
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () => anyAuth,
      createAgent: () => ({
        run: vi.fn().mockResolvedValue({
          text: "",
          citations: [],
          interrupt: {
            toolName: "action.submitParameterChange",
            payload: { projectId: "aurora", parameterId: "pd1", targetValue: "18A" },
            citations: []
          }
        })
      }),
      approvalBridge: approvalBridge as never
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-interrupt",
        runId: "run-interrupt",
        messages: [{ role: "user", content: "set pd1 to 18A" }]
      },
      requestId: "req-interrupt"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    const finished = events.find((event) => event.event === EventType.RUN_FINISHED);
    const outcome = (finished?.data as { outcome?: { type?: string; interrupts?: Array<{ id?: string }> } })?.outcome;
    expect(outcome?.type).toBe("interrupt");
    expect(outcome?.interrupts?.[0]?.id).toBe("approval-addr-1");
  });

  it("reads AG-UI native resume entries produced by the browser agent bridge", async () => {
    const run = vi.fn().mockResolvedValue({ text: "Change submitted.", citations: [] });
    const approvalBridge = { begin: vi.fn(), resume: vi.fn() };
    const handler = createXiaozeAgUiHandler({
      resolveAuth: async () => anyAuth,
      createAgent: () => ({ run }),
      approvalBridge: approvalBridge as never
    });

    const response = await handler({
      headers: { authorization: "Bearer test" },
      body: {
        threadId: "thread-resume",
        runId: "run-resume",
        messages: [{ role: "user", content: "approve" }],
        resume: [
          {
            interruptId: "approval-addr-1",
            status: "resolved",
            payload: {
              approvalId: "approval-addr-1",
              decision: "approve",
              editedArgs: { projectId: "aurora", parameterId: "pd1", targetValue: "20A" }
            }
          }
        ]
      },
      requestId: "req-resume"
    });

    const events = await collectSseEvents(response as { sse: AsyncIterable<{ event: string; data: unknown }> });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-resume",
        resume: expect.objectContaining({
          approvalId: "approval-addr-1",
          decision: "approve",
          editedArgs: expect.objectContaining({ targetValue: "20A" })
        })
      })
    );
    expect(events.some((event) => event.event === EventType.TEXT_MESSAGE_CONTENT)).toBe(true);
    expect(events.at(-1)?.event).toBe(EventType.RUN_FINISHED);
  });
});
