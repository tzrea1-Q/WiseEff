import { z } from "zod";
import { validatedLogFormatProfileSchema } from "./formatProfile";
import { withLogPatternBudget } from "./patternBudget";
import { signalRuleSetSchema } from "./signalRules";
import { parsingSpecSchema } from "./parsing/spec";
import { MAX_LOG_PATTERN_LENGTH } from "./adminPattern";
import { compileSourceStatementPattern, MAX_STATEMENT_PATTERNS } from "./sourceStatements";

export const logSkillSpecSchema = withLogPatternBudget(z.object({
  schemaVersion: z.literal("skill/v1"),
  knowledgeEntryIds: z.array(z.string().uuid()).max(200).refine((ids) => new Set(ids).size === ids.length, "Knowledge links must be unique").optional(),
  parsing: parsingSpecSchema.optional(),
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
}).strict(), "skill");

export type LogSkillSpec = z.infer<typeof logSkillSpecSchema>;
