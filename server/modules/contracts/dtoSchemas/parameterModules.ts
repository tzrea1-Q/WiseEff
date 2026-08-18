import { z } from "zod";

import { itemEnvelopeSchema } from "./envelopes";

export const parameterModuleImportanceSchema = z.enum(["high", "medium", "low"]);
export const parameterModuleKindSchema = z.enum([
  "business",
  "driver-group",
  "node-type",
  "unclassified"
]);
export const parameterModuleOriginSchema = z.enum(["curated", "auto"]);

export const parameterModuleDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  sortOrder: z.number().int(),
  description: z.string(),
  scope: z.string(),
  importance: parameterModuleImportanceSchema,
  kind: parameterModuleKindSchema,
  origin: parameterModuleOriginSchema,
  sourceKey: z.string().nullable(),
  attributionSubjectId: z.string().nullable().optional(),
  effectiveImportance: parameterModuleImportanceSchema,
  /** Subtree bindings (measured occurrences). */
  parameterCount: z.number().int().nonnegative(),
  /** Distinct specs in the same subtree (definition count). */
  definitionCount: z.number().int().nonnegative()
});

export const parameterModuleMappingDtoSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  matchKind: z.enum(["compatible", "node-type"]),
  matchValue: z.string(),
  priority: z.number().int()
});

export const parameterModuleRegistryDtoSchema = z.object({
  modules: z.array(parameterModuleDtoSchema),
  mappings: z.array(parameterModuleMappingDtoSchema)
});

export const parameterModuleRegistryResponseSchema = itemEnvelopeSchema(
  parameterModuleRegistryDtoSchema
);
