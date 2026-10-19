import { z } from "zod";
import { logFormatProfileSchema, validateLogFormatProfile } from "./formatProfile";
import { signalRuleSetSchema } from "./signalRules";

export const logSkillSpecSchema = z.object({
  schemaVersion: z.literal("skill/v1"),
  description: z.string().trim().max(2000).optional(),
  formatProfile: logFormatProfileSchema.superRefine((profile, ctx) => {
    const result = validateLogFormatProfile(profile);
    if (!result.ok) for (const message of result.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }).optional(),
  modelOverride: z.string().trim().min(1).max(200).optional(),
  signalRules: signalRuleSetSchema.optional()
}).strict();

export type LogSkillSpec = z.infer<typeof logSkillSpecSchema>;
