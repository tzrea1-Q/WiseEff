import { describe, expect, it, vi } from "vitest";
import {
  createPiAgentSmokeEvidence,
  redactPiAgentSmokeEvidence,
  resolvePiAgentSmokeEnv,
  runPiAgentSmoke,
  type PiAgentSmokeProvider
} from "./run-pi-agent-smoke";

function createReadyProvider(): PiAgentSmokeProvider {
  return {
    metadata: () => ({
      provider: "live",
      model: "model-a",
      promptVersion: "m7-pi-agent-v1",
      evidence: {
        provider: "live",
        format: "pi",
        piProvider: "minimax",
        model: "model-a",
        promptVersion: "m7-pi-agent-v1"
      }
    }),
    checkHealth: vi.fn(async () => ({ ok: true as const, status: "ready" as const })),
    planTurn: vi.fn(async () => ({
      assistantDraft: { content: "Pi provider is ready.", citations: [], confidence: 0.9 },
      toolRequests: [],
      provider: "live" as const,
      model: "model-a",
      promptVersion: "m7-pi-agent-v1",
      latencyMs: 123,
      usage: { inputTokens: 5, outputTokens: 4, estimatedCostUsd: 0.001 },
      safety: { status: "safe" as const, reasons: [] }
    }))
  };
}

describe("Pi Agent smoke runner", () => {
  it("requires Pi live provider configuration", () => {
    expect(() => resolvePiAgentSmokeEnv({ AGENT_PROVIDER: "deterministic" })).toThrow(
      "AGENT_PROVIDER=live is required for Pi Agent smoke."
    );
    expect(() => resolvePiAgentSmokeEnv({ AGENT_PROVIDER: "live", AGENT_API_FORMAT: "openai" })).toThrow(
      "AGENT_API_FORMAT=pi is required for Pi Agent smoke."
    );
    expect(() => resolvePiAgentSmokeEnv({ AGENT_PROVIDER: "live", AGENT_API_FORMAT: "pi", AGENT_MODEL: "model-a" })).toThrow(
      "AGENT_PI_PROVIDER is required for Pi Agent smoke."
    );
  });

  it("allows deterministic mode only for explicit local no-op runs", () => {
    expect(resolvePiAgentSmokeEnv({ AGENT_PROVIDER: "deterministic" }, ["--allow-deterministic"])).toEqual({
      allowDeterministic: true,
      env: {
        AGENT_PROVIDER: "deterministic",
        AGENT_API_FORMAT: "pi",
        AGENT_PI_PROVIDER: "deterministic",
        AGENT_MODEL: "deterministic",
        AGENT_API_KEY: "redacted",
        AGENT_API_TIMEOUT_MS: 30000,
        AGENT_PROMPT_VERSION: "m7-pi-agent-v1"
      }
    });

    expect(resolvePiAgentSmokeEnv({ AGENT_PROVIDER: "live", AGENT_API_FORMAT: "openai" }, ["--allow-deterministic"])).toMatchObject({
      allowDeterministic: true,
      env: {
        AGENT_PROVIDER: "deterministic",
        AGENT_API_FORMAT: "pi"
      }
    });
  });

  it("emits compact redacted JSON evidence for a live Pi provider", async () => {
    const provider = createReadyProvider();

    await expect(runPiAgentSmoke(provider)).resolves.toEqual({
      ok: true,
      provider: "live" as const,
      format: "pi",
      piProvider: "minimax",
      model: "model-a",
      promptVersion: "m7-pi-agent-v1",
      healthStatus: "ready",
      latencyMs: 123,
      usage: { inputTokens: 5, outputTokens: 4, estimatedCostUsd: 0.001 },
      toolRequests: 0
    });
    expect(provider.planTurn).toHaveBeenCalledWith({
      context: {
        path: "/agent-provider-smoke",
        pageKey: "agent-provider-smoke",
        projectId: "smoke",
        roleId: "admin"
      },
      message: "Reply with a one sentence readiness confirmation. Do not call tools."
    });
  });

  it("rejects smoke completions that request tools", async () => {
    const provider = createReadyProvider();
    vi.mocked(provider.planTurn).mockResolvedValueOnce({
      assistantDraft: { content: "Need a tool.", citations: [], confidence: 0.5 },
      toolRequests: [{ name: "parameter.summarizeReviewQueue", label: "Summarize review queue", payload: { projectId: "smoke" } }],
      provider: "live",
      model: "model-a",
      promptVersion: "m7-pi-agent-v1"
    });

    await expect(runPiAgentSmoke(provider)).rejects.toThrow("Pi Agent smoke expected zero tool requests.");
  });

  it("redacts secrets from evidence serialization", () => {
    const evidence = createPiAgentSmokeEvidence({
      ok: true,
      provider: "live",
      format: "pi",
      piProvider: "minimax",
      model: "model-a",
      promptVersion: "m7-pi-agent-v1",
      healthStatus: "ready",
      latencyMs: 1,
      usage: undefined,
      toolRequests: 0,
      apiKey: "secret"
    } as never);

    expect(redactPiAgentSmokeEvidence(evidence)).not.toMatch(/secret|apiKey/i);
  });
});
