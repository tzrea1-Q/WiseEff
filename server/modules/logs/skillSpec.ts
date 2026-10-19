import { z } from "zod";
import { logFormatProfileSchema, validateLogFormatProfile } from "./formatProfile";
import { signalRuleSetSchema } from "./signalRules";
import { parsingSpecSchema, type FieldSpec } from "./parsing/spec";
import { MAX_LOG_PATTERN_LENGTH } from "./adminPattern";
import { compileSourceStatementPattern, MAX_STATEMENT_PATTERNS } from "./sourceStatements";

export const logSkillSpecSchema = z.object({
  schemaVersion: z.literal("skill/v1"),
  parsing: parsingSpecSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  procedure: z.string().trim().max(20000).optional(),
  formatProfile: logFormatProfileSchema.superRefine((profile, ctx) => {
    const result = validateLogFormatProfile(profile);
    if (!result.ok) for (const message of result.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }).optional(),
  modelOverride: z.string().trim().min(1).max(200).optional(),
  defaultSourceSnapshotId: z.string().min(1).max(200).optional(),
  source: z.object({
    statementPatterns: z.array(z.string().min(1).max(MAX_LOG_PATTERN_LENGTH).superRefine((pattern, ctx) => {
      try { compileSourceStatementPattern(pattern); }
      catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) }); }
    })).max(MAX_STATEMENT_PATTERNS).optional()
  }).strict().optional(),
  signalRules: signalRuleSetSchema.optional()
}).strict().superRefine((spec, ctx) => {
  const fields = new Map<string, FieldSpec>(spec.parsing?.extractors.flatMap((extractor) =>
    Object.entries(extractor.fields).map(([name, field]) => [`${extractor.id}.${name}`, field] as const)) ?? []);
  spec.signalRules?.rules.forEach((rule, ruleIndex) => rule.anyOf.forEach((input, conditionIndex) => {
    const condition = input.type === "window" ? input.condition : input;
    if (condition.type !== "field") return;
    const path = ["signalRules", "rules", ruleIndex, "anyOf", conditionIndex, ...(input.type === "window" ? ["condition"] : [])];
    const field = fields.get(condition.field);
    const issue = (key: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, key], message });
    if (!field) { issue("field", "Unknown extracted field"); return; }
    if (field.type === "hexbytes" || field.type === "base64bytes") { issue("field", "Signal comparisons require a scalar extracted field"); return; }
    const numeric = ["int", "uint", "float"].includes(field.type);
    if (condition.operator === "range" && !numeric) issue("operator", "Ranges require a numeric extracted field");
    const expected = numeric ? "number" : field.type === "bool" ? "boolean" : "string";
    if (condition.operator === "equals" && typeof condition.value !== expected) issue("value", `Expected a ${expected} comparison value`);
    if (condition.operator === "in" && condition.values?.some((value) => typeof value !== expected)) issue("values", `Expected ${expected} set members`);
  }));
});

export type LogSkillSpec = z.infer<typeof logSkillSpecSchema>;
