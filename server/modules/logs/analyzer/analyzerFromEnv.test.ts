import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseLogText } from "../parser";
import { createLogAnalyzerFromEnv, type LogAnalyzerEnv } from "./analyzerFromEnv";

const env: LogAnalyzerEnv = {
  LOG_ANALYSIS_API_TIMEOUT_MS: 1000, LOG_ANALYSIS_TOKEN_BUDGET: 100_000,
  LOG_ANALYSIS_DETERMINISTIC: true, LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_MAX_STEPS: 6
};

describe("pinned skill runtime budgets", () => {
  it("uses the platform token budget when the skill does not override it", async () => {
    const content = await readFile(new URL("../../../../test-fixtures/logs/charging-foldback.log", import.meta.url), "utf8");
    const parsed = parseLogText({ fileName: "charging-foldback.log", content });
    if (!parsed.ok) throw new Error("Fixture must parse");
    for (const logDomain of [undefined, { name: "No budget override" }, { name: "Explicit revision budget", tokenBudget: 8000 }]) {
      const calls: string[] = [];
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_TOKEN_BUDGET: 8000 }, {
        telemetry: { recordLlmCall: (call) => { calls.push(call.outcome); } }
      }).analyze({ parsed, analysisQuestion: "Why did fast charging fold back?", logDomain });
      expect(output).toMatchObject({ analysisSource: "agent", conclusion: expect.stringMatching(/过热|降额/) });
      expect(output.degradedReason).toBeUndefined();
      expect(calls).toEqual(["ok", "ok", "ok"]);

      calls.length = 0;
      const bounded = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_TOKEN_BUDGET: 8000 }, {
        telemetry: { recordLlmCall: (call) => { calls.push(call.outcome); } }
      }).analyze({ parsed, procedure: "Review the captured evidence. ".repeat(680), logDomain });
      expect(bounded).toMatchObject({ analysisSource: "agent", degradedReason: "token-budget-exhausted", confidence: 0.3 });
      expect(calls).toEqual(["ok", "ok"]);
    }
  });
  it("uses revision step budgets and keeps older revisions below a lowered platform cap", async () => {
    const parsed = parseLogText({ fileName: "power.log", content: "2026-08-10T08:00:01Z ERROR thermal foldback charge_current_ma=2000" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    for (const [stepBudget, platformCap, expected] of [[2, 6, 2], [6, 2, 2]] as const) {
      const progress: number[] = [];
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_MAX_STEPS: platformCap }).analyze({
        parsed, logDomain: { name: "Power", stepBudget }, onProgress: async ({ maxSteps }) => { progress.push(maxSteps); }
      });
      expect(progress.length).toBeGreaterThan(0);
      expect(new Set(progress)).toEqual(new Set([expected]));
      expect(output.degradedReason).toBe("step-budget-exhausted");
    }
  });

  it("stops at a revision token budget or a lower platform token cap", async () => {
    const parsed = parseLogText({ fileName: "power.log", content: "2026-08-10T08:00:01Z ERROR thermal foldback charge_current_ma=2000" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    for (const [tokenBudget, platformCap] of [[1, 100_000], [100_000, 1], [undefined, 1]] as const) {
      const steps: number[] = [];
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_TOKEN_BUDGET: platformCap }).analyze({
        parsed, logDomain: { name: "Power", tokenBudget }, onProgress: async ({ step }) => { steps.push(step); }
      });
      expect(steps).toEqual([1, 6]);
      expect(output.degradedReason).toBe("token-budget-exhausted");
    }
  });
});
