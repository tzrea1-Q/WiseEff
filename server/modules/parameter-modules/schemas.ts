import { z } from "zod";

export const moduleMatchKindSchema = z.enum(["compatible", "instance"]);

export const createModuleMappingBodySchema = z.object({
  moduleId: z.string().trim().min(1),
  matchKind: moduleMatchKindSchema,
  matchValue: z.string().trim().min(1).max(200),
  priority: z.number().int().min(0).max(999).optional()
});

export const moduleMappingParamsSchema = z.object({
  mappingId: z.string().trim().min(1)
});

export const recomputeBindingsBodySchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  dryRun: z.boolean().optional()
});

export const dismissCompatibleBodySchema = z.object({
  compatible: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(500).optional()
});

export const dismissedCompatibleParamsSchema = z.object({
  compatible: z.string().trim().min(1).max(200)
});

export type CreateModuleMappingBody = z.infer<typeof createModuleMappingBodySchema>;
export type RecomputeBindingsBody = z.infer<typeof recomputeBindingsBodySchema>;
export type DismissCompatibleBody = z.infer<typeof dismissCompatibleBodySchema>;
