import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const parameterSourceKindSchema = z.enum(["dts", "json", "manual"]);
export const specLifecycleSchema = z.enum(["draft", "active", "deprecated"]);

export const parameterSpecSummaryDtoSchema = z.object({
  id: nonEmptyString,
  organizationId: z.string().nullable().optional(),
  sourceKind: parameterSourceKindSchema,
  specificationKey: nonEmptyString,
  propertyKey: z.string().nullable(),
  driverModule: z.string().nullable(),
  lifecycle: specLifecycleSchema,
  currentVersionId: z.string().nullable(),
  currentVersion: z.number().int().nullable()
});

export const parameterSpecDetailDtoSchema = parameterSpecSummaryDtoSchema.extend({
  displayName: z.string().nullable(),
  description: z.string().nullable(),
  valueShape: z.unknown().nullable(),
  schemaDefault: z.unknown().nullable(),
  exampleValue: z.unknown().nullable(),
  schemaNamespace: z.string().nullable(),
  units: z.string().nullable(),
  constraints: z.record(z.string(), z.unknown()).nullable(),
  documentation: z.string().nullable(),
  compatiblePatterns: z.array(z.string()).nullable(),
  policyTarget: z.unknown().nullable()
});

export const listParameterSpecsQuerySchema = z.object({
  q: z.string().optional(),
  sourceKind: parameterSourceKindSchema.optional(),
  lifecycle: specLifecycleSchema.optional(),
  driverModule: z.string().optional(),
  propertyKey: z.string().optional()
});

export const parameterSpecParamsSchema = z.object({
  specId: nonEmptyString
});

export const parameterSpecReviewTaskParamsSchema = z.object({
  taskId: nonEmptyString
});

export const specReviewTaskStatusSchema = z.enum(["open", "resolved", "dismissed"]);

export const listSpecReviewTasksQuerySchema = z.object({
  status: specReviewTaskStatusSchema.optional(),
  projectId: z.string().optional(),
  configRevisionId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional()
});

export const parameterSpecReviewCandidateDtoSchema = z.object({
  id: nonEmptyString,
  label: nonEmptyString,
  propertyKey: z.string().nullable().optional(),
  driverModule: z.string().nullable().optional()
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
  reason: z.string().nullable().optional()
});

export const resolveSpecReviewTaskBodySchema = z
  .object({
    decision: z.enum(["resolved", "dismissed"]),
    parameterSpecId: nonEmptyString.optional(),
    reason: nonEmptyString,
    confirmPropertyMismatch: z.boolean().optional(),
    createSpec: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (value.decision === "resolved") {
      if (!value.parameterSpecId && !value.createSpec) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "parameterSpecId or createSpec is required when resolving a review task.",
          path: ["parameterSpecId"]
        });
      }
      if (value.parameterSpecId && value.createSpec) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Provide parameterSpecId or createSpec, not both.",
          path: ["createSpec"]
        });
      }
    }
  });

export const activateParameterSpecBodySchema = z.object({
  valueShape: z.record(z.string(), z.unknown()),
  constraints: z.record(z.string(), z.unknown()).default({}),
  documentation: nonEmptyString,
  displayName: z.string().optional(),
  description: z.string().optional(),
  reason: nonEmptyString,
});

export const resolveSpecReviewTaskResultSchema = z.object({
  id: nonEmptyString,
  status: specReviewTaskStatusSchema,
  parameterSpecId: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  draftCreated: z.boolean().optional(),
  message: z.string().optional(),
});

export type ParameterSpecSummaryDto = z.infer<typeof parameterSpecSummaryDtoSchema>;
export type ParameterSpecDetailDto = z.infer<typeof parameterSpecDetailDtoSchema>;
export type ListParameterSpecsQuery = z.infer<typeof listParameterSpecsQuerySchema>;
export type ListSpecReviewTasksQuery = z.infer<typeof listSpecReviewTasksQuerySchema>;
export type ParameterSpecReviewTaskDto = z.infer<typeof parameterSpecReviewTaskDtoSchema>;
export type ResolveSpecReviewTaskBody = z.infer<typeof resolveSpecReviewTaskBodySchema>;
export type ActivateParameterSpecBody = z.infer<typeof activateParameterSpecBodySchema>;
export type ResolveSpecReviewTaskResultDto = z.infer<typeof resolveSpecReviewTaskResultSchema>;
