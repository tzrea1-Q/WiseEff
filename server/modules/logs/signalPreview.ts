import { createContext, runInNewContext, Script } from "node:vm";
import { setImmediate } from "node:timers/promises";
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "./objectStore";
import { requireLogAdminDomains } from "./policy";
import { getLogSkillSample } from "./skillSamplesService";
import { logSkillSpecSchema } from "./skillSpec";
import { compileSignalRules, createSignalEvaluationBudget, SIGNAL_RULE_LIMITS, SignalRuleBudgetError, withSignalFields } from "./signalRules";
import { parseLogText } from "./parser";
import { decodeLogFilesCooperatively, indexDecodedEvents } from "./parsing/workerDecoding";
import { LOG_SIGNAL_LIMITS } from "./genericSignals";
import { createLogPatternCache, MAX_LOG_PATTERN_INPUT_LENGTH } from "./adminPattern";
export { signalPreviewRequestSchema, signalPreviewResponseSchema } from "./signalRules";

export const SIGNAL_PREVIEW_LIMITS = { maxMs: 100, lines: 5000, hits: 500 } as const;
type Issue = { path: (string | number)[]; message: string };
type Hit = { ruleId: string; lineNumber: number; excerpt: string };

/** The same compiled predicates as worker prefiltering; the watchdog also bounds compilation. */
export async function previewSignalRules(input: { signalRules?: unknown; parsing?: unknown; formatProfile?: unknown },
  sample: { content: string; fileName: string; truncated?: boolean }, options: { maxMs?: number; maxEvaluations?: number; now?: () => number } = {}) {
  const now = options.now ?? (() => performance.now()), maxMs = Math.min(SIGNAL_PREVIEW_LIMITS.maxMs, options.maxMs ?? SIGNAL_PREVIEW_LIMITS.maxMs);
  const deadline = now() + maxMs;
  const hits: Hit[] = [], issues: Issue[] = [];
  let valid = false;
  const capped = (reason: "time_cap" | "line_cap" | "hit_cap" | "event_cap" | "evaluation_cap") => ({ valid,
    issues: valid ? issues : [{ path: ["signalRules"], message: "Signal validation exceeded the preview budget" }], hits, truncated: true, reason });
  if (maxMs <= 0) return capped("time_cap");
  try {
    const validated: ReturnType<typeof logSkillSpecSchema.safeParse> = runInNewContext("validate()", { validate: () => logSkillSpecSchema.safeParse({ schemaVersion: "skill/v1", ...input }) }, { timeout: Math.max(1, Math.ceil(deadline - now())) });
    if (!validated.success) return { valid: false, issues: validated.error.issues.map(({ path, message }: Issue) => ({ path, message })), hits, truncated: false };
    const spec = validated.data;
    if (!spec.signalRules) return { valid: false, issues: [{ path: ["signalRules"], message: "Signal rules are required" }], hits, truncated: false };
    valid = true;
    const allLines = sample.content.split(/\r\n|\n|\r/), lines = allLines.slice(0, SIGNAL_PREVIEW_LIMITS.lines);
    const decoded = spec.parsing ? await decodeLogFilesCooperatively(spec.parsing, [{ file: sample.fileName, lines }],
      { maxMs: Math.max(0, deadline - now()), hardTimeout: true }) : undefined;
    if (decoded?.counts.errors.time_cap || now() >= deadline) return capped("time_cap");
    const events = indexDecodedEvents(decoded?.events ?? []);
    const parsed: ReturnType<typeof parseLogText> = runInNewContext("parse()", { parse: () => parseLogText({ fileName: "sample.log", content: lines.join("\n") }, { profile: spec.formatProfile }) }, { timeout: Math.max(1, Math.ceil(deadline - now())) });
    if (!parsed.ok) throw new ApiError("VALIDATION_FAILED", parsed.reason);
    const cache = createLogPatternCache();
    const compile = () => compileSignalRules(spec.signalRules!, createSignalEvaluationBudget(deadline, Math.min(options.maxEvaluations ?? SIGNAL_RULE_LIMITS.evaluations, SIGNAL_RULE_LIMITS.evaluations), now), cache);
    const rules: ReturnType<typeof compile> = runInNewContext("compile()", { compile }, { timeout: Math.max(1, Math.ceil(deadline - now())) });
    let index = 0, reason: "time_cap" | "hit_cap" | undefined;
    const advance = () => {
      for (let work = 0; index < parsed.entries.length && work < 64; work++, index++) {
        const entry = parsed.entries[index];
        const enriched = withSignalFields(entry, events.get(JSON.stringify([sample.fileName, entry.lineNumber])));
        for (const { rule, matches } of rules) {
          if (now() >= deadline) { reason = "time_cap"; return; }
          if (!matches.map((test) => test(enriched)).some(Boolean)) continue;
          if (hits.length === SIGNAL_PREVIEW_LIMITS.hits) { reason = "hit_cap"; return; }
          hits.push({ ruleId: rule.id, lineNumber: entry.lineNumber, excerpt: lines[entry.lineNumber - 1].slice(0, LOG_SIGNAL_LIMITS.contentChars) });
        }
      }
    };
    const watchdog = new Script("advance()"), context = createContext({ advance });
    while (index < parsed.entries.length && !reason) {
      await setImmediate();
      if (now() >= deadline) return capped("time_cap");
      watchdog.runInContext(context, { timeout: Math.max(1, Math.ceil(deadline - now())) });
    }
    if (reason) return capped(reason);
    if (decoded?.counts.errors.event_cap) return capped("event_cap");
    return decoded?.counts.errors.line_cap || decoded?.counts.errors.match_input_cap || sample.truncated || allLines.length > SIGNAL_PREVIEW_LIMITS.lines || parsed.entries.some((entry) =>
      `${entry.message} ${Object.entries(entry.tokens).map(([key, value]) => `${key}=${value}`).join(" ")}`.length > MAX_LOG_PATTERN_INPUT_LENGTH)
      ? capped("line_cap") : { valid: true, issues, hits, truncated: false };
  } catch (error) {
    if (error instanceof SignalRuleBudgetError) return capped(error.reason);
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return capped("time_cap");
    throw error;
  }
}

export async function previewLogSkillSignals(db: Database, store: ObjectStore, auth: AuthContext, skillId: string,
  input: { signalRules?: unknown; parsing?: unknown; formatProfile?: unknown }) {
  requireLogAdminDomains(auth);
  const sample = await getLogSkillSample(db, store, auth, skillId);
  if (!sample) throw new ApiError("VALIDATION_FAILED", "Attach a skill sample before previewing signals.");
  return previewSignalRules(input, sample);
}
