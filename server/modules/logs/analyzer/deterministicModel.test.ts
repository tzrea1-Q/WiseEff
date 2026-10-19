import { describe, expect, it } from "vitest";

import type { AnalyzeLogInput } from "../analyzer";
import { defaultChargingRuleSet } from "../chargingSignalRules";
import { extractLogSignals } from "../genericSignals";
import { parseLogText } from "../parser";
import { createAgentLoopLogAnalyzer } from "./agentLoop";
import { createDeterministicLogAnalysisLoopModel, createDeterministicLogAnalysisModel } from "./deterministicModel";
import { createLlmLogAnalyzer } from "./llmAnalyzer";

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
    expect(input.signalSummary?.signals.some((signal) => signal.kind === "crash")).toBe(true);
    const report = await analyzer().analyze(input);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82, severity: "Warning" });
    expect(report.conclusion).toMatch(/thermal foldback/i);
    expect(report.evidence.every((item) => item.filePath === "charging.log")).toBe(true);
    expect(report.evidence.flatMap((item) => item.lineNumbers)).toContain(7);
  });

  it.each([false, true])("selects and cites the charging file regardless of generic-file-first=%s", async (genericFirst) => {
    const generic = { path: "generic.log", content: genericLog }, charging = { path: "charging.log", content: chargingLog };
    const input = inputFor(genericFirst ? [generic, charging] : [charging, generic]);
    const report = await analyzer().analyze(input);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82, severity: "Warning" });
    expect(report.conclusion).toMatch(/thermal foldback/i);
    expect(report.evidence.every((item) => item.filePath === "charging.log")).toBe(true);
    expect(report.evidence.flatMap((item) => item.lineNumbers)).toContain(3);
  });

  it("keeps rule priority when a weaker hit appears first in another file", async () => {
    const input = inputFor([{ path: "communication.log", content: "ERROR communication timeout code=E_COMM_TIMEOUT" },
      { path: "charging.log", content: chargingLog }]);
    const report = await analyzer().analyze(input);
    expect(report).toMatchObject({ analysisSource: "agent", confidence: 0.82 });
    expect(report.conclusion).toMatch(/thermal foldback/i);
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
  expect(report.conclusion).not.toMatch(/thermal foldback/i);
  expect(report.evidence).toMatchObject([{ filePath: "generic.log", lineNumbers: [3] }]);
});
