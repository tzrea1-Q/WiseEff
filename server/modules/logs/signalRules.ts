import { z } from "zod";

import type { ParsedLogEntry } from "./parser";
import { compileLogPattern, createLogPatternCache, type LogPattern, type LogPatternCache } from "./adminPattern";
import { withLogPatternBudget } from "./patternBudget";
import type { DecodedEvent } from "./parsing/spec";

export const SIGNAL_RULE_LIMITS = { rules: 64, conditions: 16, windows: 16, windowTimestamps: 160_000, evaluations: 2_000_000 } as const;
export function createSignalEvaluationBudget(deadline = performance.now() + 10_000, evaluations: number = SIGNAL_RULE_LIMITS.evaluations, now = () => performance.now()) {
  return { deadline, remaining: evaluations, now };
}
export type SignalEvaluationBudget = ReturnType<typeof createSignalEvaluationBudget>;
export class SignalRuleBudgetError extends Error {
  constructor(readonly reason: "time_cap" | "evaluation_cap") { super(`Signal rules exceeded ${reason}`); }
}
export function checkSignalEvaluationBudget(budget: SignalEvaluationBudget) {
  if (budget.now() >= budget.deadline) throw new SignalRuleBudgetError("time_cap");
  if (--budget.remaining < 0) throw new SignalRuleBudgetError("evaluation_cap");
}

/** The single compilation seam for signal-rule patterns. */
export function compileSignalPattern(pattern: string, flags?: string, cache?: LogPatternCache): LogPattern {
  return compileLogPattern(pattern, flags, undefined, cache);
}

const textConditionSchema = z.object({
  type: z.literal("text"),
  pattern: z.string(),
  flags: z.string().optional()
}).strict().superRefine((condition, ctx) => {
  try {
    compileSignalPattern("", condition.flags);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["flags"], message: String(error) });
    return;
  }
  try {
    compileSignalPattern(condition.pattern, condition.flags);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: String(error) });
  }
});

const tokenNamesSchema = z.array(z.string().min(1)).min(1);
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const fieldConditionSchema = z.object({
  type: z.literal("field"), field: z.string().min(1).max(256),
  operator: z.enum(["equals", "range", "in"]),
  value: scalarSchema.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  values: z.array(scalarSchema).max(256).optional()
}).strict().superRefine((condition, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (condition.operator === "equals" && condition.value === undefined) issue("value", "A comparison value is required");
  if (condition.operator === "in" && !condition.values?.length) issue("values", "At least one set member is required");
  if (condition.operator === "range") {
    if (condition.min === undefined) issue("min", "A numeric lower bound is required");
    if (condition.max === undefined) issue("max", "A numeric upper bound is required");
    if (condition.min !== undefined && condition.max !== undefined && condition.min > condition.max) issue("max", "Upper bound must be at least the lower bound");
  }
});
const textOrFieldSchema = z.unknown().transform((input, ctx) => {
  const schema = input && typeof input === "object" && "type" in input && input.type === "field" ? fieldConditionSchema : textConditionSchema;
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  for (const issue of result.error.issues) ctx.addIssue(issue);
  return z.NEVER;
}).pipe(z.union([textConditionSchema, fieldConditionSchema]));
const windowConditionSchema = z.object({
  type: z.literal("window"), condition: textOrFieldSchema,
  count: z.number().int().min(1).max(10000), seconds: z.number().finite().positive().max(86400)
}).strict();
const conditionSchemas = [
  textConditionSchema,
  fieldConditionSchema,
  windowConditionSchema,
  z.object({
    type: z.literal("numericComparison"),
    leftTokens: tokenNamesSchema,
    operator: z.enum(["lt", "lte", "eq", "neq", "gte", "gt"]),
    rightTokens: tokenNamesSchema
  }).strict(),
  z.object({
    type: z.literal("severityToken"),
    severity: z.enum(["error", "warn", "info"]),
    token: z.string().min(1)
  }).strict()
] as const;
export const signalConditionSchema = z.unknown().transform((input, ctx) => {
  const type = input && typeof input === "object" && "type" in input ? input.type : undefined;
  const index = ["text", "field", "window", "numericComparison", "severityToken"].indexOf(String(type));
  if (index < 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: "Unknown signal condition type" }); return z.NEVER; }
  const result = conditionSchemas[index].safeParse(input);
  if (result.success) return result.data;
  for (const issue of result.error.issues) ctx.addIssue(issue);
  return z.NEVER;
}).pipe(z.union(conditionSchemas));

const prioritySchema = z.number().finite();
const ranked = <T extends z.ZodTypeAny>(value: T) => z.object({
  value,
  /** Lower priorities win; ties retain rule/array order. */
  priority: prioritySchema,
  requiresErrorEvidence: z.boolean().optional()
}).strict();
const severitySchema = z.enum(["Critical", "Warning", "Info"]);
const confidenceSchema = z.number().min(0).max(1);
const textSchema = z.string().min(1);
const defaultsSchema = z.object({
  conclusion: textSchema,
  impact: textSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  suggestedActions: z.array(textSchema)
}).strict();

export const signalRuleSetSchema = withLogPatternBudget(z.object({
  rules: z.array(z.object({
    id: textSchema,
    name: z.string().min(1).max(200).optional(),
    severity: severitySchema.optional(),
    anyOf: z.array(signalConditionSchema).min(1).max(SIGNAL_RULE_LIMITS.conditions),
    stageId: z.enum(["pattern", "rootcause"]),
    inference: textSchema,
    suggestedAction: textSchema,
    analysis: z.object({
      conclusion: ranked(textSchema).optional(),
      impact: ranked(textSchema).optional(),
      severity: ranked(severitySchema).optional(),
      confidence: ranked(confidenceSchema).optional(),
      suggestedActions: z.array(ranked(textSchema))
    }).strict()
  }).strict()).max(SIGNAL_RULE_LIMITS.rules),
  noHit: defaultsSchema,
  hitDefaults: defaultsSchema
}).strict().superRefine((ruleSet, ctx) => {
  const ids = new Set<string>();
  let windows = 0;
  ruleSet.rules.forEach((rule, index) => {
    rule.anyOf.forEach((condition, conditionIndex) => {
      if (condition.type === "window" && ++windows > SIGNAL_RULE_LIMITS.windows) ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["rules", index, "anyOf", conditionIndex], message: "At most 16 window conditions are allowed per skill"
      });
    });
    if (ids.has(rule.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", index, "id"], message: "Duplicate rule id" });
    }
    ids.add(rule.id);
  });
}), "signals");

export type SignalRuleSet = z.infer<typeof signalRuleSetSchema>;
export type SignalCondition = z.infer<typeof signalConditionSchema>;

export const signalPreviewRequestSchema = z.object({ signalRules: z.unknown(), parsing: z.unknown().optional(), formatProfile: z.unknown().optional() }).strict();
export const signalPreviewResponseSchema = z.object({
  valid: z.boolean(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
  hits: z.array(z.object({ ruleId: z.string(), lineNumber: z.number().int().positive(), excerpt: z.string() })),
  truncated: z.boolean(), reason: z.enum(["time_cap", "line_cap", "hit_cap", "event_cap", "evaluation_cap"]).optional()
});

/** Each file/pass owns its rings; evaluations and the deadline are shared across passes. */
export function compileSignalRules(ruleSet: SignalRuleSet, budget = createSignalEvaluationBudget(), cache = createLogPatternCache()) {
  const state = { windows: 0, slots: 0 };
  if (ruleSet.rules.length > SIGNAL_RULE_LIMITS.rules) throw new SignalRuleBudgetError("evaluation_cap");
  return ruleSet.rules.map((rule) => {
    checkSignalEvaluationBudget(budget);
    if (rule.anyOf.length > SIGNAL_RULE_LIMITS.conditions) throw new SignalRuleBudgetError("evaluation_cap");
    return { rule, matches: rule.anyOf.map((condition) => compileSignalCondition(condition, undefined, budget, cache, state)) };
  });
}

/** Compile once per evidence collection, never once per log line. */
export function compileSignalCondition(condition: SignalCondition, maxInputChars?: number, budget = createSignalEvaluationBudget(), cache = createLogPatternCache(), state = { windows: 0, slots: 0 }): (entry: ParsedLogEntry) => boolean {
  checkSignalEvaluationBudget(budget);
  const test = compileCondition(condition, maxInputChars, budget, cache, state);
  return (entry) => { checkSignalEvaluationBudget(budget); return test(entry); };
}
function compileCondition(condition: SignalCondition, maxInputChars: number | undefined, budget: SignalEvaluationBudget, cache: LogPatternCache, state: { windows: number; slots: number }): (entry: ParsedLogEntry) => boolean {
  switch (condition.type) {
    case "field":
      return (entry) => {
        const value = entry.signalFields?.[condition.field];
        if (value === undefined) return false;
        if (condition.operator === "equals") return value === condition.value;
        if (condition.operator === "in") return condition.values!.includes(value);
        return typeof value === "number" && value >= condition.min! && value <= condition.max!;
      };
    case "window": {
      state.windows++; state.slots += condition.count;
      if (state.windows > SIGNAL_RULE_LIMITS.windows || !Number.isSafeInteger(condition.count) || condition.count <= 0 || state.slots > SIGNAL_RULE_LIMITS.windowTimestamps) throw new SignalRuleBudgetError("evaluation_cap");
      const matches = compileSignalCondition(condition.condition, maxInputChars, budget, cache, state);
      const times = new Float64Array(condition.count);
      let size = 0, next = 0;
      let previous = -Infinity;
      return (entry) => {
        const time = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
        if (!Number.isFinite(time)) return false;
        if (time < previous) { size = 0; next = 0; }
        previous = time;
        if (!matches(entry)) return false;
        times[next] = time;
        next = (next + 1) % times.length;
        size = Math.min(size + 1, times.length);
        return size === times.length && time - times[next] <= condition.seconds * 1000;
      };
    }
    case "text": {
      const pattern = compileSignalPattern(condition.pattern, condition.flags, cache);
      return (entry) => {
        if (maxInputChars !== undefined) {
          let searchable = entry.message.slice(0, maxInputChars);
          for (const key in entry.tokens) {
            const remaining = maxInputChars - searchable.length;
            if (remaining <= 0) break;
            if (Object.hasOwn(entry.tokens, key)) searchable += ` ${key.slice(0, remaining)}=${entry.tokens[key].slice(0, remaining)}`.slice(0, remaining);
          }
          return pattern.test(searchable);
        }
        const searchable = `${entry.message} ${Object.entries(entry.tokens)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")}`;
        return pattern.test(searchable);
      };
    }
    case "numericComparison":
      return (entry) => {
        // Fall back only for absent tokens, not empty or non-numeric values.
        const left = numericToken(entry, condition.leftTokens, maxInputChars);
        const right = numericToken(entry, condition.rightTokens, maxInputChars);
        if (left === undefined || right === undefined) return false;
        switch (condition.operator) {
          case "lt": return left < right;
          case "lte": return left <= right;
          case "eq": return left === right;
          case "neq": return left !== right;
          case "gte": return left >= right;
          case "gt": return left > right;
        }
      };
    case "severityToken":
      return (entry) => entry.severity === condition.severity
        && typeof entry.tokens[condition.token] === "string" && entry.tokens[condition.token].length > 0;
  }
}

/** Add only successfully decoded, typed fields; parser tokens are not extracted fields. */
export function withSignalFields(entry: ParsedLogEntry, events: readonly DecodedEvent[] = []): ParsedLogEntry {
  const fields: NonNullable<ParsedLogEntry["signalFields"]> = Object.create(null);
  for (const event of events) for (const [name, decoded] of Object.entries(event.fields)) {
    if (event.errors?.some((error) => error.field === name)) continue;
    const value = decoded && typeof decoded === "object" && "value" in decoded ? decoded.value : decoded;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") fields[`${event.extractor}.${name}`] = value;
  }
  return { ...entry, signalFields: fields };
}

function numericToken(entry: ParsedLogEntry, names: string[], maxInputChars?: number): number | undefined {
  const value = names.map((name) => entry.tokens[name]).find((token) => token !== undefined && token !== null);
  if (value === undefined) return undefined;
  if (maxInputChars !== undefined && value.length > maxInputChars) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
