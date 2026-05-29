import { describe, expect, it, vi } from "vitest";
import type { LiveAgentTransportPlanResult } from "./liveProvider";
import {
  createHttpLiveAgentTransport,
  createLiveAgentProvider,
  createOpenAiCompatibleAgentTransport,
  LiveAgentProviderOutageError
} from "./liveProvider";

function latestRequestInit(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.at(-1)?.[1] as RequestInit;
}

describe("live agent provider", () => {
  it("calls OpenAI-compatible chat completions and maps plain assistant content", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Ready from OpenAI-compatible provider." } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    const transport = createOpenAiCompatibleAgentTransport({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl
    });

    await expect(
      transport.planTurn({
        model: "pilot-model",
        promptVersion: "m5-agent-v1",
        apiKey: "secret",
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).resolves.toMatchObject({
      content: "Ready from OpenAI-compatible provider.",
      toolRequests: [],
      citations: [],
      safety: { status: "safe", reasons: [] },
      usage: { inputTokens: 12, outputTokens: 7 }
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.openai.com/v1/chat/completions"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" })
      })
    );
    const body = JSON.parse(latestRequestInit(fetchImpl).body as string);
    expect(body).toMatchObject({ model: "pilot-model" });
    expect(body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "system" }),
        expect.objectContaining({ role: "user" })
      ])
    );
  });

  it("checks OpenAI-compatible model-list health", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "pilot-model" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const transport = createOpenAiCompatibleAgentTransport({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl
    });

    await expect(transport.checkHealth?.()).resolves.toEqual({ ok: true, status: "ready" });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://api.openai.com/v1/models"),
      expect.objectContaining({ method: "GET" })
    );
  });

  it("returns grounded plans with trace metadata", async () => {
    const transport = {
      planTurn: vi.fn(async () => ({
        content: "Review queue has 2 high-risk items.",
        toolRequests: [
          {
            name: "parameter.summarizeReviewQueue",
            label: "Summarize review queue",
            payload: { projectId: "aurora" }
          }
        ],
        citations: [{ type: "parameter", id: "p-1", label: "Charge limit" }],
        confidence: 0.7,
        usage: { inputTokens: 100, outputTokens: 40, estimatedCostUsd: 0.002 },
        latencyMs: 250,
        safety: { status: "safe", reasons: [] }
      } as const satisfies LiveAgentTransportPlanResult)),
      checkHealth: vi.fn(async () => ({ ok: true, status: "ready" as const }))
    };
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).resolves.toMatchObject({
      assistantDraft: { content: "Review queue has 2 high-risk items.", confidence: 0.7 },
      provider: "live",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      usage: { estimatedCostUsd: 0.002 },
      latencyMs: 250,
      safety: { status: "safe", reasons: [] }
    });
  });

  it("blocks ungrounded write and mutating requests", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "I changed the device value.",
          toolRequests: [
            {
              name: "parameter.submitChangeDraft",
              label: "Create parameter draft",
              payload: { projectId: "aurora" }
            }
          ],
          citations: [],
          confidence: 0.95,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 10,
          safety: { status: "unsafe", reasons: ["mutating requests require grounding"] }
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "debugging", path: "/debugging", projectId: "aurora", roleId: "admin" },
        message: "write it"
      })
    ).rejects.toThrow("Live Agent provider returned an unsafe ungrounded mutating request.");
  });

  it("blocks ungrounded write-adjacent requests", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "I prepared the review artifact.",
          toolRequests: [
            {
              name: "parameter.draftCleanupPlan",
              label: "Draft cleanup plan",
              payload: { projectId: "aurora" }
            },
            {
              name: "log.generateChecklist",
              label: "Generate log checklist",
              payload: { projectId: "aurora" }
            }
          ],
          citations: [],
          confidence: 0.88,
          usage: { inputTokens: 10, outputTokens: 8, estimatedCostUsd: 0.0005 },
          latencyMs: 12,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "prepare cleanup"
      })
    ).rejects.toThrow("Live Agent provider returned an unsafe ungrounded write-adjacent request.");
  });

  it("rejects malformed tool request payloads before any execution path can proceed", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "I can do that.",
          toolRequests: { name: "parameter.summarizeReviewQueue" } as unknown as never[],
          citations: [],
          confidence: 0.9,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 10,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Live Agent provider returned malformed toolRequests.");
  });

  it("rejects invalid usage metadata before trace metadata is consumed", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: Number.NaN, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Live Agent provider returned invalid usage.inputTokens.");
  });

  it("rejects numeric usage strings before trace metadata is consumed", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: "1" as never, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Live Agent provider returned invalid usage.inputTokens.");
  });

  it("rejects invalid safety metadata before trace metadata is consumed", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "unknown" as never, reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Live Agent provider returned invalid safety.status.");
  });

  it("rejects invalid safety shape before trace metadata is consumed", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: null as never
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Live Agent provider returned invalid safety.");
  });

  it("rejects missing safety reasons before trace metadata is consumed", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "safe" } as never
        } as const satisfies LiveAgentTransportPlanResult))
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Live Agent provider returned invalid safety.reasons.");
  });

  it("treats a 400 response as a contract failure, not an outage", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        })
      )
    });
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });
  });

  it("treats a 422 response as a contract failure, not an outage", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ error: "unprocessable" }), {
          status: 422,
          headers: { "content-type": "application/json" }
        })
      )
    });
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });
  });

  it("treats malformed JSON as a contract failure, not an outage", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    });
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });
  });

  it("treats a malformed health response as a contract failure, not an outage", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    });

    await expect(transport.checkHealth?.()).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });
  });

  it("treats a malformed health shape as a contract failure, not ready", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ ok: "yes", status: "ready" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    });

    await expect(transport.checkHealth?.()).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });
  });

  it("treats a 422 health response as a contract failure, not an outage", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify({ error: "unprocessable" }), {
          status: 422,
          headers: { "content-type": "application/json" }
        })
      )
    });

    await expect(transport.checkHealth?.()).rejects.toMatchObject({ name: "LiveAgentProviderContractError" });
  });

  it("treats a 500 response as an outage", async () => {
    const transport = createHttpLiveAgentTransport({
      baseUrl: "https://agent.example.com",
      apiKey: "secret",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      fetchImpl: vi.fn(async () =>
        new Response("upstream exploded", {
          status: 500,
          statusText: "Internal Server Error"
        })
      )
    });
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "parameters", path: "/parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toBeInstanceOf(LiveAgentProviderOutageError);
  });

  it("rejects unknown tool names", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "I can do that.",
          toolRequests: [
            {
              name: "debugging.writeNode" as unknown as "debugging.writeNode",
              label: "Write node",
              payload: { projectId: "aurora" }
            }
          ],
          citations: [{ type: "debugging", id: "node-1", label: "Node" }],
          confidence: 0.9,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 10,
          safety: { status: "safe", reasons: [] }
        } as const) as unknown as LiveAgentTransportPlanResult)
      }
    });

    await expect(
      provider.planTurn({
        context: { pageKey: "debugging", path: "/debugging", projectId: "aurora", roleId: "admin" },
        message: "write it"
      })
    ).rejects.toThrow("Live Agent provider returned an unknown tool name: debugging.writeNode.");
  });

  it("reports health readiness and outage failures", async () => {
    const healthy = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult)),
        checkHealth: vi.fn(async () => ({ ok: true, status: "ready" as const }))
      }
    });
    const unhealthy = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult)),
        checkHealth: vi.fn(async () => {
          throw new Error("transport unavailable");
        })
      }
    });

    await expect(healthy.checkHealth?.()).resolves.toEqual({ ok: true, status: "ready" });
    await expect(unhealthy.checkHealth?.()).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "transport unavailable"
    });
  });

  it("reports transport health through the live provider seam", async () => {
    const provider = createLiveAgentProvider({
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      apiKey: "secret",
      transport: {
        planTurn: vi.fn(async () => ({
          content: "Ready.",
          toolRequests: [],
          citations: [],
          confidence: 0.8,
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
          latencyMs: 1,
          safety: { status: "safe", reasons: [] }
        } as const satisfies LiveAgentTransportPlanResult)),
        checkHealth: vi.fn(async () => ({ ok: true, status: "ready" as const }))
      }
    });

    await expect(provider.checkHealth?.()).resolves.toEqual({ ok: true, status: "ready" });
  });
});
