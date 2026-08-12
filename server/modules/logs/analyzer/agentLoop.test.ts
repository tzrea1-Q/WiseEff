import { describe, expect, it } from "vitest";

import type { AnalyzeLogInput } from "../analyzer";
import { parseLogText } from "../parser";
import {
  createAgentLoopLogAnalyzer,
  LOG_ANALYSIS_LOOP_PROMPT_VERSION,
  LOG_ANALYSIS_MAX_CONSECUTIVE_INVALID
} from "./agentLoop";
import { createDeterministicLogAnalysisLoopModel } from "./deterministicModel";
import { LogAnalysisProviderError } from "./llmAnalyzer";
import { createScriptedLogAnalysisModel, type ScriptedModelResponse } from "./scriptedModel";

const chargingLog = [
  "2026-08-10T08:00:01Z INFO charge session started requested_ma=6000",
  "2026-08-10T08:00:02Z INFO battery_temp=38C pack ok",
  "2026-08-10T08:00:03Z WARN thermal foldback engaged battery_temp=52C",
  "2026-08-10T08:00:04Z ERROR charge current reduced code=E_THERMAL_FOLDBACK requested_ma=6000 charge_current_ma=2000",
  "2026-08-10T08:00:05Z INFO charge continuing at reduced rate",
  "2026-08-10T08:00:06Z INFO session heartbeat ok"
].join("\n");

function buildInput(overrides: Partial<AnalyzeLogInput> = {}): AnalyzeLogInput {
  const parsed = parseLogText({ fileName: "charging.log", content: chargingLog });
  if (!parsed.ok) {
    throw new Error("fixture must parse");
  }
  return { parsed, ...overrides };
}

const finalPayload = {
  action: "final",
  conclusion: "Thermal foldback reduced the charge current after the pack overheated.",
  impact: "Charging stays slow until pack temperature recovers.",
  severity: "Warning",
  confidence: 0.9,
  suggestedActions: ["Inspect the cooling path."],
  evidence: [
    {
      lineNumbers: [3, 4],
      inference: "Foldback engaged at 52C and current dropped to 2000mA.",
      suggestedAction: "Correlate temperature with the current drop window."
    }
  ]
};

function analyzer(script: ScriptedModelResponse[], options: Partial<Parameters<typeof createAgentLoopLogAnalyzer>[0]> = {}) {
  const model = createScriptedLogAnalysisModel(script);
  return {
    model,
    adapter: createAgentLoopLogAnalyzer({
      model,
      modelLabel: "loop-test",
      tokenBudget: 100_000,
      maxSteps: 4,
      ...options
    })
  };
}

describe("createAgentLoopLogAnalyzer", () => {
  it("runs tool calls then returns a grounded agent conclusion with the loop prompt version", async () => {
    const { model, adapter } = analyzer([
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 2, endLine: 5 } } },
      { content: finalPayload }
    ]);

    const output = await adapter.analyze(buildInput());

    expect(output.analysisSource).toBe("agent");
    expect(output.degradedReason).toBeUndefined();
    expect(output.promptVersion).toBe(LOG_ANALYSIS_LOOP_PROMPT_VERSION);
    expect(output.model).toBe("loop-test");
    expect(output.confidence).toBe(0.9);
    expect(output.evidence[0].lineNumbers).toEqual([3, 4]);
    // Three model calls: two tool steps plus the final.
    expect(model.calls).toHaveLength(3);
    // The kernel fed both tool results back into the conversation.
    const lastMessages = model.calls[2];
    expect(lastMessages.some((message) => message.content.startsWith("Tool result for get_prefilter_findings:"))).toBe(true);
    expect(lastMessages.some((message) => message.content.startsWith("Tool result for read_line_range:"))).toBe(true);
  });

  it("injects the analysis question and domain into the mission prompt", async () => {
    const { model, adapter } = analyzer([{ content: finalPayload }]);
    await adapter.analyze(
      buildInput({
        analysisQuestion: "Why did fast charging fold back?",
        logDomain: { name: "charging-power", description: "Charging subsystem" }
      })
    );

    const promptText = model.calls[0].map((message) => message.content).join("\n");
    expect(promptText).toContain("Why did fast charging fold back?");
    expect(promptText).toContain("charging-power");
  });

  it("reports loop progress per step onto the provided callback", async () => {
    const steps: Array<{ step: number; maxSteps: number }> = [];
    const { adapter } = analyzer([
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: finalPayload }
    ]);

    await adapter.analyze(buildInput({ onProgress: (progress) => void steps.push(progress) }));

    expect(steps).toEqual([
      { step: 1, maxSteps: 4 },
      { step: 2, maxSteps: 4 }
    ]);
  });

  it("corrects an illegal tool name and still converges", async () => {
    const { model, adapter } = analyzer([
      { content: { action: "tool", tool: "write_device_parameter", args: {} } },
      { content: finalPayload }
    ]);

    const output = await adapter.analyze(buildInput());

    expect(output.analysisSource).toBe("agent");
    const correction = model.calls[1].at(-1);
    expect(correction?.content).toContain("Tool call rejected");
    expect(correction?.content).toContain('Unknown tool "write_device_parameter"');
  });

  it("corrects invalid tool arguments through the zod schema", async () => {
    const { model, adapter } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: -1, endLine: 2 } } },
      { content: finalPayload }
    ]);

    const output = await adapter.analyze(buildInput());
    expect(output.analysisSource).toBe("agent");
    expect(model.calls[1].at(-1)?.content).toContain('Invalid arguments for tool "read_line_range"');
  });

  it("degrades honestly after the consecutive-invalid threshold", async () => {
    const script: ScriptedModelResponse[] = Array.from({ length: LOG_ANALYSIS_MAX_CONSECUTIVE_INVALID }, () => ({
      content: { action: "tool", tool: "nonexistent_tool", args: {} }
    }));
    const degradations: Array<{ reason: string; model: string }> = [];
    const { adapter } = analyzer(script, {
      telemetry: { recordDegraded: (input) => void degradations.push(input) },
      maxSteps: 6
    });

    const output = await adapter.analyze(buildInput());

    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("token-budget-exhausted");
    expect(output.promptVersion).toBe(LOG_ANALYSIS_LOOP_PROMPT_VERSION);
    expect(degradations).toEqual([{ reason: "token-budget-exhausted", model: "loop-test" }]);
  });

  it("corrects non-JSON output and degrades when it never recovers", async () => {
    const { adapter } = analyzer([
      { content: "I think the problem is thermal." },
      { content: "Sorry, let me explain in prose again." },
      { content: "Still prose." }
    ]);

    const output = await adapter.analyze(buildInput());
    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("token-budget-exhausted");
  });

  it("rejects an ungrounded final, lets the model correct, and prunes fabricated lines", async () => {
    const { model, adapter } = analyzer([
      {
        content: {
          ...finalPayload,
          evidence: [{ lineNumbers: [999], inference: "Fabricated.", suggestedAction: "None." }]
        }
      },
      { content: finalPayload }
    ]);

    const output = await adapter.analyze(buildInput());

    expect(output.analysisSource).toBe("agent");
    expect(output.evidence[0].lineNumbers).toEqual([3, 4]);
    expect(model.calls[1].at(-1)?.content).toContain("Grounding violation");
  });

  it("converges early with capped confidence and a degraded marker when steps run out", async () => {
    const toolStep: ScriptedModelResponse = { content: { action: "tool", tool: "get_prefilter_findings", args: {} } };
    const { adapter } = analyzer(
      [toolStep, toolStep, { content: { ...finalPayload, confidence: 0.95 } }],
      { maxSteps: 2 }
    );

    const output = await adapter.analyze(buildInput());

    expect(output.analysisSource).toBe("agent");
    expect(output.degradedReason).toBe("token-budget-exhausted");
    expect(output.confidence).toBeLessThanOrEqual(0.5);
    expect(output.evidence.length).toBeGreaterThan(0);
  });

  it("stops looping once the token budget is spent and converges early", async () => {
    const usage = { inputTokens: 600, outputTokens: 30 };
    const { model, adapter } = analyzer(
      [
        { content: { action: "tool", tool: "get_prefilter_findings", args: {} }, usage },
        { content: { ...finalPayload, confidence: 0.9 } }
      ],
      { maxSteps: 6, tokenBudget: 500 }
    );

    const output = await adapter.analyze(buildInput());

    // One loop call burns the budget; the second call is the convergence attempt.
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].at(-1)?.content).toContain("Budget exhausted");
    expect(output.analysisSource).toBe("agent");
    expect(output.degradedReason).toBe("token-budget-exhausted");
    expect(output.confidence).toBeLessThanOrEqual(0.5);
  });

  it("falls back to rules when even the convergence attempt stays ungrounded", async () => {
    const toolStep: ScriptedModelResponse = { content: { action: "tool", tool: "get_prefilter_findings", args: {} } };
    const { adapter } = analyzer(
      [toolStep, { content: "no json at the end" }],
      { maxSteps: 1 }
    );

    const output = await adapter.analyze(buildInput());
    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("token-budget-exhausted");
  });

  it("propagates provider failures for the worker retry chain", async () => {
    const { adapter } = analyzer([{ error: new LogAnalysisProviderError("boom", { modelLabel: "loop-test" }) }]);
    await expect(adapter.analyze(buildInput())).rejects.toBeInstanceOf(LogAnalysisProviderError);
  });

  it("records llm telemetry with token usage per call", async () => {
    const llmCalls: Array<{ outcome: string; inputTokens?: number; outputTokens?: number }> = [];
    const { adapter } = analyzer(
      [
        { content: { action: "tool", tool: "get_prefilter_findings", args: {} }, usage: { inputTokens: 100, outputTokens: 10 } },
        { content: finalPayload, usage: { inputTokens: 150, outputTokens: 40 } }
      ],
      {
        telemetry: {
          recordLlmCall: (input) =>
            void llmCalls.push({ outcome: input.outcome, inputTokens: input.inputTokens, outputTokens: input.outputTokens })
        }
      }
    );

    await adapter.analyze(buildInput());
    expect(llmCalls).toEqual([
      { outcome: "ok", inputTokens: 100, outputTokens: 10 },
      { outcome: "ok", inputTokens: 150, outputTokens: 40 }
    ]);
  });

  it("drives the deterministic loop model to a grounded thermal-foldback conclusion", async () => {
    const adapter = createAgentLoopLogAnalyzer({
      model: createDeterministicLogAnalysisLoopModel(),
      modelLabel: "deterministic",
      tokenBudget: 100_000,
      maxSteps: 6
    });

    const output = await adapter.analyze(buildInput({ analysisQuestion: "Why did fast charging fold back?" }));

    expect(output.analysisSource).toBe("agent");
    expect(output.degradedReason).toBeUndefined();
    expect(output.conclusion.toLowerCase()).toContain("thermal foldback");
    expect(output.conclusion).toContain("Why did fast charging fold back?");
    expect(output.evidence.length).toBeGreaterThan(0);
    const parsedLines = new Set(buildInput().parsed.entries.map((entry) => entry.lineNumber));
    for (const item of output.evidence) {
      for (const lineNumber of item.lineNumbers) {
        expect(parsedLines.has(lineNumber)).toBe(true);
      }
    }
  });

  it("binds tool backends per run so read_domain_knowledge sees the domain scope", async () => {
    const knowledgeQueries: string[] = [];
    const { adapter } = analyzer(
      [
        { content: { action: "tool", tool: "read_domain_knowledge", args: { query: "thermal foldback code" } } },
        { content: finalPayload }
      ],
      {
        bindToolBackends: (input) => ({
          searchDomainKnowledge: async (query) => {
            knowledgeQueries.push(`${input.logDomainId ?? "none"}:${query}`);
            return { scope: "domain-linked", retrievalMode: "fts_only", items: [] };
          }
        })
      }
    );

    await adapter.analyze(buildInput({ organizationId: "org-1", logDomainId: "domain-1" }));
    expect(knowledgeQueries).toEqual(["domain-1:thermal foldback code"]);
  });
});
