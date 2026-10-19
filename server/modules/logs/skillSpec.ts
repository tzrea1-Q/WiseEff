import { z } from "zod";
import { validatedLogFormatProfileSchema } from "./formatProfile";
import { withLogPatternBudget } from "./patternBudget";
import { preflightSignalRules, signalRuleSetSchema } from "./signalRules";
import { parsingSpecSchema } from "./parsing/spec";
import { listSignalFields } from "./parsing/signalFields";
import { MAX_LOG_PATTERN_LENGTH } from "./adminPattern";
import { compileSourceStatementPattern, MAX_STATEMENT_PATTERNS } from "./sourceStatements";
import { parseTestsSchema } from "./parseTestSpec";

export const logSkillSpecSchema = z.preprocess((value, ctx) => {
  // Bound signal graphs before the whole-skill program budget walks any patterns.
  if (value && typeof value === "object" && "signalRules" in value
    && preflightSignalRules(value.signalRules, ctx, ["signalRules"]) === z.NEVER) return z.NEVER;
  return value;
}, withLogPatternBudget(z.object({
  schemaVersion: z.literal("skill/v1"),
  knowledgeEntryIds: z.array(z.string().uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "Knowledge links must be unique").optional(),
  parsing: parsingSpecSchema.optional(),
  parseTests: parseTestsSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  procedure: z.string().trim().max(20000).optional(),
  formatProfile: validatedLogFormatProfileSchema.optional(),
  modelOverride: z.string().trim().min(1).max(200).optional(),
  stepBudget: z.number().int().positive().optional(),
  tokenBudget: z.number().int().positive().optional(),
  defaultSourceSnapshotId: z.string().min(1).max(200).optional(),
  source: z.object({
    statementPatterns: z.array(z.string().min(1).max(MAX_LOG_PATTERN_LENGTH).superRefine((pattern, ctx) => {
      try { compileSourceStatementPattern(pattern); }
      catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) }); }
    })).max(MAX_STATEMENT_PATTERNS).optional()
  }).strict().optional(),
  signalRules: signalRuleSetSchema.optional()
}).strict().superRefine((spec, ctx) => {
  spec.signalRules?.rules.forEach((rule, ruleIndex) => rule.anyOf.forEach((input, conditionIndex) => {
    const condition = input.type === "window" ? input.condition : input;
    if (condition.type !== "field") return;
    const path = ["signalRules", "rules", ruleIndex, "anyOf", conditionIndex, ...(input.type === "window" ? ["condition"] : [])];
    const field = listSignalFields(spec.parsing, condition.field).fields[0];
    const issue = (key: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, key], message });
    if (!field) { issue("field", "Unknown scalar extracted or decoded field"); return; }
    if (condition.operator === "range" && field.type !== "number") issue("operator", "Ranges require a numeric field");
    const expected = field.type;
    if (condition.operator === "equals" && typeof condition.value !== expected) issue("value", `Expected a ${expected} comparison value`);
    if (condition.operator === "in" && condition.values?.some((value) => typeof value !== expected)) issue("values", `Expected ${expected} set members`);
  }));
}), "skill"));

export type LogSkillSpec = z.infer<typeof logSkillSpecSchema>;
export const parseTestRequestSchema = z.object({ spec: logSkillSpecSchema }).strict();
