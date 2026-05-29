import { describe, expect, it, vi } from "vitest";
import type { LiveAgentTransportPlanResult } from "./liveProvider";
import { createAgentProviderFromEnv } from "./providerRegistry";

describe("agent provider registry", () => {
  it("uses deterministic provider outside production by default", () => {
    const provider = createAgentProviderFromEnv({ NODE_ENV: "development" });

    expect(provider.metadata()).toEqual({
      provider: "deterministic",
      model: "wiseeff-rules-m4",
      promptVersion: "m4-agent-v1"
    });
  });

  it("requires live provider configuration in production", () => {
    expect(() => createAgentProviderFromEnv({ NODE_ENV: "production", AGENT_PROVIDER: "deterministic" })).toThrow(
      "AGENT_PROVIDER=live is required in production."
    );
  });

  it("creates live provider when credentials are configured", () => {
    const provider = createAgentProviderFromEnv(
      {
        NODE_ENV: "production",
        AGENT_PROVIDER: "live",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret",
        AGENT_API_BASE_URL: "https://agent.example.com",
        AGENT_PROMPT_VERSION: "m5-agent-v1"
      },
      {
        transport: {
          planTurn: vi.fn(async () => ({
            content: "Ready.",
            toolRequests: [],
            citations: [],
            confidence: 0.9,
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0.001 },
            latencyMs: 1,
            safety: { status: "safe", reasons: [] }
          } as const satisfies LiveAgentTransportPlanResult)),
          checkHealth: vi.fn(async () => ({ ok: true, status: "ready" as const }))
        }
      }
    );

    expect(provider.metadata()).toMatchObject({
      provider: "live",
      model: "pilot-model",
      promptVersion: "m5-agent-v1"
    });
  });

  it("creates a live provider backed by the HTTP transport in production", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/agent/health") && init?.method === "GET") {
        return new Response(JSON.stringify({ ok: true, status: "ready" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.endsWith("/agent/plan-turn") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            content: "Ready.",
            toolRequests: [],
            citations: [],
            confidence: 0.92,
            usage: { inputTokens: 12, outputTokens: 7, estimatedCostUsd: 0.0003 },
            latencyMs: 35,
            safety: { status: "safe", reasons: [] }
          } satisfies LiveAgentTransportPlanResult),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      return new Response("not found", { status: 404 });
    });
    const provider = createAgentProviderFromEnv(
      {
        NODE_ENV: "production",
        AGENT_PROVIDER: "live",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret",
        AGENT_API_BASE_URL: "https://agent.example.com",
        AGENT_API_TIMEOUT_MS: 1500,
        AGENT_PROMPT_VERSION: "m5-agent-v1"
      } as any,
      { fetchImpl } as any
    );

    await expect(provider.checkHealth?.()).resolves.toEqual({ ok: true, status: "ready" });
    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).resolves.toMatchObject({
      provider: "live",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      assistantDraft: { confidence: 0.92 }
    });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("creates an OpenAI-compatible live provider when requested", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/models") && init?.method === "GET") {
        return new Response(JSON.stringify({ data: [{ id: "pilot-model" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (url.endsWith("/chat/completions") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Ready from OpenAI-compatible provider." } }],
            usage: { prompt_tokens: 12, completion_tokens: 7 }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      return new Response("not found", { status: 404 });
    });
    const provider = createAgentProviderFromEnv(
      {
        NODE_ENV: "development",
        AGENT_PROVIDER: "live",
        AGENT_API_FORMAT: "openai",
        AGENT_MODEL: "pilot-model",
        AGENT_API_KEY: "secret",
        AGENT_API_BASE_URL: "https://api.openai.com/v1",
        AGENT_PROMPT_VERSION: "m5-agent-v1"
      } as any,
      { fetchImpl } as any
    );

    await expect(provider.checkHealth?.()).resolves.toEqual({ ok: true, status: "ready" });
    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).resolves.toMatchObject({
      provider: "live",
      model: "pilot-model",
      promptVersion: "m5-agent-v1",
      assistantDraft: { content: "Ready from OpenAI-compatible provider." }
    });
    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://api.openai.com/v1/chat/completions"), expect.any(Object));
  });
});
