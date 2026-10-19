import { describe, expect, it, vi } from "vitest";

import { defaultChargingRuleSet } from "./chargingSignalRules";
import { extractLogSignals, extractLogSignalsCooperatively, LOG_SIGNAL_LIMITS, logSignalLimits, normalizeLogTemplate } from "./genericSignals";
import { parseLogText } from "./parser";

function file(path: string, content: string) {
  const parsed = parseLogText({ fileName: path, content });
  if (!parsed.ok) throw new Error("Fixture must parse");
  return { path, parsed };
}

describe("generic log signals", () => {
  it.each([["kernel panic", "Kernel panic"], ["Oops", "Oops"], ["BUG: invalid address", "BUG:"], ["watchdog", "watchdog"],
    ["ANR", "ANR"], ["FATAL EXCEPTION", "FATAL EXCEPTION"], ["segfault", "segfault"], ["assert", "assert"], ["assertion failed", "assert"]])("anchors crash signature %s without a skill", (signature, name) => {
    expect(extractLogSignals([file("a.log", `INFO start\n${signature}`)]).signals).toContainEqual({
      kind: "crash", source: "generic", severity: "Critical", title: `Crash signature: ${name}`, signature: name, count: 1,
      anchors: [{ file: "a.log", line: 2, content: signature }]
    });
  });

  it("retains separate crash rows for each signature within one file", () => {
    expect(extractLogSignals([file("kernel.log", "Oops\nKernel panic\nOops")]).signals).toMatchObject([
      { kind: "crash", signature: "Oops", count: 2, anchors: [{ line: 1 }, { line: 3 }] },
      { kind: "crash", signature: "Kernel panic", count: 1, anchors: [{ line: 2 }] }
    ]);
  });

  it("detects kernel error-word bursts using boot-relative seconds without a skill", () => {
    const content = Array.from({ length: 8 }, (_, i) => `[ ${12 + i * 0.05}] usb 1-1: error -71 while reading descriptor`).join("\n");
    const { signals } = extractLogSignals([file("kernel.log", content)]);
    const burst = signals.find((signal) => signal.kind === "error-burst")!;
    expect(burst.count).toBe(8);
    expect(burst.anchors.map((anchor) => [anchor.file, anchor.line])).toEqual([1, 2, 3, 4, 5].map((line) => ["kernel.log", line]));
    expect(extractLogSignals([file("kernel.log", content.split("\n").slice(0, 4).join("\n"))]).signals.some((signal) => signal.kind === "error-burst")).toBe(false);
    expect(signals.find((signal) => signal.kind === "first-error")).toMatchObject({ anchors: [{ line: 1 }] });
    expect(extractLogSignals([file("kernel.log", content.replaceAll("error", "retry"))]).signals).toEqual([]);
  });

  it("does not combine boot clocks with absolute timestamps or other files in a burst", () => {
    const content = "[ 12.0] ERROR one\n[ 12.1] ERROR two\n[ 12.2] ERROR three\n2026-10-19T00:00:00Z ERROR four\n2026-10-19T00:00:01Z ERROR five";
    const { signals } = extractLogSignals([file("kernel.log", content), file("other.log", "[ 12.3] ERROR other")]);
    expect(signals.some((signal) => signal.kind === "error-burst" || signal.kind === "timestamp-gap" || signal.kind === "restart")).toBe(false);
  });

  it("detects timestamp gaps, resets and boot markers with both sides of the interval", () => {
    const { signals } = extractLogSignals([file("a.log", ["2026-10-19T00:00:00Z INFO start",
      "2026-10-19T00:01:00Z INFO idle", "2026-10-19T00:00:00Z INFO reset", "Linux version 6.1"].join("\n"))]);
    expect(signals.find((signal) => signal.kind === "timestamp-gap")).toMatchObject({ count: 1, anchors: [{ line: 1 }, { line: 2 }] });
    expect(signals.find((signal) => signal.kind === "restart")).toMatchObject({ count: 2, anchors: [{ line: 2 }, { line: 3 }, { line: 4 }] });
  });

  it("counts distinct burst errors, ignores invalid timestamps, and retains first error separately per file", () => {
    const content = Array.from({ length: 8 }, (_, i) => `2026-10-19T00:00:0${i}Z ERROR failure ${i}`).join("\n");
    const { signals } = extractLogSignals([file("a.log", content), file("b.log", "invalid ERROR failure\nERROR again")]);
    expect(signals.find((signal) => signal.kind === "error-burst")).toMatchObject({ count: 8 });
    expect(signals.filter((signal) => signal.kind === "first-error").map((signal) => signal.anchors[0])).toMatchObject([
      { file: "a.log", line: 1 }, { file: "b.log", line: 1 }
    ]);
    expect(extractLogSignals([file("slow.log", Array.from({ length: 5 }, (_, i) => `2026-10-19T00:00:${i * 10}Z ERROR slow`).join("\n"))]).signals.some((signal) => signal.kind === "error-burst")).toBe(false);
  });

  it("normalizes numeric, hex, identifier and path tokens and aggregates across files with first/last anchors", () => {
    expect(normalizeLogTemplate("value=12 ptr=0xAB request_id=a4f id=hello /var/log/a C:\\logs\\b 550e8400-e29b-41d4-a716-446655440000"))
      .toBe("value=<n> ptr=<hex> request_id=<id> id=<id> <path> <path> <id>");
    const { templates } = extractLogSignals([file("a.log", "INFO retry 1 /tmp/a\nINFO retry 2 /tmp/b"), file("b.log", "INFO retry 3 /tmp/c")]);
    expect(templates).toEqual([{ template: "INFO retry <n> <path>", count: 3,
      first: { file: "a.log", line: 1, content: "INFO retry 1 /tmp/a" }, last: { file: "b.log", line: 1, content: "INFO retry 3 /tmp/c" } }]);
  });

  it("adds only explicitly supplied pinned skill rules alongside generic signals", () => {
    const input = [file("a.log", "ERROR code=E_THERMAL_FOLDBACK thermal foldback")];
    expect(extractLogSignals(input).signals.every((signal) => signal.source === "generic")).toBe(true);
    expect(extractLogSignals(input, defaultChargingRuleSet).signals).toContainEqual(expect.objectContaining({ source: "skill", kind: "skill:thermal-foldback", count: 1 }));
  });

  it("caps signals, templates, evidence content and anchors while continuing counts for retained keys", () => {
    const signals = extractLogSignals(Array.from({ length: LOG_SIGNAL_LIMITS.signals + 5 }, (_, i) => file(`${i}.log`, "assert\nassert")));
    expect(signals.signals).toHaveLength(LOG_SIGNAL_LIMITS.signals);
    expect(signals.truncatedSignals).toBe(true);
    const templates = extractLogSignals([file("a.log", Array.from({ length: LOG_SIGNAL_LIMITS.templates + 5 }, (_, i) => `${String.fromCharCode(65 + i)} unique`).join("\n"))]);
    expect(templates.templates).toHaveLength(LOG_SIGNAL_LIMITS.templates);
    expect(templates.truncatedTemplates).toBe(true);
    const repeated = extractLogSignals([file("a.log", Array.from({ length: 20 }, () => `assert ${"x".repeat(800)}`).join("\n"))]);
    expect(repeated.signals[0].count).toBe(20);
    expect(repeated.signals[0].anchors).toHaveLength(LOG_SIGNAL_LIMITS.anchors);
    expect(repeated.signals[0].anchors[0].content).toHaveLength(LOG_SIGNAL_LIMITS.contentChars);
  });

  it("yields and stops near its real clock budget on a valid 100 MiB parsed log while retaining partial results", async () => {
    const numericLine = "1 ".repeat(32_767);
    // Materialize distinct strings before timing; this is parsed input, not a parser benchmark.
    const rawLines = ["kernel panic", ...Array.from({ length: 1600 }, (_, index) => Buffer.from(`${numericLine}${index}`).toString("utf8"))];
    const parsed = { ok: true as const, rawLines, entries: rawLines.map((message, index) => ({
      lineNumber: index + 1, severity: "info" as const, message, tokens: {}
    })) };
    let timerFired = false;
    const timer = setTimeout(() => { timerFired = true; }, 0);
    const maxMs = 250;
    const started = performance.now();
    let summary;
    try { summary = await extractLogSignalsCooperatively([{ path: "pathological.log", parsed }], undefined, { maxMs }); }
    finally { clearTimeout(timer); }
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThanOrEqual(maxMs + 1000);
    expect(timerFired).toBe(true);
    expect(summary).toMatchObject({ truncated: true, reason: "time_cap", signals: [{ kind: "crash", anchors: [{ file: "pathological.log", line: 1 }] }] });
    expect(summary.signals.length).toBeLessThanOrEqual(LOG_SIGNAL_LIMITS.signals);
    expect(summary.templates.length).toBeLessThanOrEqual(LOG_SIGNAL_LIMITS.templates);
  }, 10_000);

  it("bounds each raw line prefix and honestly reports ignored content", async () => {
    const input = [file("long.log", `${"x".repeat(6144)} kernel panic`)];
    for (const summary of [extractLogSignals(input), await extractLogSignalsCooperatively(input)]) {
      expect(summary).toMatchObject({ truncated: true, reason: "line_cap", signals: [] });
      expect(summary.templates).toHaveLength(1);
    }
  });

  it("checks its deadline between conditions inside a single large pinned rule", async () => {
    const signalRules = { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0],
      anyOf: Array.from({ length: 200_000 }, () => ({ type: "text" as const, pattern: "not-present" })) }] };
    const input = [file("a.log", "INFO ordinary event")];
    const maxMs = 50;
    const started = performance.now();
    const summary = await extractLogSignalsCooperatively(input, signalRules, { maxMs });
    expect(performance.now() - started).toBeLessThanOrEqual(maxMs + 1000);
    expect(summary).toMatchObject({ truncated: true, reason: "time_cap" });
  });

  it("marks a synchronous extraction that crosses its deadline in the final work step", () => {
    const input = [file("a.log", "INFO final event")];
    const clock = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10_001);
    try {
      expect(extractLogSignals(input)).toMatchObject({ truncated: true, reason: "time_cap" });
    } finally { clock.mockRestore(); }
  });

  it("returns an honest extraction error when a pinned rule cannot compile", async () => {
    const malformedRules = { ...defaultChargingRuleSet, rules: [{ ...defaultChargingRuleSet.rules[0],
      anyOf: [{ type: "text" as const, pattern: "(" }] }] };
    for (const summary of [extractLogSignals([file("a.log", "kernel panic")], malformedRules),
      await extractLogSignalsCooperatively([file("a.log", "kernel panic")], malformedRules)]) {
      expect(summary).toMatchObject({ truncated: true, reason: "extraction_error", signals: [], templates: [] });
    }
  });

  it("defaults malformed runtime limits and clamps valid overrides to the platform ceiling", () => {
    expect(logSignalLimits({})).toEqual({ maxMs: 5000 });
    for (const value of ["", "-1", "0", "0.5", "garbage", "Infinity", "NaN", "1e9", "9007199254740992"]) {
      expect(logSignalLimits({ LOG_SIGNAL_MAX_MS: value })).toEqual({ maxMs: 5000 });
    }
    expect(logSignalLimits({ LOG_SIGNAL_MAX_MS: "1" })).toEqual({ maxMs: 1 });
    expect(logSignalLimits({ LOG_SIGNAL_MAX_MS: "250" })).toEqual({ maxMs: 250 });
    expect(logSignalLimits({ LOG_SIGNAL_MAX_MS: "10000" })).toEqual({ maxMs: 10_000 });
    expect(logSignalLimits({ LOG_SIGNAL_MAX_MS: "10001" })).toEqual({ maxMs: 10_000 });
    expect(LOG_SIGNAL_LIMITS.lineChars).toBe(6144);
  });
});
