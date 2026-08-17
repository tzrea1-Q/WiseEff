import { z } from "zod";

import { itemEnvelopeSchema, itemsEnvelopeSchema, okEnvelopeSchema } from "./envelopes";

export const logStageSchema = z.enum(["parse", "pattern", "rootcause", "report"]);
export const logRecordStatusSchema = z.enum(["uploaded", "processing", "complete", "failed"]);
export const logRunStatusSchema = z.enum(["queued", "processing", "complete", "failed"]);
export const logArchiveStateSchema = z.enum(["active", "archived"]);
export const logSeveritySchema = z.enum(["Critical", "Warning", "Info"]);
export const logAnalysisSourceSchema = z.enum(["agent", "rules-fallback"]);
export const logDegradedReasonSchema = z.enum(["provider-unavailable", "token-budget-exhausted"]);
export const logDomainStatusSchema = z.enum(["active", "archived"]);

export const logEvidenceDtoSchema = z.object({
  id: z.string(),
  stageId: logStageSchema,
  lineNumbers: z.array(z.number()),
  inference: z.string(),
  suggestedAction: z.string(),
  ruleHit: z.string().optional()
});

export const logRecordDtoSchema = z.object({
  id: z.string(),
  reportId: z.string(),
  fileName: z.string(),
  source: z.string(),
  fileSizeBytes: z.number(),
  status: logRecordStatusSchema,
  archiveState: logArchiveStateSchema,
  stage: logStageSchema,
  confidence: z.number(),
  conclusion: z.string(),
  impact: z.string(),
  evidence: z.array(logEvidenceDtoSchema),
  suggestedActions: z.array(z.string()),
  severity: logSeveritySchema,
  rawLines: z.array(z.string()),
  capturedAt: z.string(),
  updatedAt: z.string(),
  submittedBy: z.string(),
  relatedParameterId: z.string().optional(),
  device: z.string().optional(),
  failureReason: z.string().optional(),
  analysisQuestion: z.string().optional(),
  logDomainId: z.string().optional(),
  logDomainName: z.string().optional(),
  analysisSource: logAnalysisSourceSchema.optional(),
  degradedReason: logDegradedReasonSchema.optional()
});

export const logJobDtoSchema = z.object({
  id: z.string(),
  kind: z.literal("log-analysis"),
  logId: z.string(),
  runId: z.string(),
  status: logRunStatusSchema,
  progress: z.number(),
  currentStage: logStageSchema,
  error: z.string().nullable(),
  updatedAt: z.string(),
  organizationId: z.string().optional()
});

export const logRunDtoSchema = z.object({
  id: z.string(),
  logId: z.string(),
  status: logRunStatusSchema,
  currentStage: logStageSchema,
  progress: z.number(),
  error: z.string().nullable(),
  updatedAt: z.string()
});

export const logFileObjectDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  storageKey: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  fileSizeBytes: z.number().optional(),
  checksumSha256: z.string().optional(),
  uploadedByUserId: z.string().nullable().optional(),
  createdAt: z.string().optional()
});

export const logDomainWebhookSummarySchema = z.object({
  enabled: z.boolean(),
  url: z.string().optional(),
  secretConfigured: z.boolean(),
  secretLastFour: z.string().optional()
});

export const logDomainDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  status: logDomainStatusSchema,
  formatProfile: z.unknown().optional(),
  modelOverride: z.string().optional(),
  webhook: logDomainWebhookSummarySchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const logDomainKnowledgeLinkDtoSchema = z.object({
  id: z.string(),
  logDomainId: z.string(),
  knowledgeEntryId: z.string(),
  entryTitle: z.string(),
  entryStatus: z.enum(["draft", "published", "archived"]),
  entryTags: z.array(z.string()),
  linkedAt: z.string()
});

export const logWebhookDeliveryDtoSchema = z.object({
  id: z.string(),
  logDomainId: z.string(),
  logRecordId: z.string().optional(),
  runId: z.string().optional(),
  kind: z.enum(["result", "test"]),
  attempt: z.number(),
  status: z.enum(["delivered", "retrying", "failed"]),
  httpStatus: z.number().optional(),
  error: z.string().optional(),
  createdAt: z.string()
});

export const logFeedbackInsightDtoSchema = z.object({
  logDomainId: z.string().nullable(),
  logDomainName: z.string().nullable(),
  analysisSource: z.union([logAnalysisSourceSchema, z.null()]),
  promptVersion: z.string().nullable(),
  totalCount: z.number(),
  helpfulCount: z.number(),
  helpfulRate: z.number(),
  lastFeedbackAt: z.string()
});

export const logWebhookTestOutcomeSchema = z.object({
  status: z.enum(["delivered", "failed", "skipped"]),
  attempts: z.number(),
  httpStatus: z.number().optional(),
  error: z.string().optional()
});

export const logRecordListResponseSchema = itemsEnvelopeSchema(logRecordDtoSchema);
export const logRecordResponseSchema = itemEnvelopeSchema(logRecordDtoSchema);
export const logFileUploadResponseSchema = z.object({
  fileObject: logFileObjectDtoSchema,
  log: logRecordDtoSchema,
  job: logJobDtoSchema.nullable()
});
export const logRunListResponseSchema = itemsEnvelopeSchema(logRunDtoSchema);
export const logRunResponseSchema = z.object({
  log: logRecordDtoSchema,
  job: logJobDtoSchema,
  runs: z.array(logRunDtoSchema).optional()
});
export const jobResponseSchema = itemEnvelopeSchema(logJobDtoSchema);
export const logDomainListResponseSchema = itemsEnvelopeSchema(logDomainDtoSchema);
export const logDomainResponseSchema = itemEnvelopeSchema(logDomainDtoSchema);
export const logDomainKnowledgeLinkListResponseSchema = itemsEnvelopeSchema(logDomainKnowledgeLinkDtoSchema);
export const logFeedbackInsightsResponseSchema = itemsEnvelopeSchema(logFeedbackInsightDtoSchema);
export const logWebhookDeliveryListResponseSchema = itemsEnvelopeSchema(logWebhookDeliveryDtoSchema);
export const logWebhookTestOutcomeResponseSchema = z.object({
  outcome: logWebhookTestOutcomeSchema
});
export const logFeedbackResponseSchema = okEnvelopeSchema;
