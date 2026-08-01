import { z } from "zod";

export const moduleMatchKindSchema = z.enum(["compatible", "node-type"]);

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

export const registerOrClaimDriverBodySchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  businessCategoryId: z.string().trim().min(1),
  compatibles: z
    .array(z.string().trim().min(1).max(200))
    .min(1),
  notes: z.string().trim().max(500).optional()
});

export const updateDriverRegistrationDefaultBodySchema = z.object({
  defaultBusinessCategoryId: z.string().trim().min(1),
});

export const driverRegistryModuleParamsSchema = z.object({
  moduleId: z.string().trim().min(1),
});

export type CreateModuleMappingBody = z.infer<typeof createModuleMappingBodySchema>;
export type RegisterOrClaimDriverBody = z.infer<typeof registerOrClaimDriverBodySchema>;
export type UpdateDriverRegistrationDefaultBody = z.infer<
  typeof updateDriverRegistrationDefaultBodySchema
>;
export type DriverRegistryModuleParams = z.infer<typeof driverRegistryModuleParamsSchema>;
export type RecomputeBindingsBody = z.infer<typeof recomputeBindingsBodySchema>;
export type DismissCompatibleBody = z.infer<typeof dismissCompatibleBodySchema>;
