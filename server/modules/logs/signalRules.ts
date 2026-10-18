import { z } from "zod";

import type { ParsedLogEntry } from "./parser";

/** The single compilation seam for signal-rule patterns. */
export function compileSignalPattern(pattern: string, flags?: string): RegExp {
  return new RegExp(pattern, flags);
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
    token: z.string().min(1)
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
const textSchema = z.string().min(1);
const defaultsSchema = z.object({
  conclusion: textSchema,
  impact: textSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  suggestedActions: z.array(textSchema)
}).strict();

export const signalRuleSetSchema = z.object({
  rules: z.array(z.object({
    id: textSchema,
    anyOf: z.array(signalConditionSchema).min(1),
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
  }).strict()),
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
});

export type SignalRuleSet = z.infer<typeof signalRuleSetSchema>;
export type SignalCondition = z.infer<typeof signalConditionSchema>;

/** Compile once per evidence collection, never once per log line. */
export function compileSignalCondition(condition: SignalCondition): (entry: ParsedLogEntry) => boolean {
  switch (condition.type) {
    case "text": {
      const pattern = compileSignalPattern(condition.pattern, condition.flags);
      return (entry) => {
        const searchable = `${entry.message} ${Object.entries(entry.tokens)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ")}`;
        pattern.lastIndex = 0;
        return pattern.test(searchable);
      };
    }
    case "numericComparison":
      return (entry) => {
        // Fall back only for absent tokens, not empty or non-numeric values.
        const left = numericToken(entry, condition.leftTokens);
        const right = numericToken(entry, condition.rightTokens);
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

function numericToken(entry: ParsedLogEntry, names: string[]): number | undefined {
  const value = names.map((name) => entry.tokens[name]).find((token) => token !== undefined && token !== null);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
