import { describe, expect, it, vi } from "vitest";

import type { AnalyzeLogInput } from "../analyzer";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "../analyzer";
import type { RelatedParameterRunSnapshot } from "../relatedParameter";
import { parseLogText } from "../parser";
import { defaultChargingRuleSet } from "../chargingSignalRules";
import { decodeLogFiles } from "../parsing/engine";
import { parsingSpecSchema } from "../parsing/spec";
import {
  createAgentLoopLogAnalyzer,
  LOG_ANALYSIS_LOOP_PARAMETER_PROMPT_VERSION,
  LOG_ANALYSIS_LOOP_PROMPT_VERSION,
  LOG_ANALYSIS_MAX_CONSECUTIVE_INVALID
} from "./agentLoop";
import { createDeterministicLogAnalysisLoopModel } from "./deterministicModel";
import { LogAnalysisProviderError } from "./llmAnalyzer";
import { createScriptedLogAnalysisModel, type ScriptedModelResponse } from "./scriptedModel";
import { estimateLogPromptTokens } from "./modelBudget";
import { summarizeTraceArguments, type LogAnalysisTraceStep } from "../traceTypes";
import { logTraceStepSchema } from "../../contracts/dtoSchemas/logs";
import { createLogAnalyzerFromEnv } from "./analyzerFromEnv";

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

const readChargingLines = { content: { action: "tool", tool: "read_line_range", args: { startLine: 2, endLine: 4 } } };
const supportedClaims = [{ id: 0, status: "supported" }, { id: 1, status: "supported" }];
const mixedCandidate = {
  ...finalPayload,
  evidence: [...finalPayload.evidence, { lineNumbers: [2], inference: "No battery temperature was recorded.", suggestedAction: "Inspect logging." }]
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
  it("starts in JSON in auto mode when the native tool catalogue cannot fit the budget", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([readChargingLines, { content: finalPayload }], {
      protocol: "auto", hypothesisLedger: true, tokenBudget: 8000
    });
    const report = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));
    expect(report).toMatchObject({ analysisSource: "agent", evidence: [{ lineNumbers: [3, 4] }] });
    expect(trace.filter(({ kind }) => kind === "model-turn").map(({ protocol }) => protocol)).toEqual(["json", "json"]);
  });

  it.each(["json", "tools"] as const)("reminds once before verifying and reports grounded checklist progress in %s", async (protocol) => {
    const required = { id: "cooling", description: "Inspect cooling.", required: true };
    const pending = { id: "rail", description: "Check the rail.", required: true };
    const optional = { id: "ambient", description: "Check ambient temperature.", required: false };
    const anchor = { file: "charging.log", line: 3 };
    const verifier = createScriptedLogAnalysisModel([{ content: { claims: supportedClaims } }]);
    const { adapter, model } = analyzer([
      { content: { ...readChargingLines.content, notes: { checks: [{ id: optional.id, status: "skipped", reason: "无环境温度传感器", anchors: [] }] } } },
      { content: { ...finalPayload, conclusion: "Premature conclusion", notes: { checks: [{ id: "unknown", status: "done", anchors: [] }] } } },
      { content: { ...finalPayload, notes: { checks: [
        { id: required.id, status: "done", anchors: [anchor, { ...anchor, line: 6 }] }
      ] } } }
    ], { protocol, procedureChecklist: true, verifier: { model: verifier, modelLabel: "verify-test" } });
    const output = await adapter.analyze(buildInput({ filePath: anchor.file, procedureChecks: [required, pending, optional] }));
    expect(output).toMatchObject({ conclusion: finalPayload.conclusion, verification: { status: "passed" }, checks: [
      { ...required, status: "done", anchors: [anchor] }, { ...pending, status: "pending", anchors: [] },
      { ...optional, status: "skipped", reason: "无环境温度传感器", anchors: [] }
    ] });
    expect(verifier.calls).toHaveLength(1);
    expect(JSON.stringify(verifier.calls)).not.toContain("Premature conclusion");
    expect(model.calls).toHaveLength(3);
    expect(model.calls[2].some(({ content }) => content.includes("Required checklist items remain unhandled: cooling, rail."))).toBe(true);
  });

  it.each(["steps", "tokens", "disabled", "no checklist"] as const)(
    "does not send a checklist reminder with %s", async (constraint) => {
      const { adapter, model } = analyzer([readChargingLines, { content: finalPayload,
        usage: { inputTokens: constraint === "tokens" ? 79_000 : 200, outputTokens: 150 } }], {
        maxSteps: constraint === "steps" ? 2 : 4,
        procedureChecklist: constraint !== "disabled"
      });
      const check = { id: "cooling", description: "Inspect cooling.", required: true };
      const report = await adapter.analyze(buildInput({ procedure: "Look up the thermal event.",
        procedureChecks: constraint === "no checklist" ? undefined : [check] }));
      expect(report.conclusion).toBe(finalPayload.conclusion);
      const pending = constraint === "steps" || constraint === "tokens";
      expect(report.checks).toEqual(pending ? [{ ...check, status: "pending", anchors: [] }] : undefined);
      expect(model.calls).toHaveLength(2);
      if (!pending) expect(report.promptVersion).toBe(LOG_ANALYSIS_LOOP_PROMPT_VERSION);
    });

  it.each(["json", "tools"] as const)("flags a grounded conclusion that contradicts its cited line in %s", async (protocol) => {
    const verifier = createScriptedLogAnalysisModel([{ content: { claims: [
      { id: 0, status: "contradicted", counterAnchors: [{ file: "charging.log", line: 9999 }] },
      { id: 1, status: "contradicted" }
    ] }, usage: { inputTokens: 153, outputTokens: 39 } }]);
    const nativeVerifier = vi.spyOn(verifier, "invokeTools");
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 2, endLine: 2 } } },
      { content: { ...finalPayload, evidence: [{ ...finalPayload.evidence[0], lineNumbers: [2] }] } }
    ], { protocol, maxSteps: 2, verifier: { model: verifier, modelLabel: "verify-test" } });
    const trace: LogAnalysisTraceStep[] = [];
    const output = await adapter.analyze(buildInput({ filePath: "charging.log", procedure: "untrusted skill text",
      onTrace: (step) => { trace.push(step); } }));

    expect(output).toMatchObject({ analysisSource: "agent", conclusion: "现有证据不足以支持结论，请人工复核。",
      confidence: 0.5, evidence: [], verification: { status: "failed", checkedClaims: 2, unsupportedClaims: 2, model: "verify-test" } });
    expect(model.calls).toHaveLength(2);
    expect(verifier.calls).toHaveLength(1);
    expect(nativeVerifier).not.toHaveBeenCalled();
    expect(trace).toContainEqual(expect.objectContaining({ kind: "model-turn", inputTokens: 153, outputTokens: 39 }));
    const prompt = verifier.calls.flat().map(({ content }) => content).join("\n");
    expect(prompt).toContain("battery_temp=38C pack ok");
    expect(prompt).not.toContain("code=E_THERMAL_FOLDBACK");
    expect(prompt).not.toContain("untrusted skill text");
    expect(JSON.stringify(output)).not.toContain("9999");
  });

  it.each(["json", "tools"] as const)("keeps unsupported report content without revision in %s", async (protocol) => {
    const script = [readChargingLines, { content: mixedCandidate }];
    const input = buildInput();
    const original = await analyzer(script, { protocol }).adapter.analyze(input);
    const verifier = createScriptedLogAnalysisModel([{ content: { claims: [
      { id: 0, status: "unsupported" }, supportedClaims[1], { id: 2, status: "unsupported" }
    ] } }]);
    const { adapter, model } = analyzer(script, { protocol, verifier: { model: verifier, modelLabel: "verify-test" } });
    expect(original.evidence).toHaveLength(2);
    expect(await adapter.analyze(input)).toEqual({ ...original, confidence: 0.7,
      verification: { status: "failed", checkedClaims: 3, unsupportedClaims: 2, model: "verify-test" } });
    expect(model.calls).toHaveLength(2);
    expect(verifier.calls).toHaveLength(1);
  });

  it.each(["json", "tools"] as const)("revises contradicted evidence once and checks the replacement in %s", async (protocol) => {
    const verifier = createScriptedLogAnalysisModel([
      { content: { claims: [
        { id: 0, status: "unsupported", counterAnchors: [{ file: "charging.log", line: 5 }] },
        supportedClaims[1],
        { id: 2, status: "contradicted", counterAnchors: [{ file: "charging.log", line: 2 }, { file: "charging.log", line: 6 }] }
      ] } },
      { content: { claims: supportedClaims } }
    ]);
    const alternate = { statement: "适配器故障", reason: "日志记录热保护先触发", anchors: [{ file: "charging.log", line: 3 }] };
    const revised = { ...finalPayload, conclusion: "The logs show battery thermal foldback and reduced current.", alternativeHypotheses: [alternate] };
    const { adapter, model } = analyzer([readChargingLines, { content: mixedCandidate }, { content: revised }], {
      protocol, hypothesisLedger: true, verifier: { model: verifier, modelLabel: "verify-test" }
    });
    const onProgress = vi.fn();
    const output = await adapter.analyze(buildInput({ filePath: "charging.log", onProgress }));
    expect(output).toMatchObject({ conclusion: revised.conclusion, confidence: 0.9, alternativeHypotheses: [alternate],
      evidence: [expect.objectContaining({ lineNumbers: [3, 4] })],
      verification: { status: "revised", checkedClaims: 3, unsupportedClaims: 2, model: "verify-test" } });
    expect(onProgress.mock.calls.map(([state]) => state.step)).toEqual([1, 2, 3]);
    const revisionPrompt = model.calls.at(-1)?.at(-1)?.content;
    expect(revisionPrompt).toContain("contradicted by the cited lines");
    expect(revisionPrompt).toContain('"contradictedClaimIds":[2]');
    expect(revisionPrompt).toContain('"counterAnchors":[{"file":"charging.log","line":2}]');
    expect(verifier.calls).toHaveLength(2);
  });

  it.each(["step limit", "verification tokens"] as const)(
    "drops contradicted evidence and caps confidence at the %s", async (limit) => {
      const claims = [...supportedClaims, { id: 2, status: "contradicted" }];
      const verifier = createScriptedLogAnalysisModel([{ content: { claims },
        ...(limit === "verification tokens" ? { usage: { inputTokens: 78_900, outputTokens: 100 } } : {}) }]);
      const maxSteps = limit === "step limit" ? 2 : 4;
      const { adapter, model } = analyzer([readChargingLines, { content: mixedCandidate }], {
        maxSteps, verifier: { model: verifier, modelLabel: "verify-test" }
      });
      const output = await adapter.analyze(buildInput());
      expect(output).toMatchObject({ conclusion: finalPayload.conclusion, confidence: 0.5,
        evidence: [expect.objectContaining({ lineNumbers: [3, 4] })],
        verification: { status: "failed", checkedClaims: 3, unsupportedClaims: 1 } });
      expect(model.calls).toHaveLength(2);
    }
  );

  it.each([
    { conclusionStatus: "unsupported", revision: { ...finalPayload, conclusion: "The revision still lacks support." }, checks: 2 },
    { conclusionStatus: "contradicted", revision: "unusable revision", checks: 1 }
  ])("handles a $conclusionStatus conclusion when contradiction revision fails", async ({ conclusionStatus, revision, checks }) => {
    const verifier = createScriptedLogAnalysisModel([
      { content: { claims: [
        { id: 0, status: conclusionStatus }, { id: 1, status: "unsupported" }, { id: 2, status: "contradicted" }
      ] } },
      { content: { claims: [{ id: 0, status: "unsupported" }, supportedClaims[1]] } }
    ]);
    const { adapter, model } = analyzer([readChargingLines, { content: mixedCandidate }, { content: revision }], {
      protocol: "json", verifier: { model: verifier, modelLabel: "verify-test" }
    });
    const contradicted = conclusionStatus === "contradicted";
    expect(await adapter.analyze(buildInput())).toMatchObject({
      conclusion: contradicted ? "现有证据不足以支持结论，请人工复核。" : finalPayload.conclusion,
      impact: contradicted ? "现有证据不足以判断影响。" : finalPayload.impact,
      suggestedActions: contradicted ? ["人工复核已引用的证据。"] : finalPayload.suggestedActions,
      confidence: 0.5, evidence: [finalPayload.evidence[0]],
      verification: { status: "failed", checkedClaims: 3, unsupportedClaims: 3, model: "verify-test" }
    });
    expect(model.calls).toHaveLength(3);
    expect(verifier.calls).toHaveLength(checks);
  });

  it.each(["provider failure", "missing verdict", "duplicate verdict", "final-answer reserve"] as const)(
    "delivers the grounded report with verification skipped after %s", async (failure) => {
      const verifier = createScriptedLogAnalysisModel([failure === "provider failure" ? { error: new Error("offline") }
        : { content: { claims: failure === "duplicate verdict" ? [supportedClaims[0], supportedClaims[0]] : supportedClaims.slice(0, 1) } }]);
      const reserve = failure === "final-answer reserve";
      const { adapter } = analyzer([
        { ...readChargingLines, ...(reserve ? { usage: { inputTokens: 6370, outputTokens: 30 } } : {}) },
        { content: finalPayload, ...(reserve ? { usage: { inputTokens: 400, outputTokens: 50 } } : {}) }
      ], { tokenBudget: reserve ? 8000 : 100_000, verifier: { model: verifier, modelLabel: "verify-test" } });
      const output = await adapter.analyze(buildInput());
      expect(output).toMatchObject({ conclusion: finalPayload.conclusion, confidence: reserve ? 0.5 : 0.9,
        analysisSource: "agent", evidence: [expect.objectContaining({ lineNumbers: [3, 4] })],
        verification: { status: "skipped", checkedClaims: 0, unsupportedClaims: 0, model: "verify-test" } });
      expect(verifier.calls).toHaveLength(reserve ? 0 : 1);
    }
  );

  it.each([false, true])("preserves a supported report and defaults verification off (enabled=%s)", async (enabled) => {
    const script = [readChargingLines, { content: finalPayload }];
    const verifier = createScriptedLogAnalysisModel([{ content: { claims: supportedClaims } }]);
    const { adapter } = analyzer(script, enabled ? { verifier: { model: verifier, modelLabel: "verify-test" } } : {});
    const report = await adapter.analyze(buildInput());
    expect(report).toMatchObject({ analysisSource: "agent", conclusion: finalPayload.conclusion, confidence: 0.9,
      evidence: [expect.objectContaining({ lineNumbers: [3, 4], inference: finalPayload.evidence[0].inference })] });
    expect(report.verification).toEqual(enabled ? { status: "passed", checkedClaims: 2, unsupportedClaims: 0, model: "verify-test" } : undefined);
    expect(verifier.calls).toHaveLength(enabled ? 1 : 0);
  });

  it("checks only the bounded raw text for a cited source line after tool results fold", async () => {
    const sourceLocation = { snapshotId: "source-snapshot", path: "drivers/thermal.c", line: 7 };
    const verifier = createScriptedLogAnalysisModel([{ content: { claims: supportedClaims } }]);
    const sourceRead = { content: { action: "tool", tool: "read_source_range", args: {
      snapshotId: sourceLocation.snapshotId, path: sourceLocation.path, startLine: 7, endLine: 8
    } } };
    const { adapter } = analyzer([sourceRead, readChargingLines, readChargingLines, { content: {
      ...finalPayload, evidence: [{ ...finalPayload.evidence[0], lineNumbers: [], sourceLocation }]
    } }], {
      verifier: { model: verifier, modelLabel: "verify-test" },
      bindToolBackends: () => ({ readSourceRange: async () => ({ ...sourceLocation,
        startLine: 7, endLine: 8, totalLines: 8, truncated: false, lines: [
          { line: 7, content: "thermal_limit(); " + "x".repeat(650) + "capped-tail" },
          { line: 8, content: "unreferenced_source_line();" }
        ] }) })
    });
    const output = await adapter.analyze(buildInput({ sourceSnapshot: { id: sourceLocation.snapshotId, status: "ready" } }));
    expect(output).toMatchObject({ verification: { status: "passed" }, evidence: [expect.objectContaining({ sourceLocation })] });
    const prompt = verifier.calls.flat().map(({ content }) => content).join("\n");
    expect(prompt).toContain("thermal_limit();");
    expect(prompt).not.toMatch(/capped-tail|unreferenced_source_line|battery_temp/);
  });

  it("rejects historical hints as grounding and reports only run IDs actually returned", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([
      { content: { action: "tool", tool: "search_past_conclusions", args: { query: "thermal" } } },
      { content: finalPayload },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } } },
      { content: finalPayload }
    ], {
      protocol: "json",
      hypothesisLedger: true,
      bindToolBackends: () => ({
        searchPastConclusions: async () => ({
          retrievalMode: "fts_only",
          items: [{ runId: "confirmed-previous", createdAt: "2026-08-09T00:00:00.000Z",
            summary: "Thermal foldback", evidenceTemplates: ["Log anchors: 2"] }],
          hasMore: false
        })
      })
    });
    const output = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));
    expect(output).toMatchObject({ analysisSource: "agent", historicalRunIds: ["confirmed-previous"],
      evidence: [{ lineNumbers: [3, 4] }] });
    expect(trace.filter((step) => step.kind === "model-turn").map((step) => step.outcome)).toEqual(["ok", "error", "ok", "ok"]);
    expect(trace.find((step) => step.kind === "tool-call" && step.tool === "search_past_conclusions"))
      .toMatchObject({ outcome: "ok", lines: [] });
  });

  it.each(["json", "tools"] as const)("keeps only seen hypothesis anchors after folding in %s", async (protocol) => {
    const trace: LogAnalysisTraceStep[] = [];
    const seen = { file: "charging.log", line: 3 };
    const unseen = { file: "charging.log", line: 6 };
    const hypothesis = { id: "charger", statement: "充电器限流", status: "open", anchors: [seen, unseen] };
    const finalHypothesis = { ...hypothesis, status: "refuted", anchors: [seen] };
    const alternative = { statement: hypothesis.statement, reason: "日志记录热保护介入", anchors: [seen, { ...unseen, line: 9999 }] };
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 },
        notes: { hypotheses: [{ ...hypothesis, id: "old", anchors: [] }] } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 6, endLine: 6 }, notes: { hypotheses: [hypothesis] } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } } },
      { content: { ...finalPayload, notes: { hypotheses: [finalHypothesis] },
        alternativeHypotheses: [alternative, { ...alternative, statement: "未接地的猜测", anchors: [{ ...unseen, line: 9999 }] }] } }
    ], { protocol, hypothesisLedger: true, maxSteps: 3,
      // Small enough that the final prompt (plus its 4,096-token output reserve) must fold the first reads.
      contextTokens: protocol === "json" ? 5_900 : 7_000 });
    const output = await adapter.analyze(buildInput({ filePath: seen.file, onTrace: (step) => { trace.push(step); } }));
    expect(output).toMatchObject({ analysisSource: "agent", degradedReason: "step-budget-exhausted",
      alternativeHypotheses: [{ ...alternative, anchors: [seen] }] });
    const finalInput = model.calls.at(-1)!.map(({ content }) => content).join("\n");
    expect(finalInput).toContain("Folded tool result");
    expect(finalInput).not.toContain("thermal foldback engaged");
    expect(finalInput).toContain(JSON.stringify({ ...hypothesis, anchors: [seen] }));
    expect(finalInput).not.toContain('"id":"old"');
    expect(trace.filter(({ kind }) => kind === "model-turn").map(({ hypotheses }) => hypotheses)).toEqual([
      [{ id: "1", status: "open", anchors: [] }], [{ id: "1", status: "open", anchors: [seen] }],
      [{ id: "1", status: "open", anchors: [seen] }], [{ id: "1", status: "refuted", anchors: [seen] }]
    ]);
    expect(JSON.stringify(trace)).not.toContain(hypothesis.statement);
    expect(JSON.stringify(trace)).not.toContain(`"id":"${hypothesis.id}"`);
    expect(logTraceStepSchema.parse({ ...trace[0], hypotheses: [hypothesis] }).hypotheses)
      .toEqual([{ id: "1", status: "open", anchors: [seen, unseen] }]);
    expect(trace.every((step) => logTraceStepSchema.safeParse(step).success)).toBe(true);
  });

  it("ignores unsolicited ledger output by default", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const seen = { file: "charging.log", line: 3 };
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 },
        notes: { hypotheses: [{ id: "unsolicited", statement: "充电器限流", status: "open", anchors: [] }] } } },
      { content: { ...finalPayload, alternativeHypotheses: [{ statement: "充电器限流", reason: "热保护已触发", anchors: [seen] }] } }
    ], { protocol: "tools" });
    const output = await adapter.analyze(buildInput({ filePath: seen.file, onTrace: (step) => { trace.push(step); } }));
    expect(output).toMatchObject({ analysisSource: "agent" });
    expect(output).not.toHaveProperty("alternativeHypotheses");
    expect(trace.some((step) => Object.hasOwn(step, "hypotheses"))).toBe(false);
    expect(JSON.stringify(model.calls)).not.toContain("unsolicited");
  });

  it("bounds the injected snapshot by UTF-8 bytes and retains it when an update exceeds the entry limit", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const hypotheses = Array.from({ length: 8 }, (_, id) => ({
      id: String(id), statement: "限".repeat(240), status: "open", anchors: []
    }));
    const read = { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } };
    const { adapter, model } = analyzer([
      { content: { ...read, notes: { hypotheses } } },
      { content: { ...read, notes: { hypotheses: [...hypotheses, { ...hypotheses[0], id: "overflow" }] } } },
      { content: finalPayload }
    ], { hypothesisLedger: true });
    const output = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));
    expect(output.analysisSource).toBe("agent");
    const snapshots = trace.filter(({ kind }) => kind === "model-turn").map((step) => step.hypotheses);
    expect(snapshots).toEqual(Array.from({ length: 3 }, () => hypotheses.slice(0, 5)
      .map(({ status, anchors }, index) => ({ id: String(index + 1), status, anchors }))));
    expect(model.calls.at(-1)?.some(({ content }) => content.endsWith(JSON.stringify(hypotheses.slice(0, 5))))).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(snapshots[0]))).toBeLessThanOrEqual(4096);
  });

  it("grounds a native batch in order, folds its older results and never executes a fourth call", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const read = (line: number) => ({ id: `call-${line}`, name: "read_line_range",
      arguments: JSON.stringify({ startLine: line, endLine: line }) });
    const { adapter } = analyzer([
      { toolCalls: [read(3), read(4), read(5), read(6)] },
      { content: { ...finalPayload, evidence: [{ ...finalPayload.evidence[0], lineNumbers: [6] }] } },
      { content: finalPayload }
    ], { protocol: "tools" });

    const output = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));
    expect(output).toMatchObject({ analysisSource: "agent", evidence: [{ lineNumbers: [3, 4] }] });
    expect(trace.filter((step) => step.kind === "tool-call").map((step) => step.lines[0].line)).toEqual([3, 4, 5]);
    expect(trace.filter((step) => step.kind === "model-turn").map(({ protocol, outcome }) => [protocol, outcome]))
      .toEqual([["tools", "error"], ["tools", "error"], ["tools", "ok"]]);
  });

  it("accepts a text JSON batch within one investigation step", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([
      { content: { action: "tools", calls: [3, 4].map((line) => ({ tool: "read_line_range", args: { startLine: line, endLine: line } })) } },
      { content: finalPayload }
    ], { protocol: "json", maxSteps: 2 });
    await expect(adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } })))
      .resolves.toMatchObject({ analysisSource: "agent", confidence: 0.9, evidence: [{ lineNumbers: [3, 4] }] });
    expect(trace.filter((step) => step.kind === "model-turn").map((step) => step.protocol)).toEqual(["json", "json"]);
  });

  it("validates each native call, preserves successes beside rejections and reserves only final_report for convergence", async () => {
    const trace: LogAnalysisTraceStep[] = [];
    const toolSets: string[][] = [];
    const model = createScriptedLogAnalysisModel([
      { toolCalls: [
        { id: "malformed", name: "list_files", arguments: "{" },
        { id: "valid", name: "read_line_range", arguments: '{"startLine":3,"endLine":4}' },
        { id: "write", name: "write_parameter", arguments: "{}" }
      ] },
      { content: finalPayload }
    ]);
    const adapter = createAgentLoopLogAnalyzer({
      model: { ...model, invokeTools(messages, options) {
        toolSets.push(options.tools.map((tool) => tool.name));
        return model.invokeTools(messages, options);
      } },
      modelLabel: "native", protocol: "tools", tokenBudget: 100_000, maxSteps: 1
    });

    const output = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));
    expect(output).toMatchObject({ analysisSource: "agent", degradedReason: "step-budget-exhausted", confidence: 0.5,
      evidence: [{ lineNumbers: [3, 4] }] });
    expect(trace.filter((step) => step.kind === "tool-call").map(({ tool, outcome }) => [tool, outcome]))
      .toEqual([["list_files", "error"], ["read_line_range", "ok"], [null, "error"]]);
    expect(toolSets).toEqual([expect.arrayContaining(["read_line_range", "final_report"]), ["final_report"]]);
  });

  it("falls back on a provider capability rejection, caches by endpoint and model, and honors the platform JSON cap", async () => {
    const requests: Array<{ url: string; model: string; tools?: { function: { name: string; parameters: unknown } }[] }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const request = { url: String(url), ...JSON.parse(String(init?.body)) } as (typeof requests)[number];
      requests.push(request);
      if (request.tools) return Response.json({ error: { message: "This model does not support tools", param: "tools" } }, { status: 400 });
      const read = { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } };
      const content = requests.filter((item) => item.model === request.model && item.url === request.url && !item.tools).length % 2
        ? JSON.stringify(read) : `\`\`\`json\n${JSON.stringify(finalPayload).replace(/}$/, ",}")}\n\`\`\``;
      return Response.json({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
    });
    try {
      const env = { LOG_ANALYSIS_API_BASE_URL: "https://no-tools.example.invalid/v1", LOG_ANALYSIS_API_KEY: "fixture-key",
        LOG_ANALYSIS_API_TIMEOUT_MS: 500, LOG_ANALYSIS_TOKEN_BUDGET: 100_000, LOG_ANALYSIS_DETERMINISTIC: false,
        LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_MAX_STEPS: 2, LOG_ANALYSIS_REPAIR_JSON: true } as const;
      const trace: LogAnalysisTraceStep[] = [];
      const run = (settings = {}, logDomain?: AnalyzeLogInput["logDomain"]) => createLogAnalyzerFromEnv({ ...env, ...settings })
        .analyze(buildInput({ logDomain, onTrace: (step) => { trace.push(step); } }));
      await expect(run()).resolves.toMatchObject({ analysisSource: "agent", confidence: 0.9 });
      await expect(run()).resolves.toMatchObject({ analysisSource: "agent" });
      await expect(run({}, { name: "other model", modelOverride: "other" })).resolves.toMatchObject({ analysisSource: "agent" });
      await expect(run({ LOG_ANALYSIS_API_BASE_URL: "https://other-endpoint.example.invalid/v1" })).resolves.toMatchObject({ analysisSource: "agent" });
      await expect(run({ LOG_ANALYSIS_PROTOCOL: "json" }, { name: "forced JSON", protocolOverride: "tools" }))
        .resolves.toMatchObject({ analysisSource: "agent" });
      expect(requests.map((request) => Boolean(request.tools))).toEqual([true, false, false, false, false, true, false, false, true, false, false, false, false]);
      expect(requests[0].tools?.find((tool) => tool.function.name === "read_line_range")?.function.parameters)
        .toMatchObject({ type: "object", required: ["startLine", "endLine"] });
      expect(trace.filter((step) => step.kind === "model-turn").map((step) => step.protocol))
        .toEqual(["tools", "json", "json", "json", "json", "tools", "json", "json", "tools", "json", "json", "json", "json"]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("carries native call IDs through a folded tool response and a structured final over Chat Completions", async () => {
    const nativeCall = (id: string, name: string, args: object) => ({
      id, type: "function", function: { name, arguments: JSON.stringify(args) }
    });
    const batch = [3, 4, 5].map((line) => nativeCall(`call-${line}`, "read_line_range", { startLine: line, endLine: line }));
    const open = { id: "adapter", statement: "适配器限流", status: "open", anchors: [] };
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const definitions = request.tools as Array<{ function: { name: string; parameters: unknown } }>;
      expect(definitions.find((tool) => tool.function.name === "read_line_range")?.function.parameters)
        .toMatchObject({ properties: { notes: { properties: { hypotheses: { maxItems: 8 } } } } });
      return Response.json({ choices: [{ message: { role: "assistant", content: null, tool_calls: [
        ...batch.slice(0, 2), nativeCall("call-5", "read_line_range", { startLine: 5, endLine: 5, notes: { hypotheses: [open] } })
      ] }, finish_reason: "tool_calls" }] });
    }).mockImplementationOnce(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.messages.filter((message: { role: string }) => message.role === "tool").map((message: { tool_call_id: string }) =>
        message.tool_call_id)).toEqual(["call-3", "call-4", "call-5"]);
      expect(request.messages.find((message: { role: string }) => message.role === "assistant").tool_calls).toEqual(batch);
      expect(request.tools.find((tool: { function: { name: string } }) => tool.function.name === "final_report").function.parameters)
        .toMatchObject({ type: "object", required: expect.arrayContaining(["conclusion", "evidence"]),
          properties: { notes: expect.anything(), alternativeHypotheses: expect.anything() } });
      const { action: _action, ...final } = finalPayload;
      return Response.json({ choices: [
        { message: { role: "assistant", content: null, tool_calls: [nativeCall("call-final", "final_report", final)] }, finish_reason: "tool_calls" }
      ] });
    });
    try {
      const adapter = createLogAnalyzerFromEnv({ LOG_ANALYSIS_API_BASE_URL: "https://native-tools.example.invalid/v1", LOG_ANALYSIS_API_KEY: "fixture-key",
        LOG_ANALYSIS_API_TIMEOUT_MS: 500, LOG_ANALYSIS_TOKEN_BUDGET: 100_000, LOG_ANALYSIS_DETERMINISTIC: false,
        LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_MAX_STEPS: 2, LOG_ANALYSIS_PROTOCOL: "auto", LOG_ANALYSIS_HYPOTHESIS_LEDGER: true });
      const trace: LogAnalysisTraceStep[] = [];
      await expect(adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } })))
        .resolves.toMatchObject({ analysisSource: "agent", confidence: 0.9, evidence: [{ lineNumbers: [3, 4] }] });
      expect(trace.filter((step) => step.kind === "model-turn").map((step) => step.protocol)).toEqual(["tools", "tools"]);
      const metadata = { id: "1", status: open.status, anchors: open.anchors };
      expect(trace.filter((step) => step.kind === "model-turn").map((step) => step.hypotheses)).toEqual([[metadata], [metadata]]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("folds old tool results while keeping log and source evidence grounded", async () => {
    const sourceLocation = { snapshotId: "source", path: "power.c", line: 5 };
    const sourceExcerpt = "charger_limiter_set(thermal_cap);";
    const report = {
      ...finalPayload,
      evidence: [{ ...finalPayload.evidence[0], sourceLocation }]
    };
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } } },
      { content: { action: "tool", tool: "search_source", args: { pathGlob: "*.c", query: "thermal_cap" } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 6, endLine: 6 } } },
      { content: { ...report, evidence: [{ ...finalPayload.evidence[0], lineNumbers: [2] }] } },
      { content: report }
    ], {
      maxSteps: 6,
      // Fits the first two results verbatim; the fifth call must fold them and keep the latest two.
      contextTokens: 6_000,
      bindToolBackends: () => ({
        searchSource: async () => ({ items: Array.from({ length: 5 }, (_, index) => ({
          ...sourceLocation, line: index + 1, excerpt: sourceExcerpt, rank: 1, versionLabel: "v1"
        })), truncated: true })
      })
    });

    const output = await adapter.analyze(buildInput({ filePath: "charging.log", sourceSnapshot: { id: "source", status: "ready" } }));

    expect(output).toMatchObject({ analysisSource: "agent", confidence: 0.9, evidence: [{ lineNumbers: [3, 4], sourceLocation }] });
    expect(model.calls[5].at(-1)?.content).toContain("Grounding violation");
    expect(model.calls[4].slice(0, 2)).toEqual(model.calls[0]);
    const beforeFold = model.calls[2].map(({ content }) => content).join("\n");
    expect(beforeFold).toContain("thermal foldback engaged");
    expect(beforeFold).toContain(sourceExcerpt);
    const afterFold = model.calls[4].map(({ content }) => content).join("\n");
    expect(afterFold).not.toContain("thermal foldback engaged");
    expect(afterFold).not.toContain(sourceExcerpt);
    expect(afterFold).toContain("requested_ma=6000");
    expect(afterFold).toContain("session heartbeat ok");
    expect(afterFold).toContain('Folded tool result for read_line_range:\n{"args":{"startLine":3,"endLine":4},"count":2,"truncated":false,"anchors":[{"file":"charging.log","line":3}');
    expect(afterFold).toContain('Folded tool result for search_source:\n{"args":{"pathGlob":"*.c","query":"thermal_cap"},"count":5,"truncated":true,"anchors":[{"snapshotId":"source","path":"power.c","line":1}');
    expect(afterFold).not.toContain('"path":"power.c","line":5');
    expect(afterFold).toContain("Repeat the tool call to retrieve the original result.");
  });

  it("grounds exact source search hits and numbered range lines, rejecting unread source lines", async () => {
    const input = buildInput({ sourceSnapshot: { id: "source", status: "ready" } });
    for (const tool of ["search_source", "read_source_range"] as const) {
      for (const line of [5, 6]) {
        const final = { ...finalPayload, evidence: [{ lineNumbers: [], sourceLocation: { snapshotId: "source", path: "power.c", line },
          inference: "Power logic", suggestedAction: "Inspect power logic" }] };
        const run = analyzer([
          { content: { action: "tool", tool, args: tool === "search_source" ? { pathGlob: "*.c", query: "power" }
            : { snapshotId: "source", path: "power.c", startLine: 5, endLine: 5 } } },
          ...Array.from({ length: line === 5 ? 1 : 3 }, () => ({ content: final }))
        ], { bindToolBackends: () => ({
          searchSource: async () => ({ items: [{ snapshotId: "source", path: "power.c", line: 5, excerpt: "power();", rank: 1, versionLabel: "v1" }], truncated: false }),
          readSourceRange: async () => ({ snapshotId: "source", path: "power.c", startLine: 5, endLine: 5, totalLines: 10,
            truncated: false, lines: [{ line: 5, content: "power();" }] })
        }) });
        const output = await run.adapter.analyze(input);
        expect(output.analysisSource).toBe(line === 5 ? "agent" : "rules-fallback");
        if (line === 5) expect(output.evidence).toMatchObject([{ sourceLocation: { snapshotId: "source", path: "power.c", line: 5 } }]);
      }
    }
  });

  it("shows only inventory-matched relative file arguments and keeps free text private", async () => {
    const filePath = `bundle/${"long-directory/".repeat(10)}charging.log`;
    const secret = "PRIVATE_PROCEDURE: never persist this text";
    const input = buildInput({ filePath });
    expect(summarizeTraceArguments({ file: filePath, query: secret, question: secret, pattern: "thermal", startLine: 1 }, input))
      .toEqual({ file: filePath.slice(0, 120), query: "[redacted]", pattern: "[redacted]", startLine: 1 });
    const files: NonNullable<AnalyzeLogInput["files"]> = [{ path: filePath, sizeBytes: 100, lineCount: 6,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null, parsed: input.parsed }];
    expect(summarizeTraceArguments({ file: filePath, pattern: secret.repeat(10) }, { files }))
      .toEqual({ file: filePath.slice(0, 120), pattern: "[redacted]" });
    for (const file of [secret, "unknown.log"])
      expect(summarizeTraceArguments({ file }, input)).toEqual({ file: "[redacted]" });
    for (const file of ["../charging.log", "/tmp/charging.log", "C:/charging.log", "bundle\\charging.log", "a/../charging.log", "bad\ncharging.log"])
      expect(summarizeTraceArguments({ file }, buildInput({ filePath: file }))).toEqual({ file: "[redacted]" });
    expect(summarizeTraceArguments({ file: filePath })).toEqual({ file: "[redacted]" });
    const steps: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { file: filePath, startLine: 2, endLine: 5 } } },
      { content: finalPayload }
    ]);
    await adapter.analyze({ ...input, onTrace: (step) => { steps.push(logTraceStepSchema.parse(step)); } });
    expect(steps.find((step) => step.kind === "tool-call")?.arguments.file).toBe(filePath.slice(0, 120));
  });

  it("bounds serialized long-path references without shortening the file identity", async () => {
    const filePath = "界".repeat(1024);
    const parsed = parseLogText({ fileName: "charging.log", content: Array.from({ length: 60 }, () => chargingLog).join("\n") });
    if (!parsed.ok) throw new Error("fixture must parse");
    const steps: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 40 } } },
      { content: finalPayload }
    ]);
    await adapter.analyze({ parsed, filePath, onTrace: (step) => { steps.push(logTraceStepSchema.parse(step)); } });
    const tool = steps.find((step) => step.kind === "tool-call")!;
    expect(tool).toMatchObject({ outcome: "truncated", reason: "trace-line-cap" });
    expect(tool.lines.length).toBeGreaterThan(0);
    expect(tool.lines.length).toBeLessThanOrEqual(50);
    expect(tool.lines.every((line) => line.file === filePath)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(tool))).toBeLessThan(131072);
  });

  it("records pinned source references without persisting the returned excerpt", async () => {
    const steps: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([
      { content: { action: "tool", tool: "locate_log_statement", args: { line: "thermal" } } },
      { content: { ...finalPayload, evidence: [{ lineNumbers: [], sourceLocation: { snapshotId: "source-v1", path: "thermal.c", line: 4 },
        inference: "Thermal source statement", suggestedAction: "Inspect cooling" }] } }
    ], { bindToolBackends: () => ({ locateLogStatement: async () => ({ truncated: false, items: [{ snapshotId: "source-v1", path: "thermal.c", line: 4,
      startLine: 3, excerpt: "PRIVATE_SOURCE_BEFORE\nPRIVATE_SOURCE_STATEMENT\nPRIVATE_SOURCE_AFTER", versionLabel: "v1", confidence: 1 }] }) }) });
    await adapter.analyze(buildInput({ sourceSnapshot: { id: "source-v1", status: "ready" }, onTrace: (step) => { steps.push(logTraceStepSchema.parse(step)); } }));
    expect(steps[1].lines).toEqual([
      { file: "thermal.c", line: 4, snapshotId: "source-v1" },
      { file: "thermal.c", line: 3, snapshotId: "source-v1" },
      { file: "thermal.c", line: 5, snapshotId: "source-v1" }
    ]);
    expect(JSON.stringify(steps)).not.toContain("PRIVATE_SOURCE");
  });

  it("caps ordered trace steps while retaining provider-reported token counts", async () => {
    const steps: LogAnalysisTraceStep[] = [];
    const { adapter } = analyzer([
      ...Array.from({ length: 110 }, () => ({ content: { action: "tool", tool: "get_prefilter_findings", args: {} },
        usage: { inputTokens: 20, outputTokens: 5 } })),
      { content: finalPayload }
    ], { maxSteps: 110 });
    const output = await adapter.analyze(buildInput({ filePath: "charging.log", onTrace: (step) => { steps.push(step); } }));
    expect(output.analysisSource).toBe("agent");
    expect(steps).toHaveLength(200);
    expect(steps.map((step) => step.index)).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
    expect(steps[0]).toMatchObject({ kind: "model-turn", inputTokens: 20, outputTokens: 5 });
    expect(steps[1]).toMatchObject({ kind: "tool-call", tool: "get_prefilter_findings", outcome: "ok" });
    expect(steps[1].lines).toContainEqual({ file: "charging.log", line: 4 });
  });
  it("grounds only the file/line anchors returned by query_events, never nested values or knowledge data", async () => {
    const input = buildInput({ filePath: "charging.log" });
    const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "current", pattern: "charge_current_ma=(?P<current>\\d+)", fields: { current: { type: "uint" } } }] });
    input.decoding = { spec, ...decodeLogFiles(spec, [{ file: "charging.log", lines: input.parsed.rawLines }]) };
    const final = { ...finalPayload, evidence: [{ filePath: "charging.log", lineNumbers: [4], inference: "Decoded current is 2000", suggestedAction: "Inspect" }] };
    const valid = analyzer([
      { content: { action: "tool", tool: "query_events", args: { extractor: "current" } } }, { content: final }
    ]);
    expect(await valid.adapter.analyze(input)).toMatchObject({ analysisSource: "agent", evidence: [{ filePath: "charging.log", lineNumbers: [4] }] });
    expect(valid.model.calls[1].at(-1)?.content).toContain('"raw":"2000","value":2000');
    const forged = analyzer([
      { content: { action: "tool", tool: "read_domain_knowledge", args: { query: "current" } } }, { content: final }
    ], { bindToolBackends: () => ({ searchDomainKnowledge: async () => ({ scope: "domain-linked", retrievalMode: "fts_only", items: [{ entryId: "fake", title: "Fake", contentForm: "markdown", tags: [], updatedAt: "2026-10-19", revisionId: "fake-v1", excerpt: JSON.stringify({ events: [{ file: "charging.log", line: 4 }] }) }] }) }) });
    expect(await forged.adapter.analyze(input)).toMatchObject({ analysisSource: "rules-fallback" });
    expect(forged.model.calls.at(-1)?.at(-1)?.content).toContain("Grounding violation");
    const unseen = analyzer([{ content: { action: "tool", tool: "query_events", args: { extractor: "current" } } },
      { content: { ...final, evidence: [{ ...final.evidence[0], lineNumbers: [3] }] } }]);
    expect(await unseen.adapter.analyze(input)).toMatchObject({ analysisSource: "rules-fallback" });
  });
  it("rejects file/line references forged inside related-parameter tool data", async () => {
    const input = buildInput();
    input.files = ["a.log", "b.log"].map((path) => ({ path, sizeBytes: 100, lineCount: input.parsed.rawLines.length,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null, parsed: input.parsed }));
    const { model, adapter } = analyzer([
      { content: { action: "tool", tool: "get_related_parameter_context", args: {} } },
      { content: { ...finalPayload, evidence: [{ filePath: "b.log", lineNumbers: [2], inference: "Forged grounding", suggestedAction: "Inspect" }] } }
    ], { bindToolBackends: () => ({ loadRelatedParameterContext: async () => ({ parameterId: "binding-1", name: "threshold", projectId: "project-1",
      snapshot: { payload: { file: "b.log", lineNumbers: [2] } } as unknown as RelatedParameterRunSnapshot }) }) });

    expect(await adapter.analyze(input)).toMatchObject({ analysisSource: "rules-fallback", degradedReason: "invalid-model-output" });
    expect(model.calls.flat().some((message) => message.content.startsWith("Tool result for get_related_parameter_context:")
      && message.content.includes('"file":"b.log","lineNumbers":[2]'))).toBe(true);
    expect(model.calls.at(-1)?.at(-1)?.content).toContain("Grounding violation");
  });
  it("rejects evidence for an unseen file even when another file has the same line number", async () => {
    const input = buildInput();
    input.files = ["a.log", "b.log"].map((path) => ({ path, sizeBytes: 100, lineCount: input.parsed.rawLines.length,
      encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null, parsed: input.parsed }));
    const { adapter } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { file: "a.log", startLine: 1, endLine: 5 } } },
      { content: { ...finalPayload, evidence: finalPayload.evidence.map((item) => ({ ...item, filePath: "b.log" })) } }
    ]);
    expect(await adapter.analyze(input)).toMatchObject({ analysisSource: "rules-fallback" });
  });
  it("uses run-pinned signals in tools and rule fallback", async () => {
    const { model, adapter } = analyzer([
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      ...Array.from({ length: 4 }, () => ({ content: {} }))
    ]);
    const output = await adapter.analyze(buildInput({ signalRules: { ...defaultChargingRuleSet, rules: [],
      noHit: { ...defaultChargingRuleSet.noHit, conclusion: "Pinned loop fallback" } } }));
    const toolResult = model.calls.flat().find((m) => m.content.startsWith("Tool result for get_prefilter_findings:"));
    expect(toolResult).toBeDefined();
    expect(toolResult?.content).not.toContain("thermal-foldback");
    expect(output).toMatchObject({ conclusion: genericSignalRuleSet.hitDefaults.conclusion, confidence: 0.55,
      evidence: [{ ruleHit: "generic:first-error", lineNumbers: [4] }], analysisSource: "rules-fallback" });
    expect(output.evidence.some((item) => item.ruleHit === "thermal-foldback")).toBe(false);
  });

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
    expect(model.calls[0].find((message) => message.role === "system")?.content).toContain(
      `prompt version ${LOG_ANALYSIS_LOOP_PROMPT_VERSION}`
    );
    // The kernel fed both tool results back into the conversation.
    const lastMessages = model.calls[2];
    expect(lastMessages.some((message) => message.content.startsWith("Tool result for get_prefilter_findings:"))).toBe(true);
    expect(lastMessages.some((message) => message.content.startsWith("Tool result for read_line_range:"))).toBe(true);
  });

  it("uses the recorded prompt version when analyzing a frozen related parameter", async () => {
    const { model, adapter } = analyzer([
      { content: { action: "tool", tool: "get_prefilter_findings", args: {} } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 2, endLine: 5 } } },
      { content: finalPayload }
    ]);
    const relatedParameterSnapshot = {
      schemaVersion: 1,
      propertyKey: "threshold",
      pin: { kind: "canonical-pin", bindingId: "binding-1", payload: { kind: "number", value: 5 } },
      revision: {},
      sourcePin: {}
    } as unknown as RelatedParameterRunSnapshot;

    const output = await adapter.analyze(buildInput({ relatedParameterId: "binding-1", relatedParameterSnapshot }));

    expect(output.promptVersion).toBe(LOG_ANALYSIS_LOOP_PARAMETER_PROMPT_VERSION);
    expect(model.calls[0].find((message) => message.role === "system")?.content).toContain(
      `prompt version ${LOG_ANALYSIS_LOOP_PARAMETER_PROMPT_VERSION}`
    );
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
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 5 } } },
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
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 5 } } },
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
    expect(output.degradedReason).toBe("invalid-model-output");
    expect(output.promptVersion).toBe(LOG_ANALYSIS_LOOP_PROMPT_VERSION);
    expect(degradations).toEqual([{ reason: "invalid-model-output", model: "loop-test" }]);
  });

  it("corrects non-JSON output and degrades when it never recovers", async () => {
    const { adapter } = analyzer([
      { content: "I think the problem is thermal." },
      { content: "Sorry, let me explain in prose again." },
      { content: "Still prose." }
    ]);

    const output = await adapter.analyze(buildInput());
    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("invalid-model-output");
  });

  it("accepts repaired tool calls and finals without adding to the invalid streak", async () => {
    const conclusion = 'Observed the literal value "limit,}" at C:\\logs.';
    const { adapter, model } = analyzer([
      { content: "Still thinking." },
      { content: '{"action":"tool"' },
      { content: 'Read the relevant lines:\n```json\n{"action":"tool","tool":"read_line_range","args":{"startLine":3,"endLine":4,},}\n```' },
      { content: "Still thinking." },
      { content: '{"action":"final"' },
      { content: `Summary: ${JSON.stringify({ ...finalPayload, conclusion }).slice(0, -1)},} Done.` }
    ], { maxSteps: 6, repairJsonOutput: true });
    const trace: LogAnalysisTraceStep[] = [];

    expect(await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } })))
      .toMatchObject({ analysisSource: "agent", conclusion, evidence: [{ lineNumbers: [3, 4] }] });
    expect(model.calls).toHaveLength(6);
    expect(trace.filter((step) => step.kind === "model-turn").map((step) => step.reason))
      .toEqual(["invalid-output", "invalid-output", null, "invalid-output", "invalid-output", null]);
    expect(trace.some((step) => step.kind === "degradation")).toBe(false);
  });

  it("counts broken JSON, invalid repaired arguments, and repaired unseen evidence as violations", async () => {
    const { adapter, model } = analyzer([
      { content: '{"wrapper":{"action":"tool","tool":"read_line_range","args":{"startLine":3,"endLine":4}}' },
      { content: 'Tool: {"action":"tool","tool":"read_line_range","args":{"startLine":"3","endLine":4,},}' },
      { content: `Report: ${JSON.stringify(finalPayload).slice(0, -1)},}` }
    ], { repairJsonOutput: true });
    const trace: LogAnalysisTraceStep[] = [];

    expect(await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } })))
      .toMatchObject({ analysisSource: "rules-fallback", degradedReason: "invalid-model-output" });
    expect(model.calls).toHaveLength(3);
    expect(trace.filter((step) => step.kind === "tool-call"))
      .toEqual([expect.objectContaining({ tool: "read_line_range", reason: "tool-rejected" })]);
  });

  it("counts an ungrounded final toward the third consecutive invalid output", async () => {
    const { model, adapter } = analyzer([
      { content: "Not JSON" },
      { content: { action: "tool", tool: "nonexistent_tool", args: {} } },
      { content: { ...finalPayload, evidence: [{ ...finalPayload.evidence[0], lineNumbers: [999] }] } }
    ], { maxSteps: 3 });
    const trace: LogAnalysisTraceStep[] = [];

    expect(await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } })))
      .toMatchObject({ analysisSource: "rules-fallback", degradedReason: "invalid-model-output" });
    expect(model.calls).toHaveLength(3);
    expect(trace).toContainEqual(expect.objectContaining({ kind: "degradation", reason: "invalid-model-output" }));
  });

  it("rejects an ungrounded final, lets the model correct, and prunes fabricated lines", async () => {
    const { model, adapter } = analyzer([
      {
        content: {
          ...finalPayload,
          evidence: [{ lineNumbers: [999], inference: "Fabricated.", suggestedAction: "None." }]
        }
      },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 5 } } },
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

    const trace: LogAnalysisTraceStep[] = [];
    const output = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));

    expect(output.analysisSource).toBe("agent");
    expect(output.degradedReason).toBe("step-budget-exhausted");
    expect(output.confidence).toBeLessThanOrEqual(0.5);
    expect(output.evidence.length).toBeGreaterThan(0);
    expect(trace).toContainEqual(expect.objectContaining({ kind: "early-convergence", reason: "step-budget-exhausted" }));
  });

  it("keeps earlier tool results verbatim while the prompt fits the context window", async () => {
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 6, endLine: 6 } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 1 } } },
      { content: finalPayload }
    ], { maxSteps: 6, contextTokens: 128_000 });

    const output = await adapter.analyze(buildInput());

    expect(output).toMatchObject({ analysisSource: "agent", confidence: 0.9 });
    const finalInput = model.calls.at(-1)!.map(({ content }) => content).join("\n");
    expect(finalInput).toContain("thermal foldback engaged");
    expect(finalInput).not.toContain("Folded tool result");
  });

  it("folds the oldest tool results so every prompt fits a small context window", async () => {
    const contextTokens = 2_600;
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 12 } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 12 } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 1, endLine: 12 } } },
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } } },
      { content: finalPayload }
    ], { maxSteps: 6, contextTokens });

    const output = await adapter.analyze(buildInput());

    expect(output).toMatchObject({ analysisSource: "agent", evidence: [{ lineNumbers: [3, 4] }] });
    expect(model.calls.at(-1)!.map(({ content }) => content).join("\n")).toContain("Folded tool result for read_line_range");
    for (const call of model.calls) expect(estimateLogPromptTokens(call)).toBeLessThanOrEqual(contextTokens);
  });

  it("keeps a grounded final report whose reported usage overshoots the budget", async () => {
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } },
        usage: { inputTokens: 6250, outputTokens: 150 } },
      { content: finalPayload, usage: { inputTokens: 1600, outputTokens: 400 } }
    ], { tokenBudget: 8000 });

    const output = await adapter.analyze(buildInput());

    expect(output).toMatchObject({ analysisSource: "agent", degradedReason: "token-budget-exhausted", confidence: 0.5,
      evidence: [{ lineNumbers: [3, 4] }] });
    expect(model.calls).toHaveLength(2);
  });

  it("uses the remaining token budget for a grounded final report after investigation uses 80%", async () => {
    const { adapter, model } = analyzer([
      { content: { action: "tool", tool: "read_line_range", args: { startLine: 3, endLine: 4 } },
        usage: { inputTokens: 6250, outputTokens: 150 } },
      { content: finalPayload, usage: { inputTokens: 1450, outputTokens: 150 } }
    ], { tokenBudget: 8000 });
    const trace: LogAnalysisTraceStep[] = [];

    const output = await adapter.analyze(buildInput({ onTrace: (step) => { trace.push(step); } }));

    expect(output).toMatchObject({ analysisSource: "agent", degradedReason: "token-budget-exhausted", confidence: 0.5,
      evidence: [{ lineNumbers: [3, 4] }] });
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1].at(-1)?.content).toContain("Do not call any more tools.");
    expect(trace.map(({ kind }) => kind)).toEqual(["model-turn", "tool-call", "early-convergence", "model-turn"]);
    expect(trace[2].reason).toBe("token-budget-exhausted");
  });

  it.each([
    { action: "tool", tool: "get_prefilter_findings", args: {} },
    { action: "tool", tool: "unknown", args: {} },
    "invalid JSON",
    finalPayload
  ])("makes no further call after reported usage exhausts the budget (%j)", async (content) => {
    const tokenBudget = 4096;
    const usage = { inputTokens: 4059, outputTokens: 37 };
    const { model, adapter } = analyzer(
      [
        { content, usage },
        { content: { ...finalPayload, confidence: 0.9 } }
      ],
      { maxSteps: 6, tokenBudget }
    );

    const output = await adapter.analyze(buildInput());

    expect(model.calls).toHaveLength(1);
    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("token-budget-exhausted");
    expect(output.confidence).toBe((await createRuleBasedLogAnalyzer().analyze(buildInput())).confidence);
  });

  it("charges estimated usage when a provider omits usage and stops further investigation", async () => {
    const tool = { action: "tool", tool: "get_prefilter_findings", args: {} };
    const { model, adapter } = analyzer([
      { content: tool },
      { content: tool, usage: { inputTokens: 2500, outputTokens: 37 } },
      { content: tool, usage: { inputTokens: 1500, outputTokens: 59 } },
      { content: finalPayload }
    ], { maxSteps: 4, tokenBudget: 7000 });
    expect(await adapter.analyze(buildInput())).toMatchObject({ analysisSource: "rules-fallback", degradedReason: "token-budget-exhausted" });
    expect(model.calls).toHaveLength(3);
    expect(model.calls.at(-1)?.at(-1)?.content).toContain("Do not call any more tools.");
  });

  it("falls back to rules when even the convergence attempt stays ungrounded", async () => {
    const toolStep: ScriptedModelResponse = { content: { action: "tool", tool: "get_prefilter_findings", args: {} } };
    const { adapter } = analyzer(
      [toolStep, { content: "no json at the end" }],
      { maxSteps: 1 }
    );

    const output = await adapter.analyze(buildInput());
    expect(output.analysisSource).toBe("rules-fallback");
    expect(output.degradedReason).toBe("step-budget-exhausted");
  });

  it("propagates provider failures for the worker retry chain", async () => {
    const { adapter } = analyzer([{ error: new LogAnalysisProviderError("boom", { modelLabel: "loop-test" }) }]);
    await expect(adapter.analyze(buildInput())).rejects.toBeInstanceOf(LogAnalysisProviderError);
  });

  it("retains provider diagnostic details when wrapping an untyped failure", async () => {
    const { adapter } = analyzer([{ error: new Error("HTTP 503 Service Unavailable: request=req-17") }]);
    await expect(adapter.analyze(buildInput())).rejects.toMatchObject({
      name: "LogAnalysisProviderError",
      message: "日志分析服务调用失败：HTTP 503 Service Unavailable: request=req-17",
      modelLabel: "loop-test"
    });
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
    expect(output.conclusion).toContain("过热保护降额");
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
