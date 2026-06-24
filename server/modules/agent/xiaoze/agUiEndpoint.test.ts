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
    const custom = events.find((event) => event.event === EventType.CUSTOM);
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
    const custom = events.find((event) => event.event === EventType.CUSTOM);
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
