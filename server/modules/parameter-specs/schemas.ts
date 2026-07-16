import { z } from "zod";

const nonEmptyString = z.string().min(1);

export const parameterSourceKindSchema = z.enum(["dts", "json", "manual"]);
export const specLifecycleSchema = z.enum(["draft", "active", "deprecated"]);

export const parameterSpecSummaryDtoSchema = z.object({
  id: nonEmptyString,
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

export const resolveSpecReviewTaskBodySchema = z
  .object({
    decision: z.enum(["resolved", "dismissed"]),
    parameterSpecId: nonEmptyString.optional(),
    reason: nonEmptyString
  })
  .superRefine((value, ctx) => {
    if (value.decision === "resolved" && !value.parameterSpecId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "parameterSpecId is required when resolving a review task.",
        path: ["parameterSpecId"]
      });
    }
  });

export type ParameterSpecSummaryDto = z.infer<typeof parameterSpecSummaryDtoSchema>;
export type ParameterSpecDetailDto = z.infer<typeof parameterSpecDetailDtoSchema>;
export type ListParameterSpecsQuery = z.infer<typeof listParameterSpecsQuerySchema>;
export type ResolveSpecReviewTaskBody = z.infer<typeof resolveSpecReviewTaskBodySchema>;
