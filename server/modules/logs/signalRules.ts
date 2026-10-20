import { z } from "zod";

import type { ParsedLogEntry } from "./parser";
import { compileLogPattern, createLogPatternCache, MAX_LOG_PATTERN_LENGTH, type LogPattern, type LogPatternCache } from "./adminPattern";
import { withLogPatternBudget } from "./patternBudget";
import type { DecodedEvent, DecodedValue } from "./parsing/spec";

export const SIGNAL_RULE_LIMITS = { rules: 64, conditions: 16, totalConditions: 256, windows: 16, windowTimestamps: 160_000, evaluations: 2_000_000 } as const;
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

export const MAX_SIGNAL_RULES = SIGNAL_RULE_LIMITS.rules;
export const MAX_SIGNAL_CONDITIONS_PER_RULE = SIGNAL_RULE_LIMITS.conditions;
export const MAX_SIGNAL_CONDITIONS = SIGNAL_RULE_LIMITS.totalConditions;
export const MAX_SIGNAL_TOKEN_NAMES = 16;
export const MAX_SIGNAL_TOKEN_NAME_CHARS = 100;
export const MAX_SIGNAL_TOTAL_PATTERN_CHARS = 64 * 1024;
export const MAX_SIGNAL_TEXT_CHARS = 4096;
export const MAX_SIGNAL_ACTIONS = 32;

/** Reject oversized graphs before Zod visits children or compiles any pattern. */
export function preflightSignalRules(value: unknown, ctx: z.RefinementCtx, prefix: (string | number)[] = []) {
  if (!value || typeof value !== "object" || !("rules" in value) || !Array.isArray(value.rules)) return value;
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: "custom", path: [...prefix, ...path], message, fatal: true });
    return z.NEVER;
  };
  if (value.rules.length > MAX_SIGNAL_RULES) return issue(["rules"], `最多允许 ${MAX_SIGNAL_RULES} 条信号规则`);
  let conditions = 0, patternChars = 0, windows = 0;
  for (const [index, rule] of value.rules.entries()) {
    if (!rule || typeof rule !== "object") continue;
    if (Array.isArray(rule.analysis?.suggestedActions) && rule.analysis.suggestedActions.length > MAX_SIGNAL_ACTIONS)
      return issue(["rules", index, "analysis", "suggestedActions"], `最多允许 ${MAX_SIGNAL_ACTIONS} 条建议操作`);
    if (!Array.isArray(rule.anyOf)) continue;
    if (rule.anyOf.length > MAX_SIGNAL_CONDITIONS_PER_RULE)
      return issue(["rules", index, "anyOf"], `每条规则最多允许 ${MAX_SIGNAL_CONDITIONS_PER_RULE} 个条件`);
    conditions += rule.anyOf.length;
    if (conditions > MAX_SIGNAL_CONDITIONS) return issue(["rules", index, "anyOf"], `信号条件合计不能超过 ${MAX_SIGNAL_CONDITIONS} 个`);
    for (const [conditionIndex, input] of rule.anyOf.entries()) {
      if (!input || typeof input !== "object") continue;
      const path = ["rules", index, "anyOf", conditionIndex];
      if (input.type === "window") {
        if (++windows > SIGNAL_RULE_LIMITS.windows)
          return issue(path, `每个技能最多允许 ${SIGNAL_RULE_LIMITS.windows} 个时间窗口条件`);
        path.push("condition");
      }
      const condition = input.type === "window" ? input.condition : input;
      if (!condition || typeof condition !== "object") continue;
      if (condition.type === "field" && Array.isArray(condition.values) && condition.values.length > 256)
        return issue([...path, "values"], "集合最多允许 256 个成员");
      if (typeof condition.pattern === "string") {
        if (condition.pattern.length > MAX_LOG_PATTERN_LENGTH)
          return issue([...path, "pattern"], `匹配表达式超过 ${MAX_LOG_PATTERN_LENGTH} 个 UTF-16 代码单元上限。`);
        patternChars += condition.pattern.length;
        if (patternChars > MAX_SIGNAL_TOTAL_PATTERN_CHARS)
          return issue([...path, "pattern"], `信号匹配表达式合计超过 ${MAX_SIGNAL_TOTAL_PATTERN_CHARS} 个 UTF-16 代码单元上限`);
      }
      if (typeof condition.flags === "string" && condition.flags.length > 3)
        return issue([...path, "flags"], "正则表达式最多允许三个标记（i/m/s）");
      if (typeof condition.token === "string" && condition.token.length > MAX_SIGNAL_TOKEN_NAME_CHARS)
        return issue([...path, "token"], `字段名称不能超过 ${MAX_SIGNAL_TOKEN_NAME_CHARS} 个字符`);
      for (const side of ["leftTokens", "rightTokens"] as const) {
        if (!Array.isArray(condition[side])) continue;
        if (condition[side].length > MAX_SIGNAL_TOKEN_NAMES)
          return issue([...path, side], `最多允许 ${MAX_SIGNAL_TOKEN_NAMES} 个字段名称`);
        for (const [tokenIndex, token] of condition[side].entries()) {
          if (typeof token === "string" && token.length > MAX_SIGNAL_TOKEN_NAME_CHARS)
            return issue([...path, side, tokenIndex], `字段名称不能超过 ${MAX_SIGNAL_TOKEN_NAME_CHARS} 个字符`);
        }
      }
    }
  }
  for (const name of ["noHit", "hitDefaults"] as const) {
    const defaults = (value as Record<string, unknown>)[name];
    if (defaults && typeof defaults === "object" && "suggestedActions" in defaults && Array.isArray(defaults.suggestedActions)
      && defaults.suggestedActions.length > MAX_SIGNAL_ACTIONS)
      return issue([name, "suggestedActions"], `最多允许 ${MAX_SIGNAL_ACTIONS} 条建议操作`);
  }
  return value;
}

/** The single compilation seam for signal-rule patterns. */
export function compileSignalPattern(pattern: string, flags?: string, cache?: LogPatternCache): LogPattern {
  return compileLogPattern(pattern, flags, undefined, cache);
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
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const fieldConditionSchema = z.object({
  type: z.literal("field"), field: z.string().min(1).max(256),
  operator: z.enum(["equals", "range", "in"]),
  value: scalarSchema.optional(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  values: z.array(scalarSchema).max(256).optional()
}).strict().superRefine((condition, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (condition.operator === "equals" && condition.value === undefined) issue("value", "请填写比较值");
  if (condition.operator === "in" && !condition.values?.length) issue("values", "请至少填写一个集合成员");
  if (condition.operator === "range") {
    if (condition.min === undefined) issue("min", "请填写数值下限");
    if (condition.max === undefined) issue("max", "请填写数值上限");
    if (condition.min !== undefined && condition.max !== undefined && condition.min > condition.max) issue("max", "上限不能小于下限");
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
    token: z.string().min(1).max(MAX_SIGNAL_TOKEN_NAME_CHARS)
  }).strict()
] as const;
export const signalConditionSchema = z.unknown().transform((input, ctx) => {
  const type = input && typeof input === "object" && "type" in input ? input.type : undefined;
  const index = ["text", "field", "window", "numericComparison", "severityToken"].indexOf(String(type));
  if (index < 0) { ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["type"], message: "信号条件类型无效" }); return z.NEVER; }
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
const textSchema = z.string().min(1).max(MAX_SIGNAL_TEXT_CHARS);
const defaultsSchema = z.object({
  conclusion: textSchema,
  impact: textSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  suggestedActions: z.array(textSchema).max(MAX_SIGNAL_ACTIONS)
}).strict();

export const signalRuleSetSchema = z.preprocess(preflightSignalRules, withLogPatternBudget(z.object({
  rules: z.array(z.object({
    id: textSchema.max(200),
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
      suggestedActions: z.array(ranked(textSchema)).max(MAX_SIGNAL_ACTIONS)
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
        code: z.ZodIssueCode.custom, path: ["rules", index, "anyOf", conditionIndex], message: `每个技能最多允许 ${SIGNAL_RULE_LIMITS.windows} 个时间窗口条件`
      });
    });
    if (ids.has(rule.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rules", index, "id"], message: "规则标识重复" });
    }
    ids.add(rule.id);
  });
}), "signals"));

export type SignalRuleSet = z.infer<typeof signalRuleSetSchema>;
export type SignalCondition = z.infer<typeof signalConditionSchema>;

export const signalPreviewRequestSchema = z.object({ signalRules: z.unknown(), parsing: z.unknown().optional(), formatProfile: z.unknown().optional(), files: z.unknown().optional() }).strict();
export const signalPreviewResponseSchema = z.object({
  valid: z.boolean(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
  hits: z.array(z.object({ ruleId: z.string(), lineNumber: z.number().int().positive(), excerpt: z.string() })),
  truncated: z.boolean(), reason: z.enum(["time_cap", "line_cap", "hit_cap", "event_cap", "evaluation_cap"]).optional()
});

/** Each file/pass owns its rings; evaluations and the deadline are shared across passes. */
export function compileSignalRules(ruleSet: SignalRuleSet, budget = createSignalEvaluationBudget(), cache = createLogPatternCache()) {
  const state = { windows: 0, slots: 0 };
  if (ruleSet.rules.length > SIGNAL_RULE_LIMITS.rules
    || ruleSet.rules.reduce((total, rule) => total + rule.anyOf.length, 0) > SIGNAL_RULE_LIMITS.totalConditions)
    throw new SignalRuleBudgetError("evaluation_cap");
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
    case "field": {
      const [extractor, name, ...parts] = condition.field.split(".");
      const compare = (value: unknown) => {
        if (value === undefined) return false;
        if (condition.operator === "equals") return value === condition.value;
        if (condition.operator === "in") return condition.values!.some((member) => member === value);
        return typeof value === "number" && value >= condition.min! && value <= condition.max!;
      };
      const matches = (node: DecodedValue | undefined, offset: number, event: DecodedEvent, errorPath: string): boolean => {
        checkSignalEvaluationBudget(budget);
        // Checksum diagnostics may name only the leaf; its node carries the exact validity.
        if (node === undefined || node && typeof node === "object" && "checksum" in node && node.checksum?.ok === false
          || event.errors?.some((error) => error.code !== "checksum_mismatch" && error.field === errorPath)) return false;
        if (offset === parts.length) return compare(node && typeof node === "object" && "value" in node ? node.value : node);
        if (!node || typeof node !== "object" || !("value" in node)) return false;
        const part = parts[offset];
        if (offset === parts.length - 1 && (part === "value" || part === "meaning")) return compare(node[part]);
        if (part !== "fields" || !node.fields || offset + 1 >= parts.length) return false;
        const child = parts[offset + 1];
        if (child === "*") {
          for (const key in node.fields) {
            if (Object.hasOwn(node.fields, key) && matches(node.fields[key], offset + 2, event, `${errorPath}.${key}`)) return true;
          }
          return false;
        }
        return Object.hasOwn(node.fields, child) && matches(node.fields[child], offset + 2, event, `${errorPath}.${child}`);
      };
      return (entry) => {
        if (!entry.signalEvents) return compare(entry.signalFields?.[condition.field]);
        return entry.signalEvents.some((event) => {
          checkSignalEvaluationBudget(budget);
          return event.extractor === extractor && Object.hasOwn(event.fields, name) && matches(event.fields[name], 0, event, name);
        });
      };
    }
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

/** Keep the bounded event tree; predicates traverse only their compiled path under the shared budget. */
export function withSignalFields(entry: ParsedLogEntry, events: readonly DecodedEvent[] = []): ParsedLogEntry {
  return { ...entry, signalEvents: events };
}

function numericToken(entry: ParsedLogEntry, names: string[], maxInputChars?: number): number | undefined {
  const value = names.map((name) => entry.tokens[name]).find((token) => token !== undefined && token !== null);
  if (value === undefined) return undefined;
  if (maxInputChars !== undefined && value.length > maxInputChars) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
