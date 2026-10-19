import { runInNewContext } from "node:vm";
import { isDeepStrictEqual } from "node:util";
import { decodeLogFilesCooperatively } from "./parsing/workerDecoding";
import { MAX_DECODE_EVENTS, MAX_DECODE_OUTPUT_BYTES, MAX_DECODE_OUTPUT_FIELDS } from "./parsing/engine";
import { extractLogSignalsCooperatively } from "./genericSignals";
import { genericSignalRuleSet } from "./analyzer";
import { parseLogLines } from "./parser";
import { logSkillSpecSchema, type LogSkillSpec } from "./skillSpec";
import type { ParseTest, ParseTestResult, ParseTestRun, ParseTestValue } from "./parseTestSpec";
import { registerCaseKey, type DecodedEvent } from "./parsing/spec";

export const PARSE_TEST_MAX_MS = 1000;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const timedOut = (error: unknown) => object(error) && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
function fieldAt(fields: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => object(value) && Object.hasOwn(value, key) ? value[key] : undefined, fields);
}
function fieldDiffs(expected: unknown, actual: unknown, path: string, diffs: ParseTestResult["diffs"]) {
  const authoredExpected = expected;
  if (object(expected)) {
    if (!object(actual)) {
      diffs.push({ path, expected: expected as ParseTestValue, actual: actual === undefined ? null : actual as ParseTestValue, ...(actual === undefined ? { missing: true } : {}) });
      return;
    }
    for (const [key, value] of Object.entries(expected)) fieldDiffs(value, object(actual) && Object.hasOwn(actual, key) ? actual[key] : undefined, path ? `${path}.${key}` : key, diffs);
    return;
  }
  // Numeric captures retain their raw text; assertions normally target the value.
  const converted = object(actual) && Object.hasOwn(actual, "value");
  if (converted) actual = (actual as Record<string, unknown>).value;
  if (!path.endsWith(".raw") && !path.endsWith(".meaning")) {
    if ((converted || path.endsWith(".value")) && typeof expected === "string" && typeof actual === "string"
      && registerCaseKey(expected) === registerCaseKey(actual)) return;
    if (typeof actual === "number" && typeof expected === "string" && expected.trim() && Number.isFinite(Number(expected))
      && (!Number.isInteger(Number(expected)) || Number.isSafeInteger(Number(expected)))) expected = Number(expected);
    if (typeof expected === "number" && typeof actual === "string" && actual.trim() && Number.isFinite(Number(actual))
      && (!Number.isInteger(Number(actual)) || Number.isSafeInteger(Number(actual)))) actual = Number(actual);
  }
  if (!isDeepStrictEqual(expected, actual)) diffs.push({ path, expected: authoredExpected as ParseTestValue, actual: actual === undefined ? null : actual as ParseTestValue, ...(actual === undefined ? { missing: true } : {}) });
}
function compareFields(test: ParseTest, events: DecodedEvent[]) {
  if (!Object.keys(test.expect.fields ?? {}).length) return [];
  // A case describes one decoded event, even when the input assembles many lines.
  let closest: ParseTestResult["diffs"] | undefined;
  for (const event of events.length ? events : [undefined]) {
    const diffs: ParseTestResult["diffs"] = [];
    for (const [path, expected] of Object.entries(test.expect.fields ?? {})) fieldDiffs(expected, fieldAt(event?.fields, path), path, diffs);
    if (!diffs.length) return diffs;
    if (!closest || diffs.length < closest.length) closest = diffs;
  }
  return closest ?? [];
}
function outputFields(value: unknown): number {
  return object(value) ? Object.values(value).reduce<number>((sum, child) => sum + 1 + outputFields(child), 0) : 0;
}

/** The same decoder and signal extractor used by the worker, under one run budget. */
export async function runParseTests(value: LogSkillSpec, options: { maxMs?: number; now?: () => number } = {}): Promise<ParseTestRun> {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + Math.min(PARSE_TEST_MAX_MS, Math.max(0, options.maxMs ?? PARSE_TEST_MAX_MS));
  const remaining = () => Math.max(0, deadline - now());
  const bounded = <T>(callback: () => T) => {
    if (remaining() <= 0) throw new Error("Parse test deadline exceeded");
    return runInNewContext("run()", { run: callback }, { timeout: Math.max(1, Math.ceil(remaining())) }) as T;
  };
  const results: ParseTestResult[] = [];
  let spec: LogSkillSpec;
  try { spec = bounded(() => logSkillSpecSchema.parse(value)); }
  catch (error) {
    // Invalid specs are rejected by the service; the runner still fails closed for direct callers.
    if (!timedOut(error) && !(error instanceof Error && error.message.includes("deadline"))) throw error;
    spec = value;
  }
  let bytes = 0, fields = 0, eventCount = 0, truncated = false;
  for (const test of spec.parseTests ?? []) {
    const result: ParseTestResult = { id: test.id, name: test.name, passed: false, diffs: [], missingSignals: [], unexpectedSignals: [], events: [], signals: [] };
    try {
      if (!remaining()) throw new Error("Parse test deadline exceeded");
      if (bytes >= MAX_DECODE_OUTPUT_BYTES || fields >= MAX_DECODE_OUTPUT_FIELDS || eventCount >= MAX_DECODE_EVENTS) throw new Error("Parse test output cap exceeded");
      const file = test.fileName ?? "sample.log";
      if (spec.parsing) {
        const decoded = await decodeLogFilesCooperatively(spec.parsing, [{ file, lines: test.lines }],
          { maxMs: remaining(), maxEvents: MAX_DECODE_EVENTS - eventCount, hardTimeout: true });
        if (decoded.truncated || Object.keys(decoded.counts.errors).length) result.error = decoded.reason ?? Object.keys(decoded.counts.errors).join(", ");
        for (const event of decoded.events) {
          const size = Buffer.byteLength(JSON.stringify(event)), count = outputFields(event.fields);
          if (bytes + size > MAX_DECODE_OUTPUT_BYTES || fields + count > MAX_DECODE_OUTPUT_FIELDS) { result.error = "Parse test output cap exceeded"; break; }
          result.events.push(event); bytes += size; fields += count; eventCount++;
        }
      }
      const entries = [];
      for await (const entry of parseLogLines((async function* () {
        for (const [index, content] of test.lines.entries()) {
          if (!remaining()) throw new Error("Parse test deadline exceeded");
          yield { lineNumber: index + 1, content };
        }
      })(), spec.formatProfile)) entries.push(entry);
      const signals = await extractLogSignalsCooperatively([{ path: file, parsed: { ok: true, rawLines: test.lines, entries } }],
        spec.signalRules ?? genericSignalRuleSet, { maxMs: remaining(), hardTimeout: true });
      if (signals.truncated || signals.truncatedSignals) result.error = signals.reason ?? "Parse test signal cap exceeded";
      const signalNames = signals.signals.map((signal) => ({ id: signal.kind.startsWith("skill:") ? signal.kind.slice(6) : signal.kind, title: signal.title }));
      result.signals = [...new Set(signalNames.map((signal) => signal.id))];
      bounded(() => {
        result.diffs = compareFields(test, result.events);
        const expected = new Set(test.expect.signals ?? []);
        const matches = (name: string, signal: typeof signalNames[number]) => signal.id === name || signal.title === name;
        result.missingSignals = [...expected].filter((name) => !signalNames.some((signal) => matches(name, signal)));
        if (test.expect.exactSignals) result.unexpectedSignals = [...new Set(signalNames.filter((signal) => ![...expected].some((name) => matches(name, signal))).map((signal) => signal.id))];
        for (const name of result.missingSignals) result.diffs.push({ path: `signals.${name}`, expected: true, actual: false });
        for (const name of result.unexpectedSignals) result.diffs.push({ path: `signals.${name}`, expected: false, actual: true });
      });
      if (!remaining()) throw new Error("Parse test deadline exceeded");
      result.passed = !result.error && !result.diffs.length && !result.missingSignals.length && !result.unexpectedSignals.length;
    } catch (error) {
      if (timedOut(error)) result.error = "Parse test deadline exceeded";
      else if (error instanceof Error) result.error = error.message;
      else throw error;
    }
    truncated ||= !!result.error;
    results.push(result);
  }
  const passed = results.filter((result) => result.passed).length;
  return { total: results.length, passed, failed: results.length - passed, results, truncated };
}
