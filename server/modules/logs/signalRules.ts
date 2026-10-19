import { z } from "zod";

import type { ParsedLogEntry } from "./parser";
import { compileLogPattern, MAX_LOG_PATTERN_LENGTH, type LogPattern } from "./adminPattern";

export const MAX_SIGNAL_RULES = 64;
export const MAX_SIGNAL_CONDITIONS_PER_RULE = 16;
export const MAX_SIGNAL_CONDITIONS = 256;
export const MAX_SIGNAL_TOKEN_NAMES = 16;
export const MAX_SIGNAL_TOKEN_NAME_CHARS = 100;
export const MAX_SIGNAL_TOTAL_PATTERN_CHARS = 64 * 1024;
export const MAX_SIGNAL_TEXT_CHARS = 4096;
export const MAX_SIGNAL_ACTIONS = 32;

/** Reject oversized graphs before Zod visits children or compiles any pattern. */
function preflightSignalRules(value: unknown, ctx: z.RefinementCtx) {
  if (!value || typeof value !== "object" || !("rules" in value) || !Array.isArray(value.rules)) return value;
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: "custom", path, message, fatal: true });
    return z.NEVER;
  };
  if (value.rules.length > MAX_SIGNAL_RULES) return issue(["rules"], `At most ${MAX_SIGNAL_RULES} signal rules`);
  let conditions = 0, patternChars = 0;
  for (const [index, rule] of value.rules.entries()) {
    if (!rule || typeof rule !== "object") continue;
    if (Array.isArray(rule.analysis?.suggestedActions) && rule.analysis.suggestedActions.length > MAX_SIGNAL_ACTIONS)
      return issue(["rules", index, "analysis", "suggestedActions"], `At most ${MAX_SIGNAL_ACTIONS} suggested actions`);
    if (!Array.isArray(rule.anyOf)) continue;
    if (rule.anyOf.length > MAX_SIGNAL_CONDITIONS_PER_RULE)
      return issue(["rules", index, "anyOf"], `At most ${MAX_SIGNAL_CONDITIONS_PER_RULE} conditions per rule`);
    conditions += rule.anyOf.length;
    if (conditions > MAX_SIGNAL_CONDITIONS) return issue(["rules", index, "anyOf"], `At most ${MAX_SIGNAL_CONDITIONS} signal conditions in total`);
    for (const [conditionIndex, condition] of rule.anyOf.entries()) {
      if (!condition || typeof condition !== "object") continue;
      const path = ["rules", index, "anyOf", conditionIndex];
      if (typeof condition.pattern === "string") {
        if (condition.pattern.length > MAX_LOG_PATTERN_LENGTH)
          return issue([...path, "pattern"], `LogPatternError: Pattern exceeds ${MAX_LOG_PATTERN_LENGTH} UTF-16 code units.`);
        patternChars += condition.pattern.length;
        if (patternChars > MAX_SIGNAL_TOTAL_PATTERN_CHARS)
          return issue([...path, "pattern"], `Signal patterns exceed ${MAX_SIGNAL_TOTAL_PATTERN_CHARS} UTF-16 code units in total`);
      }
      if (typeof condition.flags === "string" && condition.flags.length > 3)
        return issue([...path, "flags"], "LogPatternError: At most three regular expression flags (i/m/s)");
      if (typeof condition.token === "string" && condition.token.length > MAX_SIGNAL_TOKEN_NAME_CHARS)
        return issue([...path, "token"], `Token names must not exceed ${MAX_SIGNAL_TOKEN_NAME_CHARS} characters`);
      for (const side of ["leftTokens", "rightTokens"] as const) {
        if (!Array.isArray(condition[side])) continue;
        if (condition[side].length > MAX_SIGNAL_TOKEN_NAMES)
          return issue([...path, side], `At most ${MAX_SIGNAL_TOKEN_NAMES} token names`);
        for (const [tokenIndex, token] of condition[side].entries()) {
          if (typeof token === "string" && token.length > MAX_SIGNAL_TOKEN_NAME_CHARS)
            return issue([...path, side, tokenIndex], `Token names must not exceed ${MAX_SIGNAL_TOKEN_NAME_CHARS} characters`);
        }
      }
    }
  }
  for (const name of ["noHit", "hitDefaults"] as const) {
    const defaults = (value as Record<string, unknown>)[name];
    if (defaults && typeof defaults === "object" && "suggestedActions" in defaults && Array.isArray(defaults.suggestedActions)
      && defaults.suggestedActions.length > MAX_SIGNAL_ACTIONS)
      return issue([name, "suggestedActions"], `At most ${MAX_SIGNAL_ACTIONS} suggested actions`);
  }
  return value;
}

/** The single compilation seam for signal-rule patterns. */
export function compileSignalPattern(pattern: string, flags?: string): LogPattern {
  return compileLogPattern(pattern, flags);
}

const textConditionSchema = z.object({
  type: z.literal("text"),
  pattern: z.string().max(MAX_LOG_PATTERN_LENGTH),
  flags: z.string().max(3).optional()
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

const tokenNamesSchema = z.array(z.string().min(1).max(MAX_SIGNAL_TOKEN_NAME_CHARS)).min(1).max(MAX_SIGNAL_TOKEN_NAMES);
export const signalConditionSchema = z.union([
  textConditionSchema,
  z.object({
    type: z.literal("numericComparison"),
    leftTokens: tokenNamesSchema,
    operator: z.enum(["lt", "lte", "eq", "neq", "gte", "gt"]),
    rightTokens: tokenNamesSchema
  }).strict(),
  z.object({
    type: z.literal("severityToken"),
    severity: z.enum(["error", "warn", "info"]),
    token: z.string().min(1).max(MAX_SIGNAL_TOKEN_NAME_CHARS)
  }).strict()
]);

const prioritySchema = z.number().finite();
const ranked = <T extends z.ZodTypeAny>(value: T) => z.object({
  value,
  /** Lower priorities win; ties retain rule/array order. */
  priority: prioritySchema,
  requiresErrorEvidence: z.boolean().optional()
}).strict();
const severitySchema = z.enum(["Critical", "Warning", "Info"]);
const confidenceSchema = z.number().min(0).max(1);
const textSchema = z.string().min(1).max(MAX_SIGNAL_TEXT_CHARS);
const defaultsSchema = z.object({
  conclusion: textSchema,
  impact: textSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  suggestedActions: z.array(textSchema).max(MAX_SIGNAL_ACTIONS)
}).strict();

export const signalRuleSetSchema = z.preprocess(preflightSignalRules, z.object({
  rules: z.array(z.object({
    id: textSchema.max(200),
    anyOf: z.array(signalConditionSchema).min(1).max(MAX_SIGNAL_CONDITIONS_PER_RULE),
    stageId: z.enum(["pattern", "rootcause"]),
    inference: textSchema,
    suggestedAction: textSchema,
    analysis: z.object({
      conclusion: ranked(textSchema).optional(),
      impact: ranked(textSchema).optional(),
      severity: ranked(severitySchema).optional(),
      confidence: ranked(confidenceSchema).optional(),
      suggestedActions: z.array(ranked(textSchema)).max(MAX_SIGNAL_ACTIONS)
    }).strict()
  }).strict()).max(MAX_SIGNAL_RULES),
  noHit: defaultsSchema,
  hitDefaults: defaultsSchema
}).strict().superRefine((ruleSet, ctx) => {
  const ids = new Set<string>();
  ruleSet.rules.forEach((rule, index) => {
    if (ids.has(rule.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", index, "id"], message: "Duplicate rule id" });
    }
    ids.add(rule.id);
  });
}));

export type SignalRuleSet = z.infer<typeof signalRuleSetSchema>;
export type SignalCondition = z.infer<typeof signalConditionSchema>;

/** Compile once per evidence collection, never once per log line. */
export function compileSignalCondition(condition: SignalCondition, maxInputChars?: number): (entry: ParsedLogEntry) => boolean {
  switch (condition.type) {
    case "text": {
      const pattern = compileSignalPattern(condition.pattern, condition.flags);
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

function numericToken(entry: ParsedLogEntry, names: string[], maxInputChars?: number): number | undefined {
  const value = names.map((name) => entry.tokens[name]).find((token) => token !== undefined && token !== null);
  if (value === undefined) return undefined;
  if (maxInputChars !== undefined && value.length > maxInputChars) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
