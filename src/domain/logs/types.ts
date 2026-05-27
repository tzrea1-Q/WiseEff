export type LogStageId = "parse" | "pattern" | "rootcause" | "report";

export type LogStatus = "Processing" | "Complete" | "Failed";

export type LogSeverity = "Critical" | "Warning" | "Info";

export type LogArchiveState = "active" | "archived";

export type TimeWindow = "today" | "7d" | "30d";

export type LogAdminRole = "Admin" | "Editor" | "Viewer";

export type LogAdminUserAvatarTone = "blue" | "teal" | "violet" | "slate";

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
  projectId: string;
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
