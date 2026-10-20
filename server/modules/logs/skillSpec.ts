import { z } from "zod";
import { validatedLogFormatProfileSchema } from "./formatProfile";
import { withLogPatternBudget } from "./patternBudget";
import { preflightSignalRules, signalRuleSetSchema } from "./signalRules";
import { parsingSpecSchema } from "./parsing/spec";
import { listSignalFields } from "./parsing/signalFields";
import { createLogPatternCache, MAX_LOG_PATTERN_LENGTH } from "./adminPattern";
import { compileSourceStatementPattern, MAX_STATEMENT_PATTERNS } from "./sourceStatements";
import { parseTestsSchema } from "./parseTestSpec";
import { compileFileGlob, MAX_FILE_GLOB_LENGTH, MAX_FILE_ROLE_LENGTH, MAX_SKILL_FILE_GLOBS } from "../../../src/domain/logs/fileApplicability";

const boundedSkillFilesSchema = z.array(z.object({
  glob: z.string().min(1).max(MAX_FILE_GLOB_LENGTH),
  role: z.string().max(MAX_FILE_ROLE_LENGTH).trim().regex(/^[^\x00-\x1f\x7f]*$/, "文件用途须为简短的单行文字").optional()
}).strict()).max(MAX_SKILL_FILE_GLOBS);
// Validate the entire batch before entering the shared bounded compiler.
export const skillFilesSchema = z.preprocess((value, ctx) => {
  if (Array.isArray(value) && value.length > MAX_SKILL_FILE_GLOBS) {
    ctx.addIssue({ code: "custom", message: `最多允许 ${MAX_SKILL_FILE_GLOBS} 条文件匹配规则`, fatal: true });
    return z.NEVER;
  }
  return value;
}, boundedSkillFilesSchema.pipe(boundedSkillFilesSchema.superRefine((files, ctx) => {
  const cache = createLogPatternCache();
  files.forEach(({ glob }, index) => {
    try { compileFileGlob(glob, cache); }
    catch (error) { ctx.addIssue({ code: "custom", path: [index, "glob"], message: error instanceof Error ? error.message : String(error) }); }
  });
})));

// DTO schemas must stay independent of the server-only sample service.
export const skillFilePreviewRequestSchema = z.object({ files: z.unknown().optional() }).strict();
export const skillFilePreviewResponseSchema = z.object({
  valid: z.boolean(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
  files: z.array(z.object({ path: z.string(), skillMatched: z.boolean(), role: z.string().nullable() }))
});

export const logSkillSpecSchema = z.preprocess((value, ctx) => {
  // Bound signal graphs before the whole-skill program budget walks any patterns.
  if (value && typeof value === "object" && "signalRules" in value
    && preflightSignalRules(value.signalRules, ctx, ["signalRules"]) === z.NEVER) return z.NEVER;
  return value;
}, withLogPatternBudget(z.object({
  schemaVersion: z.literal("skill/v1"),
  files: skillFilesSchema.optional(),
  knowledgeEntryIds: z.array(z.string().uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "关联知识不能重复").optional(),
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
    if (!field) { issue("field", "所选解析字段不存在或不是单个值"); return; }
    if (condition.operator === "range" && field.type !== "number") issue("operator", "范围比较需要数值字段");
    const expected = field.type;
    if (condition.operator === "equals" && typeof condition.value !== expected) issue("value", `比较值的类型须为 ${expected}`);
    if (condition.operator === "in" && condition.values?.some((value) => typeof value !== expected)) issue("values", `集合成员的类型须为 ${expected}`);
  }));
}), "skill"));

export type LogSkillSpec = z.infer<typeof logSkillSpecSchema>;
export const parseTestRequestSchema = z.object({ spec: logSkillSpecSchema }).strict();
