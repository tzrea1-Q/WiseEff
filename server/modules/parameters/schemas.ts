import { z } from "zod";

import { parameterReviewDecisions, parameterRiskLevels } from "./status";

const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();
const workflowAssigneesSchema = z.object({
  hardwareCommitterId: nonEmptyString.optional(),
  softwareCommitterId: nonEmptyString.optional(),
  softwareUserId: nonEmptyString.optional()
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

export const listParametersQuerySchema = z.object({
  projectId: nonEmptyString.optional(),
  module: nonEmptyString.optional(),
  risk: z.union([z.enum(parameterRiskLevels), z.array(z.enum(parameterRiskLevels))]).optional(),
  q: nonEmptyString.optional()
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
  items: z.array(parameterImportSourceItemSchema).min(1)
});

export const applyImportBatchBodySchema = z.object({
  batchId: nonEmptyString,
  selectedItemIds: z.array(nonEmptyString).optional()
});

export type ListParametersQuery = z.infer<typeof listParametersQuerySchema>;
export type SaveDraftBody = z.infer<typeof saveDraftBodySchema>;
export type SubmitRoundBody = z.infer<typeof submitRoundBodySchema>;
export type ReviewChangeBody = z.infer<typeof reviewChangeBodySchema>;
export type CreateImportBatchBody = z.infer<typeof createImportBatchBodySchema>;
export type ApplyImportBatchBody = z.infer<typeof applyImportBatchBodySchema>;
