import { z } from "zod";

import { itemEnvelopeSchema, itemsEnvelopeSchema, okEnvelopeSchema } from "./envelopes";

export const parameterRiskLevelSchema = z.enum(["High", "Medium", "Low"]);
export const parameterValueKindSchema = z.enum(["scalar", "complex"]);
export const parameterChangeActionSchema = z.enum(["set", "delete"]);
export const parameterChangeRequestStatusSchema = z.enum([
  "submitted",
  "hardware_review",
  "software_review",
  "software_merge",
  "merged",
  "rejected"
]);
export const parameterSubmissionRoundStatusSchema = z.enum([
  ...parameterChangeRequestStatusSchema.options,
  "withdrawn",
  "stashed"
]);
export const parameterImportBatchStatusSchema = z.enum(["previewed", "applied"]);
export const parameterImportClassificationSchema = z.enum(["added", "updated", "unchanged", "conflict"]);

export const projectDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string()
});

export const parameterHistoryEntryDtoSchema = z.object({
  version: z.string(),
  value: z.string(),
  changedAt: z.string(),
  changedBy: z.string(),
  requestId: z.string().optional(),
  projectParameterBindingId: z.string().optional(),
  parameterSpecId: z.string().optional()
});

export const parameterRecordDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  explanation: z.string(),
  configFormat: z.string(),
  valueKind: parameterValueKindSchema.optional(),
  module: z.string(),
  moduleId: z.string().optional(),
  modulePath: z.array(z.string()).optional(),
  projectId: z.string(),
  currentValue: z.string(),
  recommendedValue: z.string(),
  range: z.string(),
  unit: z.string(),
  risk: parameterRiskLevelSchema,
  sourceFileName: z.string().optional(),
  sourceNodePath: z.string().optional(),
  parameterSpecId: z.string().optional(),
  projectParameterBindingId: z.string().optional(),
  updatedAt: z.string(),
  updatedAtTs: z.string(),
  history: z.array(parameterHistoryEntryDtoSchema)
});

export const parameterDraftDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parameterId: z.string(),
  targetValue: z.string(),
  action: parameterChangeActionSchema.optional(),
  reason: z.string(),
  updatedAt: z.string(),
  projectParameterBindingId: z.string().optional(),
  candidateConfigRevisionId: z.string().optional(),
  parameterSpecId: z.string().optional(),
  name: z.string().optional(),
  module: z.string().optional(),
  editSubjectKind: z.enum(["binding", "node-enablement"]).optional(),
  logicalNodeId: z.string().optional(),
  nodeLabel: z.string().optional(),
  currentValue: z.string().optional()
});

export const workflowAssigneesDtoSchema = z.object({
  hardwareCommitterId: z.string(),
  softwareCommitterId: z.string(),
  softwareUserId: z.string()
});

export const aiReviewSuggestionDtoSchema = z.object({
  recommendation: z.enum(["advance", "needs-review", "reject"]),
  confidence: z.enum(["high", "mid", "low"]),
  summary: z.string(),
  reasons: z.array(z.string()),
  similarRequests: z.array(z.string())
});

export const impactItemDtoSchema = z.object({
  kind: z.enum(["module", "test", "parameter", "phandle", "compatible", "config-set"]),
  name: z.string(),
  note: z.string(),
  risk: parameterRiskLevelSchema
});

export const changeRequestDtoSchema = z.object({
  id: z.string(),
  submissionRoundId: z.string().optional(),
  projectId: z.string().optional(),
  editSubjectKind: z.enum(["binding", "node-enablement"]).optional(),
  logicalNodeId: z.string().optional(),
  parameterId: z.string(),
  baseVersion: z.number().optional(),
  module: z.string(),
  moduleDescription: z.string().optional(),
  parameterDescription: z.string().optional(),
  title: z.string(),
  currentValue: z.string(),
  targetValue: z.string(),
  action: parameterChangeActionSchema.optional(),
  candidateConfigRevisionId: z.string().optional(),
  submitter: z.string(),
  submitterUserId: z.string().optional(),
  createdAt: z.string(),
  createdAtTs: z.string(),
  updatedAt: z.string(),
  status: parameterChangeRequestStatusSchema,
  aiSummary: z.string(),
  rejectReason: z.string().optional(),
  waitingHours: z.number(),
  aiSuggestion: aiReviewSuggestionDtoSchema,
  impact: z.array(impactItemDtoSchema),
  assignedTo: z.string().optional(),
  workflowAssignees: workflowAssigneesDtoSchema.optional(),
  fastTrack: z.boolean().optional(),
  reviewerNote: z.string().optional(),
  valueKind: parameterValueKindSchema.optional(),
  projectParameterBindingId: z.string().optional(),
  parameterSpecId: z.string().optional()
});

export const parameterSubmissionItemDtoSchema = z.object({
  requestId: z.string(),
  parameterId: z.string(),
  name: z.string(),
  module: z.string(),
  currentValue: z.string(),
  targetValue: z.string(),
  action: parameterChangeActionSchema.optional(),
  candidateConfigRevisionId: z.string().optional(),
  unit: z.string(),
  risk: parameterRiskLevelSchema,
  reason: z.string(),
  valueKind: parameterValueKindSchema.optional()
});

export const submissionWorkflowStageDetailDtoSchema = z.object({
  key: z.enum(["hardware_review", "software_review", "software_merge"]),
  stepIndex: z.number(),
  label: z.string(),
  assigneeName: z.string(),
  executorName: z.string().optional(),
  executorLabel: z.enum(["执行人", "当前处理"]),
  state: z.enum(["pending", "active", "completed", "skipped"])
});

export const parameterSubmissionRoundDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  submitter: z.string(),
  createdAt: z.string(),
  status: parameterSubmissionRoundStatusSchema,
  summary: z.string(),
  workflowAssignees: workflowAssigneesDtoSchema.optional(),
  workflowTrail: z.array(submissionWorkflowStageDetailDtoSchema).optional(),
  items: z.array(parameterSubmissionItemDtoSchema)
});

export const parameterImportSummaryDtoSchema = z.object({
  added: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  conflict: z.number(),
  highRisk: z.number()
});

export const parameterImportBatchItemDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  module: z.string(),
  risk: parameterRiskLevelSchema,
  unit: z.string(),
  range: z.string(),
  currentValue: z.string().optional(),
  recommendedValue: z.string().optional(),
  description: z.string().optional(),
  explanation: z.string().optional(),
  configFormat: z.string().optional(),
  classification: parameterImportClassificationSchema,
  riskFlag: z.boolean().optional()
});

export const parameterImportBatchDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceName: z.string(),
  status: parameterImportBatchStatusSchema,
  createdAt: z.string(),
  appliedAt: z.string().optional(),
  summary: parameterImportSummaryDtoSchema,
  items: z.array(parameterImportBatchItemDtoSchema)
});

export const projectListResponseSchema = itemsEnvelopeSchema(projectDtoSchema);
export const parameterListResponseSchema = itemsEnvelopeSchema(parameterRecordDtoSchema);
export const parameterResponseSchema = itemEnvelopeSchema(parameterRecordDtoSchema);
export const parameterHistoryResponseSchema = itemsEnvelopeSchema(parameterHistoryEntryDtoSchema);
export const parameterDraftResponseSchema = itemEnvelopeSchema(parameterDraftDtoSchema);
export const parameterDraftListResponseSchema = itemsEnvelopeSchema(parameterDraftDtoSchema);
export const parameterSubmissionRoundResponseSchema = itemEnvelopeSchema(parameterSubmissionRoundDtoSchema);
export const parameterSubmissionRoundListResponseSchema = itemsEnvelopeSchema(parameterSubmissionRoundDtoSchema);
export const parameterChangeRequestListResponseSchema = itemsEnvelopeSchema(changeRequestDtoSchema);
export const parameterChangeRequestResponseSchema = itemEnvelopeSchema(changeRequestDtoSchema);
export const parameterImportBatchResponseSchema = itemEnvelopeSchema(parameterImportBatchDtoSchema);
export const parameterDeleteResponseSchema = okEnvelopeSchema;
