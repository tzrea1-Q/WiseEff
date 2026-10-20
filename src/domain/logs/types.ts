export type LogStageId = "parse" | "pattern" | "rootcause" | "report";

export type LogStatus = "Processing" | "Complete" | "Failed";

export type LogSeverity = "Critical" | "Warning" | "Info";

export type LogArchiveState = "active" | "archived";

export type TimeWindow = "today" | "7d" | "30d";

export type LogAnalysisSource = "agent" | "rules-fallback";

export type LogDegradedReason = "provider-unavailable" | "token-budget-exhausted";

export type LogDomainStatus = "active" | "archived";

/**
 * Result-webhook summary for governance (P3b): the signing secret is write-only —
 * the API only reports whether one is configured and its last four characters.
 */
export type LogDomainWebhookSummary = {
  enabled: boolean;
  url?: string;
  secretConfigured: boolean;
  secretLastFour?: string;
};

/** One webhook delivery ATTEMPT; a send with retries produces several rows (P3b). */
export type LogWebhookDelivery = {
  id: string;
  logDomainId: string;
  logRecordId?: string;
  runId?: string;
  kind: "result" | "test";
  attempt: number;
  status: "delivered" | "retrying" | "failed";
  httpStatus?: number;
  error?: string;
  createdAt: string;
};

/** Org-scoped log domain registration (业务域); absence on a record = 未分类域. */
export type LogDomain = {
  skillKey?: string;
  hasSourceSnapshots?: boolean;
  readySourceVersions?: string[];
  currentRevision?: { id: string; number: number; publishedAt: string | null };
  hasDraft?: boolean;
  analyses7d?: number;
  helpfulRate7d?: number | null;
  id: string;
  name: string;
  description?: string;
  status: LogDomainStatus;
  formatProfile?: unknown;
  /** Per-domain model-name override; empty = the global LOG_ANALYSIS_MODEL (P3b). */
  modelOverride?: string;
  webhook?: LogDomainWebhookSummary;
  createdAt: string;
  updatedAt: string;
};

/**
 * A domain's link to a published knowledge-base entry (P2). The link carries the
 * entry's CURRENT status so governance can spot entries archived after linking —
 * retrieval itself stays published-only.
 */
export type LogDomainKnowledgeLink = {
  id: string;
  logDomainId: string;
  knowledgeEntryId: string;
  entryTitle: string;
  entryStatus?: "draft" | "published" | "archived";
  entryTags: string[];
  linkedAt: string;
};

/**
 * One `/log-admin` analysis-quality insight row: log_feedback aggregated per
 * log domain × analysis source × prompt version (P3 online monitoring).
 */
export type LogFeedbackInsight = {
  /** null = uncategorized log domain. */
  logDomainId: string | null;
  logDomainName: string | null;
  /** null = legacy report without analyzer provenance. */
  analysisSource: LogAnalysisSource | null;
  promptVersion: string | null;
  totalCount: number;
  helpfulCount: number;
  /** helpfulCount / totalCount, in [0, 1]. */
  helpfulRate: number;
  lastFeedbackAt: string;
};

export type LogFile = {
  path: string; sizeBytes: number; lineCount: number; encoding: "utf-8" | "utf-16le" | "utf-16be";
  lossy: boolean; status: "analyzed" | "skipped"; skipReason: string | null;
  role?: string | null; skillMatched?: boolean | null;
};
export type LogEvidence = {
  sourceLocation?: { snapshotId: string; path: string; line: number };
  sourceVersionLabel?: string;
  decodedFields?: import("zod").z.infer<typeof import("@wiseeff/dto-schemas").decodedEventSchema>[];
  filePath?: string | null;
  id: string;
  stageId: LogStageId;
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  ruleHit?: string;
};

export type LogSignalAnchor = { file: string; line: number; content: string };
export type LogSignal = {
  signature?: string;
  kind: string;
  severity: LogSeverity;
  source: "generic" | "skill";
  title: string;
  count: number;
  anchors: LogSignalAnchor[];
};
export type LogLineTemplate = { template: string; count: number; first: LogSignalAnchor; last: LogSignalAnchor };
export type LogSignalSummary = {
  truncated?: boolean;
  reason?: "time_cap" | "line_cap" | "extraction_error";
  signals: LogSignal[];
  templates: LogLineTemplate[];
  truncatedSignals: boolean;
  truncatedTemplates: boolean;
};

export type LogRecord = {
  knowledgeRevisions?: Array<{ entryId: string; revisionId?: string }>;
  sourceSnapshot?: { id: string; versionLabel?: string; status: "queued" | "indexing" | "ready" | "failed" | "archived" };
  sourceSnapshotSelection?: "matched_version" | "default" | "none";
  requestedSourceVersion?: string;
  signalSummary?: LogSignalSummary;
  files?: LogFile[];
  skillRevision?: { id: string; number: number } | null;
  id: string;
  reportId: string;
  fileName: string;
  source: string;
  fileSizeMB: number;
  status: LogStatus;
  stage: LogStageId;
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: LogEvidence[];
  suggestedActions: string[];
  severity: LogSeverity;
  rawLines: string[];
  capturedAt: string;
  updatedAt: string;
  updatedAtIso: string;
  submittedBy: string;
  relatedParameterId?: string;
  relatedParameterProjectId?: string;
  device?: string;
  failureReason?: string;
  analysisQuestion?: string;
  archiveState?: LogArchiveState;
  logDomainId?: string;
  logDomainName?: string;
  /** Analyzer provenance; "rules-fallback" marks a degraded analysis and must stay visible. */
  analysisSource?: LogAnalysisSource;
  degradedReason?: LogDegradedReason;
};
