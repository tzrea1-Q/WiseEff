import { describe, expect, it } from "vitest";

import { parseLogText } from "../parser";
import { analyzeWithDegradation } from "../worker";
import {
  buildBudgetedExcerpt,
  createLlmLogAnalyzer,
  groundLlmEvidence,
  LOG_ANALYSIS_PROMPT_VERSION,
  LogAnalysisProviderError,
  type LogAnalysisChatMessage,
  type LogAnalysisChatModel
} from "./llmAnalyzer";
import { createDeterministicLogAnalysisModel, LOG_ANALYSIS_SIMULATED_OUTAGE_MARKER } from "./deterministicModel";

const fixtureLog = [
  "2026-08-10T08:00:01Z INFO charge session started requested_ma=6000",
  "2026-08-10T08:00:02Z INFO battery_temp=38C pack ok",
  "2026-08-10T08:00:03Z WARN thermal foldback engaged battery_temp=52C",
  "2026-08-10T08:00:04Z ERROR charge current reduced code=E_THERMAL_FOLDBACK requested_ma=6000 charge_current_ma=2000",
  "2026-08-10T08:00:05Z INFO charge continuing at reduced rate"
].join("\n");

function parseFixture(content = fixtureLog) {
  const parsed = parseLogText({ fileName: "charging.log", content: Buffer.from(content, "utf8") });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed;
}

function jsonModel(payload: unknown, captured?: LogAnalysisChatMessage[]): LogAnalysisChatModel {
  return {
    async invoke(messages) {
      captured?.push(...messages);
      return { content: JSON.stringify(payload), usage: { inputTokens: 100, outputTokens: 50 } };
    }
  };
}

const validPayload = {
  conclusion: "Thermal foldback reduced the charge current.",
  impact: "Charging stays slow until the pack cools.",
  severity: "Warning",
  confidence: 0.9,
  suggestedActions: ["Inspect cooling."],
  evidence: [{ lineNumbers: [3, 4], inference: "Foldback engaged and current dropped.", suggestedAction: "Check thermal window." }]
};

describe("createLlmLogAnalyzer", () => {
  it("returns a grounded agent analysis with prompt version and model label", async () => {
    const calls: Array<{ outcome: string }> = [];
    const analyzer = createLlmLogAnalyzer({
      model: jsonModel(validPayload),
      modelLabel: "test-model",
      tokenBudget: 8000,
      telemetry: { recordLlmCall: (input) => calls.push(input) }
    });

    const output = await analyzer.analyze({ parsed: parseFixture() });

    expect(output.analysisSource).toBe("agent");
    expect(output.degradedReason).toBeUndefined();
    expect(output.promptVersion).toBe(LOG_ANALYSIS_PROMPT_VERSION);
    expect(output.model).toBe("test-model");
    expect(output.evidence).toHaveLength(1);
    expect(output.evidence[0].lineNumbers).toEqual([3, 4]);
    expect(output.evidence[0].stageId).toBe("rootcause");
    expect(calls).toEqual([expect.objectContaining({ outcome: "ok" })]);
  });

  it("injects the analysis question and log domain into the prompt", async () => {
    const captured: LogAnalysisChatMessage[] = [];
    const analyzer = createLlmLogAnalyzer({
      model: jsonModel(validPayload, captured),
      modelLabel: "test-model",
      tokenBudget: 8000
    });

    await analyzer.analyze({
      parsed: parseFixture(),
      analysisQuestion: "Why did fast charging fold back?",
      logDomain: { name: "charging-power", description: "Charging subsystem" }
    });

    const prompt = captured.map((message) => message.content).join("\n");
    expect(prompt).toContain("Why did fast charging fold back?");
    expect(prompt).toContain("charging-power");
    expect(prompt).toContain("Deterministic prefilter findings:");
    expect(prompt).toMatch(/L4: /);
  });

  it("degrades to the rules fallback when the output is not strict JSON", async () => {
    const degraded: Array<{ reason: string }> = [];
    const analyzer = createLlmLogAnalyzer({
      model: { async invoke() { return { content: "sorry, no JSON" }; } },
      modelLabel: "test-model",
      tokenBudget: 8000,
      telemetry: { recordDegraded: (input) => degraded.push(input) }
    });

    const output = await analyzer.analyze({ parsed: parseFixture() });

    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("token-budget-exhausted");
    expect(output.model).toBe("test-model");
    expect(output.evidence.length).toBeGreaterThan(0);
    expect(degraded).toEqual([{ reason: "token-budget-exhausted", model: "test-model" }]);
  });

  it("degrades when every cited line is nonexistent", async () => {
    const analyzer = createLlmLogAnalyzer({
      model: jsonModel({
        ...validPayload,
        evidence: [{ lineNumbers: [999], inference: "Fabricated.", suggestedAction: "None." }]
      }),
      modelLabel: "test-model",
      tokenBudget: 8000
    });

    const output = await analyzer.analyze({ parsed: parseFixture() });

    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("token-budget-exhausted");
    expect(output.evidence.flatMap((item) => item.lineNumbers)).not.toContain(999);
  });

  it("prunes invalid citations but keeps the agent output when a valid line survives", async () => {
    const analyzer = createLlmLogAnalyzer({
      model: jsonModel({
        ...validPayload,
        evidence: [{ lineNumbers: [4, 999], inference: "Mixed.", suggestedAction: "Check." }]
      }),
      modelLabel: "test-model",
      tokenBudget: 8000
    });

    const output = await analyzer.analyze({ parsed: parseFixture() });

    expect(output.analysisSource).toBe("agent");
    expect(output.evidence[0].lineNumbers).toEqual([4]);
  });

  it("throws LogAnalysisProviderError for provider failures with the model label attached", async () => {
    const calls: Array<{ outcome: string }> = [];
    const analyzer = createLlmLogAnalyzer({
      model: { async invoke() { throw new Error("connect ECONNREFUSED"); } },
      modelLabel: "test-model",
      tokenBudget: 8000,
      telemetry: { recordLlmCall: (input) => calls.push(input) }
    });

    await expect(analyzer.analyze({ parsed: parseFixture() })).rejects.toMatchObject({
      name: "LogAnalysisProviderError",
      modelLabel: "test-model"
    });
    expect(calls).toEqual([expect.objectContaining({ outcome: "provider_error" })]);
  });

  it("accepts fenced JSON output", async () => {
    const analyzer = createLlmLogAnalyzer({
      model: {
        async invoke() {
          return { content: "```json\n" + JSON.stringify(validPayload) + "\n```" };
        }
      },
      modelLabel: "test-model",
      tokenBudget: 8000
    });

    const output = await analyzer.analyze({ parsed: parseFixture() });

    expect(output.analysisSource).toBe("agent");
  });
});

describe("buildBudgetedExcerpt", () => {
  it("prioritizes anomaly neighborhoods and respects the character budget", () => {
    const rawLines = Array.from({ length: 200 }, (_, index) => `line ${index + 1} content padding padding`);
    const excerpt = buildBudgetedExcerpt({
      rawLines,
      anomalyLineNumbers: [100],
      charBudget: 400
    });

    const lineNumbers = excerpt.map((line) => line.lineNumber);
    expect(lineNumbers).toContain(100);
    expect(lineNumbers).toContain(99);
    expect(lineNumbers).toContain(101);
    const totalChars = excerpt.reduce((total, line) => total + line.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(400);
    expect([...lineNumbers].sort((a, b) => a - b)).toEqual(lineNumbers);
  });

  it("includes head and tail context when the budget allows", () => {
    const rawLines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
    const excerpt = buildBudgetedExcerpt({ rawLines, anomalyLineNumbers: [20], charBudget: 100_000 });

    const lineNumbers = excerpt.map((line) => line.lineNumber);
    expect(lineNumbers).toContain(1);
    expect(lineNumbers).toContain(40);
  });
});

describe("groundLlmEvidence", () => {
  it("drops nonexistent lines and empty evidence items", () => {
    const grounded = groundLlmEvidence(
      [
        { lineNumbers: [2, 500], inference: "Mixed.", suggestedAction: "A." },
        { lineNumbers: [900], inference: "All invalid.", suggestedAction: "B." }
      ],
      new Set([1, 2, 3])
    );

    expect(grounded).toHaveLength(1);
    expect(grounded[0].lineNumbers).toEqual([2]);
  });
});

describe("analyzeWithDegradation", () => {
  const providerFailingAnalyzer = createLlmLogAnalyzer({
    model: {
      async invoke() {
        throw new LogAnalysisProviderError("outage", { modelLabel: "test-model" });
      }
    },
    modelLabel: "test-model",
    tokenBudget: 8000
  });

  it("rethrows provider errors while retries remain", async () => {
    await expect(
      analyzeWithDegradation({
        analyzer: providerFailingAnalyzer,
        analyzeInput: { parsed: parseFixture() },
        job: { attemptCount: 1 },
        maxAttempts: 4,
        retryBaseDelayMs: 1,
        now: () => new Date()
      })
    ).rejects.toBeInstanceOf(LogAnalysisProviderError);
  });

  it("falls back to the rule engine with honest provenance on the final attempt", async () => {
    const degraded: Array<{ reason: string; model: string }> = [];
    const output = await analyzeWithDegradation({
      analyzer: providerFailingAnalyzer,
      analyzeInput: { parsed: parseFixture() },
      job: { attemptCount: 4 },
      maxAttempts: 4,
      retryBaseDelayMs: 1,
      now: () => new Date(),
      metrics: {
        recordLogAnalysisJobResult: () => undefined,
        recordLogAnalysisDegraded: (input) => degraded.push(input)
      }
    });

    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("provider-unavailable");
    expect(output.promptVersion).toBe(LOG_ANALYSIS_PROMPT_VERSION);
    expect(output.model).toBe("test-model");
    expect(output.evidence.length).toBeGreaterThan(0);
    expect(degraded).toEqual([{ reason: "provider-unavailable", model: "test-model" }]);
  });

  it("rethrows non-provider errors untouched", async () => {
    await expect(
      analyzeWithDegradation({
        analyzer: { async analyze() { throw new Error("parse exploded"); } },
        analyzeInput: { parsed: parseFixture() },
        job: { attemptCount: 4 },
        maxAttempts: 4,
        retryBaseDelayMs: 1,
        now: () => new Date()
      })
    ).rejects.toThrow("parse exploded");
  });
});

describe("createDeterministicLogAnalysisModel", () => {
  it("produces a grounded thermal-foldback conclusion for the charging fixture", async () => {
    const analyzer = createLlmLogAnalyzer({
      model: createDeterministicLogAnalysisModel(),
      modelLabel: "deterministic",
      tokenBudget: 8000
    });

    const output = await analyzer.analyze({
      parsed: parseFixture(),
      analysisQuestion: "Why did fast charging fold back?"
    });

    expect(output.analysisSource).toBe("agent");
    expect(output.model).toBe("deterministic");
    expect(output.conclusion).toMatch(/thermal foldback/i);
    expect(output.conclusion).toContain("Why did fast charging fold back?");
    expect(output.evidence.length).toBeGreaterThan(0);
  });

  it("simulates a provider outage when the log contains the outage marker", async () => {
    const analyzer = createLlmLogAnalyzer({
      model: createDeterministicLogAnalysisModel(),
      modelLabel: "deterministic",
      tokenBudget: 8000
    });

    await expect(
      analyzer.analyze({
        parsed: parseFixture(`${fixtureLog}\n2026-08-10T08:00:06Z INFO ${LOG_ANALYSIS_SIMULATED_OUTAGE_MARKER}`)
      })
    ).rejects.toBeInstanceOf(LogAnalysisProviderError);
  });
});
