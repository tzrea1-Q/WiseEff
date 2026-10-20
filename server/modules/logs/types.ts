import type { LogAnalysisDegradedReason, LogAnalysisSource } from "./analyzer";
import type { LogRecordStatus, LogRunStatus, LogStage } from "./status";
export type LogArchiveState = "active" | "archived";
export type LogFeedbackRating = "helpful" | "not_helpful";

export type LogLineRangeDto = {
  file: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  lines: Array<{ lineNumber: number; content: string }>;
};

export type LogEvidenceDto = {
  sourceLocation?: { snapshotId: string; path: string; line: number };
  sourceVersionLabel?: string;
  decodedFields?: import("./parsing/spec").DecodedEvent[];
  filePath?: string | null;
  id: string;
  stageId: LogStage;
  lineNumbers: number[];
  inference: string;
  suggestedAction: string;
  ruleHit?: string;
};

export type LogRecordDto = {
  knowledgeRevisions?: Array<{ entryId: string; revisionId?: string }>;
  sourceSnapshot?: import("./analyzer").AnalyzeLogInput["sourceSnapshot"];
  sourceSnapshotSelection?: "matched_version" | "default" | "none";
  requestedSourceVersion?: string;
  signalSummary?: import("./genericSignals").LogSignalSummary;
  files?: import("./filesRepository").LogFileDto[];
  skillRevision: { id: string; number: number } | null;
  id: string;
  reportId: string;
  fileName: string;
  source: string;
  fileSizeBytes: number;
  status: LogRecordStatus;
  archiveState: LogArchiveState;
  stage: LogStage;
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: LogEvidenceDto[];
  suggestedActions: string[];
  severity: "Critical" | "Warning" | "Info";
  rawLines: string[];
  capturedAt: string;
  updatedAt: string;
  submittedBy: string;
  createdByCredentialId?: string;
  createdByCredentialName?: string;
  relatedParameterId?: string;
  /** Present only when this canonical Binding association is visible to the caller. */
  relatedParameterProjectId?: string;
  device?: string;
  failureReason?: string;
  analysisQuestion?: string;
  /** Bound log domain; absent = uncategorized log domain. */
  logDomainId?: string;
  logDomainName?: string;
  /** Analyzer provenance; absent on legacy rule-analyzer reports. */
  analysisSource?: LogAnalysisSource;
  degradedReason?: LogAnalysisDegradedReason;
};

export type LogJobDto = {
  id: string;
  kind: "log-analysis";
  logId: string;
  runId: string;
  status: LogRunStatus;
  progress: number;
  currentStage: LogStage;
  error: string | null;
  updatedAt: string;
};
