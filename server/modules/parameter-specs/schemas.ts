import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const parameterSourceKindSchema = z.enum(["dts", "json", "manual"]);
export const specLifecycleSchema = z.enum(["draft", "active", "deprecated"]);
export const specAttributionModuleKindSchema = z.enum([
  "business",
  "driver-group",
  "node-type",
  "unclassified",
]);

export const specAttributionModuleDtoSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  kind: specAttributionModuleKindSchema,
  path: z.array(z.string()).optional(),
});

export const parameterSpecSummaryDtoSchema = z.object({
  id: nonEmptyString,
  organizationId: z.string().nullable().optional(),
  sourceKind: parameterSourceKindSchema,
  specificationKey: nonEmptyString,
  propertyKey: z.string().nullable(),
  /** Display-only label from attribution subject; not write identity. */
  driverModule: z.string().nullable(),
  lifecycle: specLifecycleSchema,
  currentVersionId: z.string().nullable(),
  currentVersion: z.number().int().nullable(),
  valueShape: z.unknown().nullable(),
  compatiblePatterns: z.array(z.string()).nullable(),
  attributionModules: z.array(specAttributionModuleDtoSchema),
  attributionSubjectId: z.string().nullable().optional(),
  referenceCount: z.number().int().nonnegative().optional(),
  effectiveScope: z.enum(["organization", "platform", "governance"]).optional(),
  overrideOfSpecId: z.string().nullable().optional(),
  declaredPlacement: z
    .object({
      moduleId: nonEmptyString,
      moduleName: nonEmptyString,
      categoryId: z.string().nullable(),
      categoryName: z.string().nullable(),
      path: z.array(z.string()).optional(),
    })
    .nullable()
    .optional(),
  observationState: z
    .enum(["observed", "not-yet-observed", "unclassified"])
    .optional(),
});

export const parameterSpecDetailDtoSchema =
  parameterSpecSummaryDtoSchema.extend({
    displayName: z.string().nullable(),
    description: z.string().nullable(),
    schemaDefault: z.unknown().nullable(),
    exampleValue: z.unknown().nullable(),
    schemaNamespace: z.string().nullable(),
    units: z.string().nullable(),
    constraints: z.record(z.string(), z.unknown()).nullable(),
    documentation: z.string().nullable(),
    policyTarget: z.unknown().nullable(),
    cutover: z
      .object({
        runId: nonEmptyString,
        status: z.enum(["preparing", "ready"]),
        fromVersionId: nonEmptyString,
        toVersionId: nonEmptyString,
        fromVersion: z.number().int(),
        toVersion: z.number().int(),
        impact: z.object({
          pending: z.number().int(),
          ready: z.number().int(),
          incompatible: z.number().int(),
          skipped: z.number().int(),
          total: z.number().int(),
        }),
      })
      .optional(),
  });


export const listParameterSpecsQuerySchema = z.object({
  q: z.string().optional(),
  sourceKind: parameterSourceKindSchema.optional(),
  lifecycle: specLifecycleSchema.optional(),
  attributionSubjectId: z.string().optional(),
  propertyKey: z.string().optional(),
  /** Effective is the safe product view; governance exposes raw/history rows. */
  view: z.enum(["effective", "governance"]).optional(),
});

export const parameterSpecParamsSchema = z.object({
  specId: nonEmptyString,
});

/** Detail reads default to the safe effective projection; governance is an explicit raw/history view. */
export const parameterSpecDetailQuerySchema = z.object({
  view: z.enum(["effective", "governance"]).optional(),
});

export const parameterSpecReviewTaskParamsSchema = z.object({
  taskId: nonEmptyString,
});

export const specReviewTaskStatusSchema = z.enum([
  "open",
  "resolved",
  "dismissed",
]);

export const listSpecReviewTasksQuerySchema = z.object({
  status: specReviewTaskStatusSchema.optional(),
  projectId: z.string().optional(),
  configRevisionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const parameterSpecReviewCandidateDtoSchema = z.object({
  id: nonEmptyString,
  label: nonEmptyString,
  propertyKey: z.string().nullable().optional(),
  driverModule: z.string().nullable().optional(),
});

export const parameterSpecReviewTaskDtoSchema = z.object({
  id: nonEmptyString,
  status: specReviewTaskStatusSchema,
  parameterSpecId: z.string().nullable().optional(),
  propertyKey: z.string().nullable(),
  driverModule: z.string().nullable(),
  evidence: z.array(z.string()),
  candidates: z.array(parameterSpecReviewCandidateDtoSchema),
  ambiguous: z.boolean(),
  projectCount: z.number().int(),
  createdAt: nonEmptyString,
  resolvedAt: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});


export type ParameterSpecSummaryDto = z.infer<
  typeof parameterSpecSummaryDtoSchema
>;
export type ParameterSpecDetailDto = z.infer<
  typeof parameterSpecDetailDtoSchema
>;
export type ListParameterSpecsQuery = z.infer<
  typeof listParameterSpecsQuerySchema
>;
export type ListSpecReviewTasksQuery = z.infer<
  typeof listSpecReviewTasksQuerySchema
>;
export type ParameterSpecReviewTaskDto = z.infer<
  typeof parameterSpecReviewTaskDtoSchema
>;
