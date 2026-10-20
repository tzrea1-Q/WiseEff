import { describe, expect, it, vi } from "vitest";

import type { AnalyzeLogInput } from "../analyzer";
import { defaultChargingRuleSet } from "../chargingSignalRules";
import { extractLogSignals } from "../genericSignals";
import { parseLogText } from "../parser";
import { createAgentLoopLogAnalyzer } from "./agentLoop";
import { createDeterministicLogAnalysisLoopModel, createDeterministicLogAnalysisModel } from "./deterministicModel";
import { createLlmLogAnalyzer, type LogAnalysisChatMessage } from "./llmAnalyzer";

const chargingLog = [
  "2026-10-19T00:00:01Z INFO charge session started requested_ma=6000",
  "2026-10-19T00:00:02Z INFO battery_temp=38C pack ok",
  "2026-10-19T00:00:03Z WARN thermal foldback engaged battery_temp=52C",
  "2026-10-19T00:00:04Z ERROR charge current reduced code=E_THERMAL_FOLDBACK requested_ma=6000 charge_current_ma=2000"
].join("\n");
const genericLog = "INFO kernel panic\nINFO heartbeat\nINFO unrelated activity\nINFO idle";

function inputFor(files: Array<{ path: string; content: string }>): AnalyzeLogInput {
  const parsedFiles = files.map(({ path, content }) => {
    const parsed = parseLogText({ fileName: path, content });
    if (!parsed.ok) throw new Error("Fixture must parse");
    return { path, parsed, sizeBytes: Buffer.byteLength(content), lineCount: parsed.rawLines.length,
      encoding: "utf-8" as const, lossy: false, status: "analyzed" as const, skipReason: null };
  });
  return { files: parsedFiles, parsed: { ok: true, rawLines: parsedFiles.flatMap((file) => file.parsed.rawLines),
    entries: parsedFiles.flatMap((file) => file.parsed.entries) }, signalRules: defaultChargingRuleSet,
    signalSummary: extractLogSignals(parsedFiles, defaultChargingRuleSet) };
}

describe.each(["single-shot", "loop"] as const)("deterministic %s skill findings", (kernel) => {
  const analyzer = () => kernel === "loop" ? createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(),
    modelLabel: "deterministic", tokenBudget: 100_000, maxSteps: 6 })
    : createLlmLogAnalyzer({ model: createDeterministicLogAnalysisModel(), modelLabel: "deterministic", tokenBudget: 100_000 });

  it("keeps pinned thermal findings as the conclusion when the same file also has a generic crash", async () => {
    const input = inputFor([{ path: "charging.log", content: `${genericLog}\n${chargingLog}` }]);
    input.analysisQuestion = "Why did charging slow down?";
    expect(input.signalSummary?.signals.some((signal) => signal.kind === "crash")).toBe(true);
    const report = await analyzer().analyze(input);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82, severity: "Warning" });
    expect(report.conclusion).toMatch(/过热保护降额/);
    expect(report.conclusion).toContain("针对问题“Why did charging slow down?”");
    expect(report.conclusion).not.toContain("Regarding the question");
    expect(report.evidence[0].inference).toContain("thermal-foldback");
    expect(report.evidence.every((item) => item.filePath === "charging.log")).toBe(true);
    expect(report.evidence.flatMap((item) => item.lineNumbers)).toContain(7);
  });

  it.each([false, true])("selects and cites the charging file regardless of generic-file-first=%s", async (genericFirst) => {
    const generic = { path: "generic.log", content: genericLog }, charging = { path: "charging.log", content: chargingLog };
    const input = inputFor(genericFirst ? [generic, charging] : [charging, generic]);
    const report = await analyzer().analyze(input);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82, severity: "Warning" });
    expect(report.conclusion).toMatch(/过热保护降额/);
    expect(report.evidence.every((item) => item.filePath === "charging.log")).toBe(true);
    expect(report.evidence.flatMap((item) => item.lineNumbers)).toContain(3);
  });

  it("keeps rule priority when a weaker hit appears first in another file", async () => {
    const input = inputFor([{ path: "communication.log", content: "ERROR communication timeout code=E_COMM_TIMEOUT" },
      { path: "charging.log", content: chargingLog }]);
    const report = await analyzer().analyze(input);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82 });
    expect(report.conclusion).toMatch(/过热保护降额/);
    expect(report.evidence.every((item) => item.filePath === "charging.log")).toBe(true);
  });
});

it("does not ground a single-shot skill hit using another file's identical line number", async () => {
  const response = await createDeterministicLogAnalysisModel().invoke([{ role: "user", content: [
    'File "generic.log":', "Deterministic prefilter findings:", "- no rule hits",
    'File "charging.log":', "Deterministic prefilter findings:", "- thermal-foldback: lines 3 (Thermal foldback)",
    "Log excerpt (only these lines may be cited):", '"generic.log":L3: INFO ordinary activity', '"charging.log":L1: INFO session start'
  ].join("\n") }]);
  const report = JSON.parse(response.content);
  expect(report.conclusion).not.toMatch(/过热保护降额/);
  expect(report.evidence).toMatchObject([{ filePath: "generic.log", lineNumbers: [3] }]);
});

describe("deterministic loop source citations", () => {
  const sourceLocation = { snapshotId: "thermal-source", path: "src/thermal.c", line: 4 };
  const sourceMatch = { ...sourceLocation, versionLabel: "v7", excerpt: "thermal warning", startLine: 1, confidence: 0.9 };

  it.each([true, false])("locates the top cited log line once and cites only a returned match (match=%s)", async (match) => {
    const locateLogStatement = vi.fn(async () => ({ items: match ? [sourceMatch] : [], truncated: false }));
    const input = { ...inputFor([{ path: "charging.log", content: chargingLog }]),
      sourceSnapshot: { id: "thermal-source", status: "ready" as const } };
    const report = await createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(), modelLabel: "deterministic",
      tokenBudget: 100_000, maxSteps: 6, bindToolBackends: () => ({ locateLogStatement }) }).analyze(input);
    expect(locateLogStatement).toHaveBeenCalledExactlyOnceWith(chargingLog.split("\n")[report.evidence[0].lineNumbers[0] - 1], 1);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82 });
    expect(report.evidence[0].lineNumbers).toContain(3);
    expect(report.evidence[0].sourceLocation).toEqual(match ? sourceLocation : undefined);
  });

  it.each(["indexing", "failed"] as const)("preserves the log-only report with a %s snapshot", async (status) => {
    const locateLogStatement = vi.fn(async () => ({ items: [sourceMatch], truncated: false }));
    const input = inputFor([{ path: "charging.log", content: chargingLog }]);
    const analyzer = createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(), modelLabel: "deterministic",
      tokenBudget: 100_000, maxSteps: 6, bindToolBackends: () => ({ locateLogStatement }) });
    const baseline = await analyzer.analyze(input);
    expect(await analyzer.analyze({ ...input, sourceSnapshot: { id: "thermal-source", status } })).toEqual(baseline);
    expect(locateLogStatement).not.toHaveBeenCalled();
  });

  it("converges without source lookup after its tool budget is exhausted", async () => {
    const locateLogStatement = vi.fn(async () => ({ items: [sourceMatch], truncated: false }));
    const report = await createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(), modelLabel: "deterministic",
      tokenBudget: 100_000, maxSteps: 2, bindToolBackends: () => ({ locateLogStatement }) }).analyze({
      ...inputFor([{ path: "charging.log", content: chargingLog }]), sourceSnapshot: { id: "thermal-source", status: "ready" }
    });
    expect(report).toMatchObject({ analysisSource: "agent", degradedReason: "token-budget-exhausted" });
    expect(report.evidence[0].sourceLocation).toBeUndefined();
    expect(locateLogStatement).not.toHaveBeenCalled();
  });

  it("does not retry a rejected source lookup", async () => {
    const messages: LogAnalysisChatMessage[] = [
      { role: "system", content: "Available tools:\n- locate_log_statement: Locate source" },
      { role: "user", content: `Tool result for get_prefilter_findings:\n${JSON.stringify({ anomalyLineNumbers: [1] })}` },
      { role: "user", content: `Tool result for read_line_range:\n${JSON.stringify({ lines: [{ lineNumber: 1, content: "ordinary" }] })}` }
    ];
    const model = createDeterministicLogAnalysisLoopModel();
    const response = await model.invoke(messages);
    expect(JSON.parse(response.content)).toMatchObject({ action: "tool", tool: "locate_log_statement", args: { line: "ordinary", limit: 1 } });
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: "Tool call rejected: unavailable" });
    const report = JSON.parse((await model.invoke(messages)).content);
    expect(report.action).toBe("final");
    expect(report.evidence[0].sourceLocation).toBeUndefined();
  });
});
