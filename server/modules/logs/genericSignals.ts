import { compileLogPattern } from "./adminPattern";
import { setImmediate } from "node:timers/promises";
import { createContext, Script } from "node:vm";
import type { ParsedLogEntry, ParseResult } from "./parser";
import type { LogFileReader, LogFileLine } from "./fileReader";
import { compileSignalCondition, type SignalRuleSet } from "./signalRules";

export type LogSignalAnchor = { file: string; line: number; content: string };
export type LogSignal = {
  kind: string;
  severity: "Critical" | "Warning" | "Info";
  source: "generic" | "skill";
  title: string;
  signature?: string;
  count: number;
  anchors: LogSignalAnchor[];
};
export type LogLineTemplate = { template: string; count: number; first: LogSignalAnchor; last: LogSignalAnchor };
export type LogSignalSummary = {
  truncated?: boolean;
  reason?: "time_cap" | "line_cap" | "extraction_error";
  signals: LogSignal[];
  templates: LogLineTemplate[];
  truncatedSignals: boolean;
  truncatedTemplates: boolean;
};
export const LOG_SIGNAL_LIMITS = { signals: 200, templates: 200, anchors: 5, contentChars: 400,
  lineChars: 6144, gapMs: 60_000, burstWindowMs: 10_000, burstErrors: 5 } as const;

export function logSignalLimits(env: NodeJS.ProcessEnv = process.env) {
  const value = env.LOG_SIGNAL_MAX_MS;
  const maxMs = value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 5000;
  return { maxMs: Math.min(10_000, maxMs) };
}

function emptySummary(): LogSignalSummary {
  return { signals: [], templates: [], truncatedSignals: false, truncatedTemplates: false };
}
type SignalFile = { path: string; parsed?: Extract<ParseResult, { ok: true }>; reader?: Pick<LogFileReader, "lineCount" | "lines" | "entries"> };
type SignalStep = LogSignalSummary & { readLine?: { fileIndex: number; lineNumber: number } };
type SignalLine = { rawContent: string; entry?: ParsedLogEntry };

const crash = compileLogPattern("\\bBUG:|\\b(kernel panic|Oops|watchdog|ANR|FATAL EXCEPTION|segfault|assert(?:ion)?)\\b", "i");
const boot = compileLogPattern("\\b(Linux version|Booting|boot completed|BOOT_COMPLETED|system boot|reboot(?:ing)?|starting kernel)\\b", "i");
const error = compileLogPattern("\\b(ERROR|ERR|FATAL)\\b", "i");
const kernelTimestamp = compileLogPattern("^\\s*(?:<[0-9]+>)?\\[\\s*([0-9]+(?:\\.[0-9]+)?)\\]");
const signatureNames: Record<string, string> = { "kernel panic": "Kernel panic", oops: "Oops", "bug:": "BUG:",
  watchdog: "watchdog", anr: "ANR", "fatal exception": "FATAL EXCEPTION", segfault: "segfault", assert: "assert", assertion: "assert" };
const templateToken = compileLogPattern("([A-Za-z_][A-Za-z0-9_]*(?:_id|Id)|id)=([^\\s]+)|([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})|(0[xX][0-9a-fA-F]+|\\b[0-9a-fA-F]{12,}\\b)|((?:[A-Za-z]:\\\\|/)[^\\s]+)|[+-]?[0-9]+(?:\\.[0-9]+)?");

/** RE2 tokenization consumes each input once; placeholders are never rescanned. */
export function normalizeLogTemplate(message: string): string {
  const parts: string[] = [];
  const input = message.slice(0, LOG_SIGNAL_LIMITS.lineChars);
  let previous = 0;
  for (const match of templateToken.matchAll(input)) {
    parts.push(input.slice(previous, match.index), match[1] ? `${match[1]}=<id>` : match[3] ? "<id>" : match[4] ? "<hex>" : match[5] ? "<path>" : "<n>");
    previous = match.index + match[0].length;
  }
  parts.push(input.slice(previous));
  return parts.join("").slice(0, LOG_SIGNAL_LIMITS.contentChars);
}

/** One forward scan per file, with fixed-size summaries and error windows. */
function* extractLogSignalSteps(
  files: SignalFile[],
  signalRules?: SignalRuleSet
): Generator<SignalStep, LogSignalSummary, SignalLine | undefined> {
  const summary = emptySummary();
  yield summary;
  const signals = new Map<string, LogSignal>();
  // ponytail: retain the first 200 templates; use a bounded heavy-hitter sketch if later templates must compete for the top list.
  const templates = new Map<string, LogLineTemplate>();
  const rules = [];
  for (const rule of signalRules?.rules ?? []) {
    const matches = [];
    for (const condition of rule.anyOf) {
      yield summary;
      matches.push(compileSignalCondition(condition, LOG_SIGNAL_LIMITS.lineChars));
    }
    rules.push({ rule, matches });
  }
  const add = (key: string, signal: Omit<LogSignal, "count" | "anchors">, anchors: LogSignalAnchor[], count = 1) => {
    let found = signals.get(key);
    if (!found) {
      if (signals.size >= LOG_SIGNAL_LIMITS.signals) { summary.truncatedSignals = true; return; }
      found = { ...signal, count: 0, anchors: [] };
      signals.set(key, found);
      summary.signals.push(found);
    }
    found.count += count;
    for (const anchor of anchors) {
      if (found.anchors.length >= LOG_SIGNAL_LIMITS.anchors) break;
      if (!found.anchors.some((item) => item.file === anchor.file && item.line === anchor.line)) found.anchors.push(anchor);
    }
  };
  for (const [fileIndex, file] of files.entries()) {
    if (!file.parsed && !file.reader) continue;
    let entryIndex = 0;
    let previous: { time: number; clock: "wall" | "boot"; anchor: LogSignalAnchor } | undefined;
    let firstError = true, lastBurstError = 0;
    const errors: Array<{ time: number; anchor: LogSignalAnchor }> = [];
    const lineCount = file.reader?.lineCount ?? file.parsed!.rawLines.length;
    for (let index = 0; index < lineCount; index++) {
      yield summary;
      let rawContent: string, entry: ParsedLogEntry | undefined;
      if (file.reader) {
        const line = yield { ...summary, readLine: { fileIndex, lineNumber: index + 1 } };
        if (!line) throw new Error("Streaming signals require a line");
        ({ rawContent, entry } = line);
      } else {
        rawContent = file.parsed!.rawLines[index];
        while (file.parsed!.entries[entryIndex]?.lineNumber < index + 1) entryIndex++;
        entry = file.parsed!.entries[entryIndex]?.lineNumber === index + 1 ? file.parsed!.entries[entryIndex] : undefined;
      }
      const content = rawContent.slice(0, LOG_SIGNAL_LIMITS.lineChars);
      if (rawContent.length > content.length) { summary.truncated = true; summary.reason = "line_cap"; }
      if (!content.trim()) continue;
      const anchor = { file: file.path, line: index + 1, content: content.slice(0, LOG_SIGNAL_LIMITS.contentChars) };
      if (entry && entry.message.length > LOG_SIGNAL_LIMITS.lineChars) { summary.truncated = true; summary.reason = "line_cap"; }
      const generic = (kind: string, severity: LogSignal["severity"], title: string, anchors = [anchor], count = 1, signature?: string) =>
        add(JSON.stringify([file.path, kind, signature]), { kind, severity, title, source: "generic", ...(signature ? { signature } : {}) }, anchors, count);
      const crashMatch = crash.exec(content);
      if (crashMatch) {
        const signature = signatureNames[crashMatch[0].toLowerCase()];
        generic("crash", "Critical", `Crash signature: ${signature}`, [anchor], 1, signature);
      }
      if (boot.test(content)) generic("restart", "Warning", "Boot marker or timestamp reset");
      const wallTime = entry?.timestamp ? Date.parse(entry.timestamp.slice(0, LOG_SIGNAL_LIMITS.lineChars)) : NaN;
      const bootTime = kernelTimestamp.exec(content);
      const clock = bootTime ? "boot" : "wall";
      const time = bootTime ? Number(bootTime[1]) * 1000 : wallTime;
      if (Number.isFinite(time)) {
        if (previous && previous.clock !== clock) errors.length = 0;
        if (previous?.clock === clock && time < previous.time) {
          generic("restart", "Warning", "Boot marker or timestamp reset", [previous.anchor, anchor]);
          errors.length = 0;
        } else if (previous?.clock === clock && time - previous.time >= LOG_SIGNAL_LIMITS.gapMs) {
          generic("timestamp-gap", "Warning", "Timestamp gap of at least 60 seconds", [previous.anchor, anchor]);
        }
        previous = { time, clock, anchor };
      }
      if (entry?.severity === "error" || error.test(content)) {
        if (firstError) { generic("first-error", "Warning", "First error in file"); firstError = false; }
        if (Number.isFinite(time)) {
          while (errors.length && time - errors[0].time > LOG_SIGNAL_LIMITS.burstWindowMs) errors.shift();
          errors.push({ time, anchor });
          if (errors.length > LOG_SIGNAL_LIMITS.burstErrors) errors.shift();
          if (errors.length === LOG_SIGNAL_LIMITS.burstErrors) {
            generic("error-burst", "Warning", "At least 5 errors within 10 seconds", errors.map((item) => item.anchor),
              errors.filter((item) => item.anchor.line > lastBurstError).length);
            lastBurstError = anchor.line;
          }
        }
      }
      const template = normalizeLogTemplate(entry?.message ?? content);
      const existing = templates.get(template);
      if (existing) { existing.count++; existing.last = anchor; }
      else if (templates.size < LOG_SIGNAL_LIMITS.templates) {
        const item = { template, count: 1, first: anchor, last: anchor };
        templates.set(template, item);
        summary.templates.push(item);
      }
      else summary.truncatedTemplates = true;
      if (entry) for (const { rule, matches } of rules) {
        for (const match of matches) {
          yield summary;
          if (!match(entry)) continue;
          add(`skill:${rule.id}`, {
            kind: `skill:${rule.id}`, source: "skill", title: rule.inference,
            severity: rule.analysis.severity?.value ?? signalRules!.hitDefaults.severity
          }, [anchor]);
          break;
        }
      }
    }
  }
  return summary;
}

/** The worker yields between small batches; every checkpoint precedes bounded line work. */
export async function extractLogSignalsCooperatively(
  files: Parameters<typeof extractLogSignalSteps>[0], signalRules?: SignalRuleSet,
  options: { maxMs?: number; now?: () => number; hardTimeout?: boolean } = {}
): Promise<LogSignalSummary> {
  let partial: SignalStep | undefined;
  let active: { fileIndex: number; lines: ReturnType<LogFileReader["lines"]>; entries: ReturnType<LogFileReader["entries"]>; entry?: ParsedLogEntry } | undefined;
  const close = async () => { await active?.lines.return(undefined); await active?.entries.return(undefined); active = undefined; };
  try {
    const now = options.now ?? (() => performance.now());
    const deadline = now() + Math.max(0, Math.min(options.maxMs ?? logSignalLimits().maxMs, logSignalLimits().maxMs));
    const realDeadline = performance.now() + Math.max(0, Math.min(options.maxMs ?? logSignalLimits().maxMs, logSignalLimits().maxMs));
    const steps = extractLogSignalSteps(files, signalRules);
    let step: ReturnType<typeof steps.next> = steps.next();
    let nextLine: SignalLine | undefined;
    // A constant callback only: administrator patterns are data, never VM source.
    const watchdog = options.hardTimeout ? { script: new Script("advance()"), context: createContext({ advance: () => steps.next(nextLine) }) } : undefined;
    while (!step.done) {
      await setImmediate();
      const batchStart = now();
      for (let work = 0; !step.done && work < 64; work++) {
        partial = step.value;
        if (now() >= deadline) {
          step.value.truncated = true; step.value.reason = "time_cap";
          steps.return(step.value);
          step.value.templates.sort((a, b) => b.count - a.count);
          delete step.value.readLine;
          return step.value;
        }
        let line: SignalLine | undefined;
        const request: SignalStep["readLine"] = step.value.readLine;
        if (request) {
          const reader: SignalFile["reader"] = files[request.fileIndex].reader;
          if (!reader) throw new Error("Invalid streaming signal input");
          if (active?.fileIndex !== request.fileIndex) {
            await close();
            active = { fileIndex: request.fileIndex, lines: reader.lines({ deadline: realDeadline }), entries: reader.entries({ deadline: realDeadline }) };
            active.entry = (await active.entries.next()).value;
          }
          const raw: IteratorResult<LogFileLine> = await active!.lines.next();
          if (raw.done || raw.value.lineNumber !== request.lineNumber) throw new Error("Log text does not match its line index");
          while (active!.entry && active!.entry.lineNumber < request.lineNumber) active!.entry = (await active!.entries.next()).value;
          line = { rawContent: raw.value.content, entry: active!.entry?.lineNumber === request.lineNumber ? active!.entry : undefined };
          if (now() >= deadline) {
            step.value.truncated = true; step.value.reason = "time_cap";
            steps.return(step.value);
            step.value.templates.sort((a, b) => b.count - a.count);
            delete step.value.readLine;
            return step.value;
          }
        }
        nextLine = line;
        step = watchdog ? watchdog.script.runInContext(watchdog.context, { timeout: Math.max(1, Math.ceil(deadline - now())) }) : steps.next(line);
        if (now() - batchStart >= 8) break;
      }
    }
    if (now() >= deadline) { step.value.truncated = true; step.value.reason = "time_cap"; }
    step.value.templates.sort((a, b) => b.count - a.count);
    return step.value;
  } catch (error) {
    if (partial && error && typeof error === "object" && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      // The interrupted step may be halfway through mutating its summary.
      return { ...emptySummary(), truncated: true, reason: "time_cap" };
    }
    if (partial && error && typeof error === "object" && "code" in error && error.code === "LOG_READER_TIME_CAP") {
      partial.truncated = true; partial.reason = "time_cap";
      partial.templates.sort((a, b) => b.count - a.count);
      delete partial.readLine;
      return partial;
    }
    return { ...emptySummary(), truncated: true, reason: "extraction_error" };
  } finally { await close(); }
}

/** Small offline/direct callers share the line and time bounds without worker scheduling. */
export function extractLogSignals(files: Array<{ path: string; parsed?: Extract<ParseResult, { ok: true }> }>, signalRules?: SignalRuleSet): LogSignalSummary {
  try {
    const deadline = performance.now() + logSignalLimits().maxMs;
    const steps = extractLogSignalSteps(files, signalRules);
    let step = steps.next();
    while (!step.done && performance.now() < deadline) step = steps.next();
    if (!step.done || performance.now() >= deadline) { step.value.truncated = true; step.value.reason = "time_cap"; steps.return(step.value); }
    step.value.templates.sort((a, b) => b.count - a.count);
    return step.value;
  } catch { return { ...emptySummary(), truncated: true, reason: "extraction_error" }; }
}
