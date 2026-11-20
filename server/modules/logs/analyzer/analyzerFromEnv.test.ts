import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { parseLogText } from "../parser";
import { createLogAnalyzerFromEnv, type LogAnalyzerEnv } from "./analyzerFromEnv";
import { LOG_ANALYSIS_LOOP_PARAMETER_PROMPT_VERSION, LOG_ANALYSIS_LOOP_PROMPT_VERSION } from "./agentLoop";
import { LOG_ANALYSIS_PARAMETER_PROMPT_VERSION, LOG_ANALYSIS_PROMPT_VERSION } from "./llmAnalyzer";

const env: LogAnalyzerEnv = {
  LOG_ANALYSIS_API_TIMEOUT_MS: 1000, LOG_ANALYSIS_TOKEN_BUDGET: 100_000,
  LOG_ANALYSIS_DETERMINISTIC: true, LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_MAX_STEPS: 6
};

it.each([
  "docs/runbooks/log-analysis-llm.md", "docs/zh-CN/runbooks/log-analysis-llm.md",
  "docs/adr/0047-log-analysis-is-a-skill-platform-over-a-shared-agent-kernel.md",
  "docs/zh-CN/design-docs/adr-0047-log-analysis-is-a-skill-platform-over-a-shared-agent-kernel.md"
])("lists the runtime prompt versions in %s", async (path) => {
  const doc = await readFile(path, "utf8");
  for (const version of [LOG_ANALYSIS_LOOP_PROMPT_VERSION, LOG_ANALYSIS_LOOP_PARAMETER_PROMPT_VERSION,
    LOG_ANALYSIS_PROMPT_VERSION, LOG_ANALYSIS_PARAMETER_PROMPT_VERSION]) expect(doc).toContain(`\`${version}\``);
});

describe("single-shot recovery from a loop failure", () => {
  const final = {
    conclusion: "Thermal foldback", impact: "Reduced charge current", severity: "Warning", confidence: 0.9,
    suggestedActions: ["Inspect cooling"],
    evidence: [{ lineNumbers: [1], inference: "Foldback logged", suggestedAction: "Check temperature" }]
  };
  const malformed = { content: "invalid output" };
  const tool = { content: null, tool_calls: [{ id: "prefilter", type: "function",
    function: { name: "get_prefilter_findings", arguments: "{}" } }] };

  it.each([
    { name: "grounded retry", retry: true, reply: final, source: "single-shot-fallback", reason: "invalid-model-output", calls: 4 },
    { name: "ungrounded retry", retry: true, reply: { ...final, evidence: [{ ...final.evidence[0], lineNumbers: [999] }] },
      source: "rules-fallback", reason: "invalid-model-output", calls: 4 },
    { name: "provider error on retry", retry: true, reply: final, retryError: true, source: "rules-fallback", reason: "invalid-model-output", calls: 4 },
    { name: "retry disabled", retry: false, reply: final, source: "rules-fallback", reason: "invalid-model-output", calls: 3 },
    { name: "step budget exhausted", retry: true, reply: final, source: "rules-fallback", reason: "step-budget-exhausted", calls: 2, maxSteps: 1 },
    { name: "token budget exhausted", retry: true, reply: final, source: "rules-fallback", reason: "token-budget-exhausted", calls: 1, exhaustOn: 1 },
    { name: "invalid turn spends the remaining budget", retry: true, reply: final, source: "rules-fallback",
      reason: "token-budget-exhausted", calls: 3, exhaustOn: 3 }
  ])("handles $name with the pinned model", async ({ retry, reply, source, reason, calls, maxSteps, retryError, exhaustOn }) => {
    const parsed = parseLogText({ fileName: "power.log", content: "2026-08-10T08:00:01Z ERROR thermal foldback charge_current_ma=2000" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    const requests: Array<{ model: string; tools?: unknown[]; messages: Array<{ content: string }> }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as typeof requests[number];
      requests.push(request);
      if (!request.tools && retryError) return Response.json({ error: { message: "Unavailable" } }, { status: 503 });
      const message = request.tools
        ? maxSteps && requests.length === 1 ? tool : malformed
        : { content: JSON.stringify(reply) };
      return Response.json({ choices: [{ message: { role: "assistant", ...message }, finish_reason: "stop" }],
        usage: { prompt_tokens: requests.length === exhaustOn ? 100_000 : 100, completion_tokens: 10 } });
    });
    try {
      const trace: Array<{ index: number; kind: string; protocol?: string }> = [];
      const output = await createLogAnalyzerFromEnv({
        ...env, LOG_ANALYSIS_API_BASE_URL: "https://fallback.example.invalid/v1", LOG_ANALYSIS_API_KEY: "fixture-key",
        LOG_ANALYSIS_MODEL: "platform", LOG_ANALYSIS_DETERMINISTIC: false, LOG_ANALYSIS_PROTOCOL: "tools",
        LOG_ANALYSIS_SINGLE_SHOT_FALLBACK: retry, LOG_ANALYSIS_VERIFY_CONCLUSION: true, LOG_ANALYSIS_MAX_STEPS: maxSteps ?? 6
      }).analyze({ parsed, procedure: "Read the foldback event first.", logDomain: { name: "Charging", modelOverride: "pinned" },
        onTrace: (step) => { trace.push(step); } });
      expect(output).toMatchObject({ analysisSource: source, degradedReason: reason, model: "pinned" });
      expect(requests.map(({ model }) => model)).toEqual(Array(calls).fill("pinned"));
      expect(trace.filter(({ kind }) => kind === "degradation")).toHaveLength(1);
      if (calls === 4) {
        expect(trace.filter(({ kind }) => kind === "model-turn").map(({ protocol }) => protocol)).toEqual(["tools", "tools", "tools", "json"]);
        expect(trace.map(({ index }) => index)).toEqual(trace.map((_, index) => index + 1));
        expect(requests.at(-1)?.messages.some(({ content }) => content.includes("Read the foldback event first."))).toBe(true);
      }
      if (source === "single-shot-fallback") {
        expect(output).toMatchObject({ confidence: 0.5, conclusion: final.conclusion, evidence: [{ lineNumbers: [1] }] });
        expect(output.verification).toBeUndefined();
      }
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("pinned skill runtime budgets", () => {
  it("caps investigation output before spending the reserve and bounds the convergence call", async () => {
    const parsed = parseLogText({ fileName: "power.log", content: "ERROR thermal foldback" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    const budgets: number[] = [];
    const used: number[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { max_tokens: number; messages: { content: string }[] };
      budgets.push(request.max_tokens);
      const converging = request.messages.some(({ content }) => content.includes("Budget exhausted:"));
      const message = converging ? { action: "final", conclusion: "Thermal foldback", impact: "Reduced current",
        severity: "Warning", confidence: 0.9, suggestedActions: ["Inspect cooling"], evidence: [{ lineNumbers: [1], inference: "Foldback logged", suggestedAction: "Inspect cooling" }] }
        : { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } };
      const inputTokens = 8 + request.messages.reduce((sum, { content }) => sum + 4 + Math.ceil(Buffer.byteLength(content) / 4), 0);
      const outputTokens = converging ? 100 : request.max_tokens;
      used.push(inputTokens + outputTokens);
      return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(message) }, finish_reason: "stop" }],
        usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens } });
    });
    try {
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_DETERMINISTIC: false,
        LOG_ANALYSIS_API_BASE_URL: "https://budget.example.invalid/v1", LOG_ANALYSIS_API_KEY: "fixture-key",
        LOG_ANALYSIS_PROTOCOL: "json", LOG_ANALYSIS_TOKEN_BUDGET: 3650 }).analyze({ parsed });
      expect(output).toMatchObject({ analysisSource: "agent", degradedReason: "token-budget-exhausted", confidence: 0.5 });
      expect(budgets).toHaveLength(2);
      expect(budgets[0]).toBeLessThan(Math.floor(3650 / 4));
      expect(used[1] - 100 + budgets[1] + used[0]).toBeLessThanOrEqual(3650);
      expect(used[0]).toBeLessThanOrEqual(3650 * 0.8);
    } finally { fetch.mockRestore(); }
  });

  it("skips single-shot recovery when the remaining budget cannot fit its prompt", async () => {
    const parsed = parseLogText({ fileName: "power.log", content: "ERROR thermal foldback" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    const invoke = vi.fn().mockResolvedValue({ content: "invalid output", usage: { inputTokens: 300, outputTokens: 20 } })
      .mockResolvedValueOnce({ content: "invalid output", usage: { inputTokens: 300, outputTokens: 20 } })
      .mockResolvedValueOnce({ content: "invalid output", usage: { inputTokens: 300, outputTokens: 20 } })
      .mockResolvedValueOnce({ content: "invalid output", usage: { inputTokens: 3600, outputTokens: 20 } });
    const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_TOKEN_BUDGET: 4500,
      LOG_ANALYSIS_PROTOCOL: "json", LOG_ANALYSIS_SINGLE_SHOT_FALLBACK: true }, { model: { invoke } })
      .analyze({ parsed });
    expect(output).toMatchObject({ analysisSource: "rules-fallback", degradedReason: "token-budget-exhausted" });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("uses the optional conclusion verifier model and otherwise inherits the run model", async () => {
    const parsed = parseLogText({ fileName: "power.log", content: "INFO operating normally\nINFO cycle complete" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    const settings = { ...env, LOG_ANALYSIS_VERIFY_CONCLUSION: true };
    const logDomain = { name: "Power", modelOverride: "analysis-model" };
    for (const [configured, expected] of [[undefined, "analysis-model"], ["verify-model", "verify-model"]] as const) {
      const output = await createLogAnalyzerFromEnv({ ...settings, LOG_ANALYSIS_VERIFIER_MODEL: configured }).analyze({ parsed, logDomain });
      expect(output).toMatchObject({ model: "analysis-model", verification: {
        status: "passed", checkedClaims: 2, unsupportedClaims: 0, model: expected
      } });
    }
  });

  it("uses the platform token budget when the skill does not override it", async () => {
    // The final-answer reserve stops this three-turn fixture early at 8,000 tokens.
    const content = await readFile(new URL("../../../../test-fixtures/logs/charging-foldback.log", import.meta.url), "utf8");
    const parsed = parseLogText({ fileName: "charging-foldback.log", content });
    if (!parsed.ok) throw new Error("Fixture must parse");
    for (const logDomain of [undefined, { name: "No budget override" }, { name: "Explicit revision budget", tokenBudget: 10_000 }]) {
      const calls: string[] = [];
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_TOKEN_BUDGET: 10_000, LOG_ANALYSIS_PROTOCOL: "json" }, {
        telemetry: { recordLlmCall: (call) => { calls.push(call.outcome); } }
      }).analyze({ parsed, analysisQuestion: "Why did fast charging fold back?", logDomain });
      expect(output).toMatchObject({ analysisSource: "agent", conclusion: expect.stringMatching(/过热|降额/) });
      expect(output.degradedReason).toBeUndefined();
      expect(calls).toEqual(["ok", "ok", "ok"]);

      calls.length = 0;
      const bounded = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_TOKEN_BUDGET: 10_000, LOG_ANALYSIS_PROTOCOL: "json" }, {
        telemetry: { recordLlmCall: (call) => { calls.push(call.outcome); } }
      }).analyze({ parsed, procedure: "Review the captured evidence. ".repeat(220), logDomain });
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

describe("reasoning-model replies", () => {
  const report = { conclusion: "Thermal foldback", impact: "Reduced current", severity: "Warning", confidence: 0.8,
    suggestedActions: ["Inspect cooling"], evidence: [{ lineNumbers: [1], inference: "Foldback logged", suggestedAction: "Inspect cooling" }] };
  const think = "<think>The user wants JSON. Maybe action tools? Let me plan the reads.</think>\n\n";

  it.each([
    { protocol: "json" as const, replies: [
      { content: `${think}${JSON.stringify({ action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } })}` },
      { content: `${think}${JSON.stringify({ action: "final", ...report })}` }
    ] },
    { protocol: "tools" as const, replies: [
      { content: think, tool_calls: [{ id: "a", type: "function", function: { name: "get_prefilter_findings", arguments: "{}" } }] },
      { content: think, tool_calls: [{ id: "b", type: "function", function: { name: "final_report", arguments: JSON.stringify(report) } }] }
    ] }
  ])("ignores a leading <think> block with the $protocol protocol and keeps it out of history", async ({ protocol, replies }) => {
    const parsed = parseLogText({ fileName: "power.log", content: "ERROR thermal foldback" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    const requests: Array<{ messages: Array<{ content: string | null }> }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const message = replies[Math.min(requests.length, replies.length) - 1];
      return Response.json({ choices: [{ message: { role: "assistant", ...message }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 40 } });
    });
    try {
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_DETERMINISTIC: false,
        LOG_ANALYSIS_API_BASE_URL: "https://reasoning.example.invalid/v1", LOG_ANALYSIS_API_KEY: "fixture-key",
        LOG_ANALYSIS_PROTOCOL: protocol }).analyze({ parsed });
      expect(output).toMatchObject({ analysisSource: "agent", conclusion: "Thermal foldback" });
      expect(output.degradedReason).toBeUndefined();
      expect(requests).toHaveLength(replies.length);
      expect(JSON.stringify(requests.map(({ messages }) => messages))).not.toContain("<think>");
    } finally { fetch.mockRestore(); }
  });
});

describe("final-answer allowance", () => {
  it("keeps a full final-answer output allowance when investigation turns spend their whole output cap", async () => {
    const parsed = parseLogText({ fileName: "power.log", content: "ERROR thermal foldback" });
    if (!parsed.ok) throw new Error("Fixture must parse");
    const finalCaps: number[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { max_tokens: number; messages: { content: string }[] };
      const converging = request.messages.some(({ content }) => content.includes("Budget exhausted:"));
      if (converging) finalCaps.push(request.max_tokens);
      const message = converging ? { action: "final", conclusion: "Thermal foldback", impact: "Reduced current",
        severity: "Warning", confidence: 0.9, suggestedActions: ["Inspect cooling"], evidence: [{ lineNumbers: [1], inference: "Foldback logged", suggestedAction: "Inspect cooling" }] }
        : { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } };
      const inputTokens = 8 + request.messages.reduce((sum, { content }) => sum + 4 + Math.ceil(Buffer.byteLength(content) / 4), 0);
      return Response.json({ choices: [{ message: { role: "assistant", content: JSON.stringify(message) }, finish_reason: "stop" }],
        usage: { prompt_tokens: inputTokens, completion_tokens: converging ? 100 : request.max_tokens } });
    });
    try {
      const output = await createLogAnalyzerFromEnv({ ...env, LOG_ANALYSIS_DETERMINISTIC: false,
        LOG_ANALYSIS_API_BASE_URL: "https://allowance.example.invalid/v1", LOG_ANALYSIS_API_KEY: "fixture-key",
        LOG_ANALYSIS_PROTOCOL: "json", LOG_ANALYSIS_TOKEN_BUDGET: 24_000 }).analyze({ parsed });
      expect(output).toMatchObject({ analysisSource: "agent", degradedReason: "token-budget-exhausted" });
      expect(finalCaps).toHaveLength(1);
      // Reasoning models spend output on thinking before the report; 2,048 tokens truncated MiniMax-M3 reports.
      expect(finalCaps[0]).toBeGreaterThanOrEqual(3_000);
    } finally { fetch.mockRestore(); }
  });
});
