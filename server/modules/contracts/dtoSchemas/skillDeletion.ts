import { z } from "zod";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

export const skillDeletionRequestSchema = z.object({ version: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export const skillDeletionPreviewSchema = z.object({
  skillId: z.string(), name: z.string(), skillKey: z.string(), status: z.enum(["active", "archived"]),
  generatedAt: z.string().datetime(), version: z.string().regex(/^[0-9a-f]{64}$/), canDelete: z.boolean(),
  inventory: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int().nonnegative(), disposition: z.enum(["delete", "retain"]) }).strict()),
  objects: z.object({ total: z.number().int().nonnegative(), shared: z.number().int().nonnegative(), exclusive: z.number().int().nonnegative() }).strict(),
  blockers: z.array(z.object({ code: z.string(), count: z.number().int().positive(), message: z.string() }).strict()),
  notes: z.array(z.string())
}).strict();
export const skillDeletionStatusSchema = z.object({
  skillId: z.string(), name: z.string(), skillKey: z.string(), version: z.string().regex(/^[0-9a-f]{64}$/),
  database: z.literal("deleted"), objects: z.enum(["pending", "complete"]), pendingObjects: z.number().int().nonnegative(), retainedObjects: z.number().int().nonnegative()
}).strict();
export const skillDeletionPreviewResponseSchema = itemEnvelopeSchema(skillDeletionPreviewSchema);
export const skillDeletionStatusResponseSchema = itemEnvelopeSchema(skillDeletionStatusSchema);
export const skillDeletionListResponseSchema = itemsEnvelopeSchema(skillDeletionStatusSchema);
export type SkillDeletionPreview = z.infer<typeof skillDeletionPreviewSchema>;
export type SkillDeletionStatus = z.infer<typeof skillDeletionStatusSchema>;
