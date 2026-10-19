import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { MAX_DECODE_EVENTS } from "../server/modules/logs/parsing/engine";
import { parsingSpecSchema } from "../server/modules/logs/parsing/spec";
import { DEFAULT_LOG_DECODE_MAX_MS, decodeLogFilesCooperatively, gzipDecodedEvents, indexDecodedEvents } from "../server/modules/logs/parsing/workerDecoding";

// Manual probe only: npx tsx scripts/log-decode-memory-probe.ts
const MiB = 1024 * 1024;
const lineBytes = 256;
const block = Buffer.from(Array.from({ length: 5 }, (_, i) =>
  (`[2026-10-19 12:00:00.123] kernel: ${i === 0 ? "charge_current_ma=2000 state=thermal" : "heartbeat state=running"} message=`)
    .padEnd(lineBytes - 1, "x") + "\n").join(""));
const files = [32, 32, 31].map((size, i) => ({ file: `kernel-${i}.log`, lines: Buffer.alloc(size * MiB).fill(block).toString("utf8").split("\n") }));
const spec = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "current", files: ["kernel-*.log"],
  pattern: "charge_current_ma=(?P<current>\\d+)", fields: { current: { type: "uint" } } }] });

// Monitor only decoding, streaming compression and indexing. RSS high-water includes input setup.
const intervalMs = 10;
let lastTick = performance.now(), longestEventLoopStallMs = 0;
let peakHeapUsed = process.memoryUsage().heapUsed;
const sample = () => {
  const now = performance.now();
  longestEventLoopStallMs = Math.max(longestEventLoopStallMs, now - lastTick - intervalMs);
  lastTick = now;
  peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
};
const monitor = setInterval(sample, intervalMs);
const started = performance.now();
try {
  // Explicit defaults make the probe independent of deployment env overrides.
  const result = await decodeLogFilesCooperatively(spec, files, { maxEvents: MAX_DECODE_EVENTS, maxMs: DEFAULT_LOG_DECODE_MAX_MS });
  const artifact = await gzipDecodedEvents(result.events);
  const eventsByLine = indexDecodedEvents(result.events);
  await setImmediate();
  sample();
  const memory = process.memoryUsage();
  assert(result.counts.total <= MAX_DECODE_EVENTS);
  console.log(JSON.stringify({ inputMiB: 95, files: files.length, matchRate: 0.2,
    maxEvents: MAX_DECODE_EVENTS, maxMs: DEFAULT_LOG_DECODE_MAX_MS,
    elapsedMs: performance.now() - started, events: result.counts.total, errors: result.counts.errors,
    indexedLines: eventsByLine.size, compressedMiB: artifact.byteLength / MiB,
    peakRssMiB: process.resourceUsage().maxRSS / 1024, heapUsedMiB: memory.heapUsed / MiB,
    sampledPeakHeapUsedMiB: peakHeapUsed / MiB, longestEventLoopStallMs, monitorIntervalMs: intervalMs
  }, null, 2));
} finally { clearInterval(monitor); }
