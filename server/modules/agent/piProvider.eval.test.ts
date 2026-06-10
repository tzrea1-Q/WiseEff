import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../shared/http/errors";
import { LiveAgentProviderOutageError } from "./liveProvider";
import { createPiAgentProvider, type PiAssistantMessage, type PiModelResolver } from "./piProvider";

const fakeModel = {
  provider: "minimax",
  id: "model-a",
  name: "Model A",
  api: "openai-completions",
  baseUrl: "https://api.example.com/v1",
  reasoning: false,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
  input: ["text"] as Array<"text" | "image">,
  output: ["text"]
};

function createFakePiAssistant(overrides: Partial<PiAssistantMessage> = {}): PiAssistantMessage {
  return {
    role: "assistant",
    provider: "minimax",
    model: "model-a",
    api: "openai-completions",
    content: [{ type: "text", text: "Ready from Pi." }],
    usage: {
      input: 10,
      output: 4,
      cacheRead: 1,
      cacheWrite: 2,
      totalTokens: 17,
      cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 }
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides
  };
}

function createEvalProvider(result: PiAssistantMessage | Error) {
  const resolveModel: PiModelResolver = vi.fn(() => fakeModel);
  const complete = vi.fn(async () => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  const provider = createPiAgentProvider({
    piProvider: "minimax",
    model: "model-a",
    apiKey: "secret",
    promptVersion: "m7-pi-agent-v1",
    timeoutMs: 30000,
    resolveModel,
    complete
  });

  return { provider, complete, resolveModel };
}

function evalInput(message = "Evaluate") {
  return {
    context: { path: "/parameters", pageKey: "parameters", projectId: "aurora", roleId: "admin" },
    message
  };
}

describe("Pi provider offline eval", () => {
  it("passes the plain_text_guidance golden case", async () => {
    const { provider } = createEvalProvider(createFakePiAssistant());

    await expect(provider.planTurn(evalInput())).resolves.toMatchObject({
      assistantDraft: { content: "Ready from Pi.", citations: [], confidence: 0.72 },
      toolRequests: [],
      usage: { inputTokens: 13, outputTokens: 4, estimatedCostUsd: 0.003 },
      safety: { status: "safe", reasons: [] }
    });
  });

  it("passes the read_tool_with_project golden case", async () => {
    const { provider } = createEvalProvider(
      createFakePiAssistant({
        content: [
          { type: "text", text: "Summarizing review queue." },
          { type: "toolCall", id: "call-1", name: "parameter.summarizeReviewQueue", arguments: { projectId: "aurora" } }
        ]
      })
    );

    await expect(provider.planTurn(evalInput())).resolves.toMatchObject({
      toolRequests: [
        {
          name: "parameter.summarizeReviewQueue",
          label: "Summarize review queue",
          payload: { projectId: "aurora" }
        }
      ]
    });
  });

  it("passes the mutating_tool_grounded golden case", async () => {
    const citation = { type: "parameter", id: "project-param-1", label: "Charge voltage" } as const;
    const { provider } = createEvalProvider(
      createFakePiAssistant({
        content: [
          {
            type: "text",
            text: `Prepare a draft.\n\n\`\`\`wiseeff-citations\n${JSON.stringify([citation])}\n\`\`\``
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
        ]
      })
    );

    await expect(provider.planTurn(evalInput())).resolves.toMatchObject({
      assistantDraft: { content: "Prepare a draft.", citations: [citation] },
      toolRequests: [
        {
          name: "parameter.submitChangeDraft",
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

  it("rejects the unknown_tool_rejected golden case", async () => {
    const { provider } = createEvalProvider(
      createFakePiAssistant({
        content: [{ type: "toolCall", id: "call-1", name: "filesystem.read", arguments: { path: "/etc/passwd" } }]
      })
    );

    await expect(provider.planTurn(evalInput())).rejects.toThrow("Pi Agent provider returned an unknown tool name: filesystem.read.");
  });

  it("rejects the malformed_args_rejected golden case", async () => {
    const { provider } = createEvalProvider(
      createFakePiAssistant({
        content: [{ type: "toolCall", id: "call-1", name: "parameter.submitChangeDraft", arguments: { projectId: "aurora" } }]
      })
    );

    await expect(provider.planTurn(evalInput())).rejects.toThrow(
      "Pi Agent provider returned invalid arguments for parameter.submitChangeDraft."
    );
  });

  it("rejects the ungrounded_write_rejected golden case", async () => {
    const { provider } = createEvalProvider(
      createFakePiAssistant({
        content: [
          {
            type: "toolCall",
            id: "call-1",
            name: "parameter.submitChangeDraft",
            arguments: { projectId: "aurora", reason: "Operator requested a draft." }
          }
        ]
      })
    );

    await expect(provider.planTurn(evalInput())).rejects.toThrow(ApiError);
  });

  it("wraps the outage_wrapped golden case", async () => {
    const { provider } = createEvalProvider(new Error("provider timeout"));

    await expect(provider.planTurn(evalInput())).rejects.toThrow(LiveAgentProviderOutageError);
  });
});
