import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/http/errors";
import { createPiAgentProvider, type PiAssistantMessage, type PiModelResolver } from "./piProvider";

const fakeModel = {
  provider: "minimax",
  id: "MiniMax-M2.7",
  name: "MiniMax M2.7",
  api: "openai-completions",
  baseUrl: "https://api.minimax.io/v1",
  reasoning: false,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
  input: ["text"] as Array<"text" | "image">,
  output: ["text"]
};

function createProvider(overrides: Partial<Parameters<typeof createPiAgentProvider>[0]> = {}) {
  const resolveModel: PiModelResolver = vi.fn(() => fakeModel);
  const complete = vi.fn(async (): Promise<PiAssistantMessage> => ({
    role: "assistant",
    provider: "minimax",
    model: "MiniMax-M2.7",
    api: "openai-completions",
    content: [{ type: "text", text: "Ready from Pi." }],
    usage: {
      input: 12,
      output: 7,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 22,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  }));

  return {
    resolveModel,
    complete,
    provider: createPiAgentProvider({
      piProvider: "minimax",
      model: "MiniMax-M2.7",
      apiKey: "secret",
      promptVersion: "m7-pi-agent-v1",
      timeoutMs: 30000,
      resolveModel,
      complete,
      ...overrides
    })
  };
}

describe("Pi agent provider", () => {
  it("exposes safe Pi provider evidence in metadata", () => {
    const { provider } = createProvider();

    expect(provider.metadata()).toEqual({
      provider: "live",
      model: "MiniMax-M2.7",
      promptVersion: "m7-pi-agent-v1",
      evidence: {
        provider: "live",
        format: "pi",
        piProvider: "minimax",
        model: "MiniMax-M2.7",
        promptVersion: "m7-pi-agent-v1"
      }
    });
  });

  it("maps plain Pi assistant text into a WiseEff provider plan", async () => {
    const { provider, complete, resolveModel } = createProvider();

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).resolves.toMatchObject({
      assistantDraft: {
        content: "Ready from Pi.",
        citations: [],
        confidence: 0.72
      },
      provider: "live",
      model: "MiniMax-M2.7",
      promptVersion: "m7-pi-agent-v1",
      usage: { inputTokens: 15, outputTokens: 7, estimatedCostUsd: 0.003 },
      safety: { status: "safe", reasons: [] }
    });
    expect(resolveModel).toHaveBeenCalledWith("minimax", "MiniMax-M2.7");
    expect(complete).toHaveBeenCalledWith(
      fakeModel,
      expect.objectContaining({
        systemPrompt: expect.stringContaining("WiseEff"),
        tools: expect.arrayContaining([expect.objectContaining({ name: "parameter.submitChangeDraft" })])
      }),
      expect.objectContaining({ apiKey: "secret", timeoutMs: 30000 })
    );
  });

  it("maps known Pi read tool calls into WiseEff tool requests", async () => {
    const { provider, complete } = createProvider();
    complete.mockResolvedValueOnce({
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2.7",
      api: "openai-completions",
      content: [
        { type: "text", text: "I can summarize the review queue." },
        {
          type: "toolCall",
          id: "call-1",
          name: "parameter.summarizeReviewQueue",
          arguments: { projectId: "aurora" }
        }
      ],
      usage: {
        input: 4,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 9,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 }
      },
      stopReason: "toolUse",
      timestamp: Date.now()
    });

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize review queue"
      })
    ).resolves.toMatchObject({
      assistantDraft: { content: "I can summarize the review queue." },
      toolRequests: [
        {
          name: "parameter.summarizeReviewQueue",
          label: "Summarize review queue",
          payload: { projectId: "aurora" }
        }
      ]
    });
  });

  it("maps grounded Pi mutating tool calls into approval-bound WiseEff tool requests", async () => {
    const { provider, complete } = createProvider();
    complete.mockResolvedValueOnce({
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2.7",
      api: "openai-completions",
      content: [
        {
          type: "text",
          text: [
            "Prepare a draft for human approval.",
            "",
            "```wiseeff-citations",
            JSON.stringify([{ type: "parameter", id: "project-param-1", label: "Charge voltage" }]),
            "```"
          ].join("\n")
        },
        {
          type: "toolCall",
          id: "call-1",
          name: "parameter.submitChangeDraft",
          arguments: {
            projectId: "aurora",
            parameterId: "project-param-1",
            targetValue: "3100",
            reason: "Operator requested a staged review draft."
          }
        }
      ],
      usage: {
        input: 4,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 9,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 }
      },
      stopReason: "toolUse",
      timestamp: Date.now()
    });

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Create a draft"
      })
    ).resolves.toMatchObject({
      assistantDraft: {
        content: "Prepare a draft for human approval.",
        citations: [{ type: "parameter", id: "project-param-1", label: "Charge voltage" }]
      },
      toolRequests: [
        {
          name: "parameter.submitChangeDraft",
          label: "Submit change draft",
          payload: {
            projectId: "aurora",
            parameterId: "project-param-1",
            targetValue: "3100",
            reason: "Operator requested a staged review draft."
          }
        }
      ]
    });
  });

  it("rejects unknown Pi tool calls", async () => {
    const { provider, complete } = createProvider();
    complete.mockResolvedValueOnce({
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2.7",
      api: "openai-completions",
      content: [{ type: "toolCall", id: "call-1", name: "shell.run", arguments: {} }],
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "toolUse",
      timestamp: Date.now()
    });

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Run shell"
      })
    ).rejects.toThrow("Pi Agent provider returned an unknown tool name: shell.run.");
  });

  it("rejects malformed Pi tool arguments", async () => {
    const { provider, complete } = createProvider();
    complete.mockResolvedValueOnce({
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2.7",
      api: "openai-completions",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "parameter.submitChangeDraft",
          arguments: { projectId: "aurora" }
        }
      ],
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "toolUse",
      timestamp: Date.now()
    });

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Create a draft"
      })
    ).rejects.toThrow("Pi Agent provider returned invalid arguments for parameter.submitChangeDraft.");
  });

  it("returns failed health when Pi completion throws", async () => {
    const { provider, complete } = createProvider();
    complete.mockRejectedValueOnce(new Error("provider offline"));

    await expect(provider.checkHealth?.()).resolves.toEqual({
      ok: false,
      status: "failed",
      message: "provider offline"
    });
  });

  it("wraps Pi plan failures as provider outages", async () => {
    const { provider, complete } = createProvider();
    complete.mockRejectedValueOnce(new Error("network timeout"));

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("network timeout");
  });

  it("throws a clear error when the Pi model cannot be resolved", async () => {
    const { provider } = createProvider({
      resolveModel: vi.fn(() => undefined)
    });

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Summarize"
      })
    ).rejects.toThrow("Pi Agent provider model was not found: minimax/MiniMax-M2.7");
  });

  it("throws ApiError for unsafe mutating output without grounding", async () => {
    const { provider, complete } = createProvider();
    complete.mockResolvedValueOnce({
      role: "assistant",
      provider: "minimax",
      model: "MiniMax-M2.7",
      api: "openai-completions",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "parameter.submitChangeDraft",
          arguments: { projectId: "aurora", reason: "Operator requested a draft." }
        }
      ],
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      stopReason: "toolUse",
      timestamp: Date.now()
    });

    await expect(
      provider.planTurn({
        context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
        message: "Create draft"
      })
    ).rejects.toThrow(ApiError);
  });
});
