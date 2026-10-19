import { z } from "zod";
import { logFormatProfileSchema, validateLogFormatProfile } from "./formatProfile";
import { signalRuleSetSchema } from "./signalRules";
import { parsingSpecSchema } from "./parsing/spec";

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
  signalRules: signalRuleSetSchema.optional()
}).strict();

export type LogSkillSpec = z.infer<typeof logSkillSpecSchema>;
