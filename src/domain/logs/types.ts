export type LogStageId = "parse" | "pattern" | "rootcause" | "report";

export type LogStatus = "Processing" | "Complete" | "Failed";

export type LogSeverity = "Critical" | "Warning" | "Info";

export type LogArchiveState = "active" | "archived";

export type TimeWindow = "today" | "7d" | "30d";

export type LogAdminRole = "Admin" | "Editor" | "Viewer";

export type LogAdminUserAvatarTone = "blue" | "teal" | "violet" | "slate";

export type LogAnalysisSource = "agent" | "rules-fallback";

export type LogDegradedReason = "provider-unavailable" | "token-budget-exhausted";

export type LogDomainStatus = "active" | "archived";

/** Org-scoped log domain registration (业务域); absence on a record = 未分类域. */
export type LogDomain = {
  id: string;
  name: string;
  description?: string;
  status: LogDomainStatus;
  formatProfile?: unknown;
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
  entryStatus: "draft" | "published" | "archived";
  entryTags: string[];
  linkedAt: string;
};

export type LogEvidence = {
  id: string;
  stageId: LogStageId;
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  ruleHit?: string;
};

export type LogRecord = {
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

export type LogAdminUser = {
  id: string;
  name: string;
  title: string;
  role: LogAdminRole;
  avatarInitials: string;
  avatarTone: LogAdminUserAvatarTone;
  lastActive: string;
  lastActiveIso: string;
};
