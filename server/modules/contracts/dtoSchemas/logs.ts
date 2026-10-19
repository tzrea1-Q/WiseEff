import { z } from "zod";

import { itemEnvelopeSchema, itemsEnvelopeSchema, okEnvelopeSchema } from "./envelopes";
import { logSkillSpecSchema } from "../../logs/skillSpec";
import { decodedEventSchema } from "../../logs/parsing/spec";
export { parsePreviewRequestSchema, parsePreviewResponseSchema, decodedEventSchema, decodedValueSchema } from "../../logs/parsing/spec";

export const skillRevisionPinSchema = z.object({ id: z.string(), number: z.number().int().positive() });
const knowledgeRevisionSchema = z.object({ entryId: z.string().uuid(), revisionId: z.string().uuid().optional() });
const sourceProvenanceShape = {
  sourceSnapshot: z.object({ id: z.string(), versionLabel: z.string().optional(), status: z.enum(["queued", "indexing", "ready", "failed", "archived"]) }).optional(),
  sourceSnapshotSelection: z.enum(["matched_version", "default", "none"]).optional(),
  requestedSourceVersion: z.string().optional()
};

export const logStageSchema = z.enum(["parse", "pattern", "rootcause", "report"]);
export const logRecordStatusSchema = z.enum(["uploaded", "processing", "complete", "failed"]);
export const logRunStatusSchema = z.enum(["queued", "processing", "complete", "failed"]);
export const logArchiveStateSchema = z.enum(["active", "archived"]);
export const logSeveritySchema = z.enum(["Critical", "Warning", "Info"]);
export const logAnalysisSourceSchema = z.enum(["agent", "rules-fallback"]);
export const logDegradedReasonSchema = z.enum(["provider-unavailable", "token-budget-exhausted"]);
export const logDomainStatusSchema = z.enum(["active", "archived"]);

export const logSignalAnchorSchema = z.object({ file: z.string(), line: z.number().int().positive(), content: z.string() });
export const logSignalSchema = z.object({ kind: z.string(), severity: logSeveritySchema, source: z.enum(["generic", "skill"]),
  title: z.string(), signature: z.string().optional(), count: z.number().int().positive(), anchors: z.array(logSignalAnchorSchema) });
export const logLineTemplateSchema = z.object({ template: z.string(), count: z.number().int().positive(),
  first: logSignalAnchorSchema, last: logSignalAnchorSchema });
export const logSignalSummarySchema = z.object({ signals: z.array(logSignalSchema), templates: z.array(logLineTemplateSchema),
  truncatedSignals: z.boolean(), truncatedTemplates: z.boolean(), truncated: z.boolean().optional(),
  reason: z.enum(["time_cap", "line_cap", "extraction_error"]).optional() });

export const logFileDtoSchema = z.object({
  role: z.string().nullable().optional(), skillMatched: z.boolean().nullable().optional(),
  path: z.string(), sizeBytes: z.number(), lineCount: z.number(), encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]),
  lossy: z.boolean(), status: z.enum(["analyzed", "skipped"]), skipReason: z.string().nullable()
});
export const logLineRangeDtoSchema = z.object({
  file: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  lines: z.array(z.object({ lineNumber: z.number().int().positive(), content: z.string() })).max(400)
});
export const logLineRangeResponseSchema = itemEnvelopeSchema(logLineRangeDtoSchema);
export const logEvidenceDtoSchema = z.object({
  sourceLocation: z.object({ snapshotId: z.string(), path: z.string(), line: z.number().int().positive() }).optional(),
  sourceVersionLabel: z.string().optional(),
  decodedFields: z.array(decodedEventSchema).optional(),
  filePath: z.string().nullable().optional(),
  id: z.string(),
  stageId: logStageSchema,
  lineNumbers: z.array(z.number()),
  inference: z.string(),
  suggestedAction: z.string(),
  ruleHit: z.string().optional()
});

export const logRecordDtoSchema = z.object({
  knowledgeRevisions: z.array(knowledgeRevisionSchema).optional(),
  ...sourceProvenanceShape,
  signalSummary: logSignalSummarySchema.optional(),
  files: z.array(logFileDtoSchema).optional(),
  skillRevision: skillRevisionPinSchema.nullable().optional(),
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
  relatedParameterProjectId: z.string().optional(),
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
  knowledgeRevisions: z.array(knowledgeRevisionSchema).optional(),
  ...sourceProvenanceShape,
  skillRevision: skillRevisionPinSchema.nullable().optional(),
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

export const logSkillRevisionDtoSchema = z.object({
  id: z.string(), skillId: z.string(), number: z.number().int().positive(),
  status: z.enum(["draft", "published", "superseded"]), spec: logSkillSpecSchema,
  contentHash: z.string(), createdByUserId: z.string().nullable(), createdAt: z.string(),
  publishedAt: z.string().nullable(), publishedByUserId: z.string().nullable(), publishedByDisplayName: z.string().nullable().optional()
});
export const logSkillListItemSchema = logDomainDtoSchema.extend({
  hasSourceSnapshots: z.boolean().optional(),
  readySourceVersions: z.array(z.string()).optional(),
  currentRevision: skillRevisionPinSchema.extend({ publishedAt: z.string().nullable() }),
  hasDraft: z.boolean(), analyses7d: z.number(), helpfulRate7d: z.number().nullable()
});
export const logSkillDtoSchema = logDomainDtoSchema.extend({
  currentRevision: logSkillRevisionDtoSchema, draft: logSkillRevisionDtoSchema.nullable()
});
export const logSkillListResponseSchema = itemsEnvelopeSchema(logSkillListItemSchema);
export const logSkillResponseSchema = itemEnvelopeSchema(logSkillDtoSchema);
export const logSkillRevisionResponseSchema = itemEnvelopeSchema(logSkillRevisionDtoSchema);
export const logSkillRevisionListResponseSchema = itemsEnvelopeSchema(logSkillRevisionDtoSchema);

export const logSkillTemplateListResponseSchema = itemsEnvelopeSchema(z.object({
  id: z.string(), label: z.string(), description: z.string(), spec: logSkillSpecSchema
}).strict());
export const logSkillSampleMetadataSchema = z.object({
  id: z.string(), skillId: z.string(), fileName: z.string(), sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(), encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]), lineCount: z.number().int().nonnegative(),
  uploadedByUserId: z.string().nullable(), createdAt: z.string(), updatedAt: z.string()
}).strict();
export const logSkillSampleFileSchema = z.object({
  path: z.string(), sizeBytes: z.number().int().nonnegative(), lineCount: z.number().int().nonnegative(),
  status: z.enum(["analyzed", "skipped"]), skipReason: z.string().nullable(),
  encoding: z.enum(["utf-8", "utf-16le", "utf-16be"]), lossy: z.boolean(), content: z.string().optional(), truncated: z.boolean().optional()
}).strict();
export const logSkillSampleDtoSchema = logSkillSampleMetadataSchema.extend({
  content: z.string(), contentFilePath: z.string().optional(), truncated: z.boolean(), files: z.array(logSkillSampleFileSchema).optional()
});
export const logSkillSampleResponseSchema = itemEnvelopeSchema(logSkillSampleDtoSchema.nullable());
export const logSkillSampleReplaceResponseSchema = itemEnvelopeSchema(logSkillSampleMetadataSchema);

export const logSourceSnapshotDtoSchema = z.object({
  id: z.string(), skillId: z.string(), versionLabel: z.string(),
  status: z.enum(["queued", "indexing", "ready", "failed", "archived"]),
  filesProcessed: z.number().int().nonnegative(), filesTotal: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(), skippedCount: z.number().int().nonnegative(),
  skippedFiles: z.array(z.object({ path: z.string(), reason: z.string() })),
  error: z.string().nullable(), createdAt: z.string()
});
export const logSourceSnapshotListResponseSchema = itemsEnvelopeSchema(logSourceSnapshotDtoSchema);
export const logSourceVersionListResponseSchema = itemsEnvelopeSchema(z.string());
export const logSourceSnapshotResponseSchema = itemEnvelopeSchema(logSourceSnapshotDtoSchema);
export const logSourceExcerptDtoSchema = z.object({
  snapshotId: z.string(), path: z.string(), line: z.number().int().positive(), versionLabel: z.string(),
  startLine: z.number().int().positive(), excerpt: z.string()
});
export const logSourceEvidenceResponseSchema = itemEnvelopeSchema(logSourceExcerptDtoSchema);
export const logSourceLocateRequestSchema = z.object({ line: z.string().trim().min(1).max(4000) }).strict();
export const logSourceStatementMatchSchema = logSourceExcerptDtoSchema.extend({ confidence: z.number().min(0).max(1) });
export const logSourceLocateResponseSchema = z.object({ items: z.array(logSourceStatementMatchSchema).max(20), truncated: z.boolean().optional() });

export const logDomainKnowledgeLinkDtoSchema = z.object({
  id: z.string(),
  logDomainId: z.string(),
  knowledgeEntryId: z.string(),
  entryTitle: z.string(),
  entryStatus: z.enum(["draft", "published", "archived"]).optional(),
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

export const logTraceStepSchema = z.object({
  index: z.number().int().min(1).max(200),
  kind: z.enum(["tool-call", "model-turn", "early-convergence", "rule-fallback", "degradation"]),
  tool: z.string().max(120).nullable(),
  arguments: z.record(z.string().max(64), z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()])),
  resultBytes: z.number().int().nonnegative(),
  lines: z.array(z.object({ file: z.string().max(1024), line: z.number().int().positive(), snapshotId: z.string().max(200).optional() }).strict()).max(50),
  outcome: z.enum(["ok", "error", "truncated"]), reason: z.string().max(120).nullable(),
  inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional()
}).strict();
export const logTraceResponseSchema = z.object({ steps: z.array(logTraceStepSchema).max(200) });
export const logDryRunReportSchema = z.object({
  confidence: z.number(), conclusion: z.string(), impact: z.string(), severity: logSeveritySchema,
  evidence: z.array(logEvidenceDtoSchema.omit({ id: true })), suggestedActions: z.array(z.string()),
  reportContext: z.object({ analysisQuestion: z.string().optional(), lineCount: z.number(), entryCount: z.number() }),
  analysisSource: logAnalysisSourceSchema.optional(), degradedReason: logDegradedReasonSchema.optional(),
  promptVersion: z.string().optional(), model: z.string().optional()
});
export const logSkillDryRunSchema = z.object({
  id: z.string(), skillRevisionId: z.string(), status: z.enum(["processing", "complete", "failed"]),
  progress: z.number().int().min(0).max(100), report: logDryRunReportSchema.nullable(),
  error: z.string().nullable(), createdAt: z.string()
});
export const logSkillDryRunResponseSchema = z.object({ run: logSkillDryRunSchema });
export const logSkillDryRunDetailResponseSchema = logSkillDryRunResponseSchema.extend({ steps: z.array(logTraceStepSchema).max(200) });
