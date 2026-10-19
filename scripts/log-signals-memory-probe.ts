import assert from "node:assert/strict";

import { extractLogSignalsCooperatively, LOG_SIGNAL_LIMITS } from "../server/modules/logs/genericSignals";

const maxMs = 250;
const numericLine = "1 ".repeat(32_767);
// Materialize 100 MiB before starting the extractor clock, including input setup in peak RSS.
const rawLines = ["kernel panic", ...Array.from({ length: 1600 }, (_, index) => Buffer.from(`${numericLine}${index}`).toString("utf8"))];
const files = [{ path: "pathological.log", parsed: { ok: true as const, rawLines,
  entries: rawLines.map((message, index) => ({ lineNumber: index + 1, severity: "info" as const, message, tokens: {} }))
} }];
const inputBytes = rawLines.reduce((bytes, line) => bytes + Buffer.byteLength(line, "utf8"), 0);
let timerFired = false;
const timer = setTimeout(() => { timerFired = true; }, 0);
const started = performance.now();
const summary = await extractLogSignalsCooperatively(files, undefined, { maxMs });
const elapsedMs = performance.now() - started;
clearTimeout(timer);
assert.ok(elapsedMs <= maxMs + 1000, `Extraction exceeded its budget: ${elapsedMs} ms`);
assert.equal(timerFired, true, "Extraction must yield to the event loop");
assert.equal(summary.truncated, true);
assert.equal(summary.reason, "time_cap");
assert.ok(summary.signals.some((signal) => signal.kind === "crash" && signal.anchors[0]?.line === 1));
assert.ok(summary.signals.length <= LOG_SIGNAL_LIMITS.signals);
assert.ok(summary.templates.length <= LOG_SIGNAL_LIMITS.templates);
console.log(JSON.stringify({ inputMiB: inputBytes / 1024 ** 2, inputLines: rawLines.length,
  maxMs, elapsedMs, timerFired, truncated: summary.truncated, reason: summary.reason,
  retainedSignals: summary.signals.length, retainedTemplates: summary.templates.length,
  peakRssMiB: process.resourceUsage().maxRSS / 1024 }, null, 2));
