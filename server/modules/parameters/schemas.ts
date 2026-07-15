import { z } from "zod";

import { parameterReviewDecisions, parameterRiskLevels } from "./status";

const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();
const workflowAssigneesSchema = z.object({
  hardwareCommitterId: nonEmptyString,
  softwareCommitterId: nonEmptyString,
  softwareUserId: nonEmptyString
});

const importItemValueFields = ["currentValue", "recommendedValue"] as const;

const parameterImportSourceItemSchema = z
  .object({
    id: z.string().optional(),
    name: nonEmptyString,
    module: nonEmptyString,
    risk: z.enum(parameterRiskLevels),
    unit: nonEmptyString,
    range: nonEmptyString,
    currentValue: z.string().optional(),
    recommendedValue: z.string().optional(),
    description: z.string().optional(),
    explanation: z.string().optional(),
    configFormat: z.string().optional()
  })
  .refine((item) => importItemValueFields.some((field) => Boolean(item[field]?.trim())), {
    message: "At least one value field is required.",
    path: ["currentValue"]
  });

const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

export const listParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  moduleId: nonEmptyString.optional(),
  includeDescendants: booleanQuerySchema.optional(),
  risk: z.union([z.enum(parameterRiskLevels), z.array(z.enum(parameterRiskLevels))]).optional(),
  q: nonEmptyString.optional()
});

export const parameterModuleParamsSchema = z.object({
  moduleId: nonEmptyString
});

export const createParameterModuleBodySchema = z.object({
  name: nonEmptyString,
  parentId: nonEmptyString.nullable().optional(),
  description: z.string().optional(),
  scope: z.string().optional(),
  sortOrder: z.number().int().optional()
});

export const updateParameterModuleBodySchema = z
  .object({
    name: nonEmptyString.optional(),
    description: z.string().optional(),
    scope: z.string().optional(),
    sortOrder: z.number().int().optional()
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "At least one field is required."
  });

export const moveParameterModuleBodySchema = z.object({
  parentId: nonEmptyString.nullable()
});

export const saveDraftBodySchema = z.object({
  projectId: nonEmptyString,
  parameterId: nonEmptyString,
  targetValue: z.string(),
  reason: z.string()
});

export const submitRoundBodySchema = z.object({
  projectId: nonEmptyString,
  items: z
    .array(
      z.object({
        parameterId: nonEmptyString,
        targetValue: nonEmptyString,
        reason: nonEmptyString
      })
    )
    .min(1),
  reason: z.string().optional(),
  assignees: workflowAssigneesSchema.optional()
});

export const reviewChangeBodySchema = z.object({
  requestId: nonEmptyString,
  decision: z.enum(parameterReviewDecisions),
  note: z.string().optional(),
  expectedVersion: positiveInteger.optional()
});

export const createImportBatchBodySchema = z.object({
  projectId: nonEmptyString,
  sourceName: nonEmptyString,
  items: z.array(parameterImportSourceItemSchema).min(1),
  reviewMetadata: z
    .object({
      skippedRows: z
        .array(
          z.object({
            rowKey: z.string().optional(),
            name: z.string().optional(),
            module: z.string().optional(),
            reason: nonEmptyString
          })
        )
        .optional(),
      notes: z.string().optional()
    })
    .optional()
});

export const applyImportBatchBodySchema = z.object({
  batchId: nonEmptyString,
  selectedItemIds: z.array(nonEmptyString).optional(),
  reviewMetadata: z
    .object({
      skippedRows: z
        .array(
          z.object({
            rowKey: z.string().optional(),
            name: z.string().optional(),
            module: z.string().optional(),
            reason: nonEmptyString
          })
        )
        .optional(),
      notes: z.string().optional()
    })
    .optional()
});

export const parseDtsImportBodySchema = z.object({
  sourceName: nonEmptyString,
  content: z.string()
});

export const paramsWithRoundIdSchema = z.object({
  roundId: nonEmptyString
});

export const createProjectBodySchema = z.object({
  name: nonEmptyString,
  code: nonEmptyString.max(16),
  id: nonEmptyString.optional()
});

export const updateProjectBodySchema = z
  .object({
    name: nonEmptyString.optional(),
    code: nonEmptyString.max(16).optional(),
    status: nonEmptyString.optional()
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "At least one field is required."
  });

export type ListParametersQuery = {
  projectId?: string;
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
  risk?: z.infer<typeof listParametersQuerySchema>["risk"];
  q?: string;
};
export type CreateParameterModuleBody = z.infer<typeof createParameterModuleBodySchema>;
export type UpdateParameterModuleBody = z.infer<typeof updateParameterModuleBodySchema>;
export type MoveParameterModuleBody = z.infer<typeof moveParameterModuleBodySchema>;
export type SaveDraftBody = z.infer<typeof saveDraftBodySchema>;
export type SubmitRoundBody = z.infer<typeof submitRoundBodySchema>;
export type ReviewChangeBody = z.infer<typeof reviewChangeBodySchema>;
export type CreateImportBatchBody = z.infer<typeof createImportBatchBodySchema>;
export type ApplyImportBatchBody = z.infer<typeof applyImportBatchBodySchema>;
export type ParseDtsImportBody = z.infer<typeof parseDtsImportBodySchema>;
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;
