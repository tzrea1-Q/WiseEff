import { setImmediate } from "node:timers/promises";
import { createGzip } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createContext, Script } from "node:vm";
import { decodeLogFilesSteps, DECODE_BATCH_LINES, MAX_DECODE_EVENTS, type DecodeLogFile, type DecodeResult } from "./engine";
import type { DecodedEvent, ParsingSpec } from "./spec";

export const DEFAULT_LOG_DECODE_MAX_MS = 15_000;
export const MAX_LOG_DECODE_MS = 20_000;

export function logDecodeLimits(env: NodeJS.ProcessEnv = process.env) {
  const positive = (value: string | undefined, fallback: number) => value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return { maxMs: Math.min(MAX_LOG_DECODE_MS, positive(env.LOG_DECODE_MAX_MS, DEFAULT_LOG_DECODE_MAX_MS)), maxEvents: positive(env.LOG_DECODE_MAX_EVENTS, MAX_DECODE_EVENTS) };
}

/** Worker scheduling and clock live outside the deterministic engine. */
export async function decodeLogFilesCooperatively(spec: ParsingSpec, files: DecodeLogFile[], options: {
  maxMs?: number; maxEvents?: number; now?: () => number; hardTimeout?: boolean;
} = {}): Promise<DecodeResult> {
  const limits = logDecodeLimits(), now = options.now ?? (() => performance.now());
  const maxMs = options.maxMs ?? limits.maxMs;
  const started = now();
  const steps = decodeLogFilesSteps(spec, files, options.maxEvents ?? limits.maxEvents);
  let step = steps.next();
  let timedOut = false;
  let interrupted = false;
  const snapshot = () => ({ eventCount: step.value.events.length, unmatchedLineCount: step.value.unmatchedLineCount,
    counts: { ...step.value.counts, byExtractor: { ...step.value.counts.byExtractor }, errors: { ...step.value.counts.errors } } });
  let checkpoint = options.hardTimeout ? snapshot() : undefined;
  const advance = () => {
    const batchStart = now();
    for (let work = 0; !step.done && work < DECODE_BATCH_LINES; work++) {
      // Every engine checkpoint precedes a line, group flush or compilation.
      if (now() - started >= maxMs) { timedOut = true; return; }
      step = steps.next();
      if (options.hardTimeout) checkpoint = snapshot();
      if (now() - batchStart >= 8) return;
    }
  };
  // Only this constant callback is evaluated; no user source is evaluated by vm.
  // The preview watchdog can interrupt even one unexpectedly expensive RE2 call.
  const watchdog = options.hardTimeout ? { script: new Script("advance()"), context: createContext({ advance }) } : undefined;
  while (!step.done) {
    await setImmediate();
    if (now() - started >= maxMs) {
      timedOut = true; break;
    }
    try {
      if (watchdog) watchdog.script.runInContext(watchdog.context, { timeout: Math.max(1, Math.ceil(maxMs - (now() - started))) });
      else advance();
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")) throw error;
      timedOut = true; interrupted = true;
      // A watchdog may interrupt halfway through an emission. Keep only the
      // last completed checkpoint, including its counters. Never resume it.
      step.value.events.length = checkpoint!.eventCount;
      step.value.unmatchedLineCount = checkpoint!.unmatchedLineCount;
      Object.assign(step.value.counts, checkpoint!.counts);
    }
    if (timedOut) break;
  }
  if (timedOut || now() - started >= maxMs) {
    step.value.counts.errors.time_cap = (step.value.counts.errors.time_cap ?? 0) + 1;
    if (!interrupted) steps.return(step.value); // Discard unfinished groups; pure engine owns no IO resources.
  }
  return step.value;
}

/** Backpressure bounds uncompressed JSONL; the object-store port requires one compressed Buffer. */
export async function gzipDecodedEvents(events: Iterable<DecodedEvent>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(Readable.from((function* () {
    for (const event of events) yield JSON.stringify(event) + "\n";
  })(), { objectMode: false }), createGzip(), new Writable({
    write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); }
  }));
  return Buffer.concat(chunks);
}

export function indexDecodedEvents(events: readonly DecodedEvent[]) {
  const index = new Map<string, DecodedEvent[]>();
  for (const event of events) {
    const key = JSON.stringify([event.file, event.line]);
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push(event);
  }
  return index;
}
