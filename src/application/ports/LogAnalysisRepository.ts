import type { LogDomain, LogDomainKnowledgeLink, LogDomainStatus, LogRecord, TimeWindow } from "@/domain/logs/types";

export type LogRunStatus = "queued" | "processing" | "complete" | "failed";

export type LogListQuery = {
  status?: LogRecord["status"];
  timeWindow?: TimeWindow;
  includeArchived?: boolean;
};

export type LogJobSnapshot = {
  id: string;
  kind: "log-analysis";
  logId: string;
  runId: string;
  status: LogRunStatus;
  progress: number;
  currentStage: LogRecord["stage"];
  error: string | null;
  updatedAt: string;
};

export type LogUploadInput = {
  file: File;
  analysisQuestion?: string;
  relatedParameterId?: string;
  /** Optional log-domain binding; absent = 未分类域 (upload is never blocked by domain selection). */
  logDomainId?: string;
};

export type LogRerunInput = {
  logId: string;
  analysisQuestion?: string;
  logDomainId?: string;
};

export type LogDomainListQuery = {
  includeArchived?: boolean;
};

export type LogDomainCreateInput = {
  name: string;
  description?: string;
  formatProfile?: unknown;
};

export type LogDomainUpdateInput = {
  domainId: string;
  name?: string;
  description?: string | null;
  /** undefined = keep; null = clear the stored profile. */
  formatProfile?: unknown;
  status?: LogDomainStatus;
};

export type LogFeedbackInput = {
  logId: string;
  rating: "helpful" | "not_helpful";
  note?: string;
};

/** Replace-set semantics; only published knowledge entries are accepted server-side. */
export type LogDomainKnowledgeLinksInput = {
  domainId: string;
  knowledgeEntryIds: string[];
};

export interface LogAnalysisRepository {
  listLogs(query?: LogListQuery): Promise<LogRecord[]>;
  getLog(logId: string): Promise<LogRecord | null>;
  uploadLog(input: LogUploadInput): Promise<{ log: LogRecord; job: LogJobSnapshot | null }>;
  getJob(jobId: string): Promise<LogJobSnapshot>;
  watchJob?(jobId: string, onEvent: (snapshot: LogJobSnapshot) => void): () => void;
  rerunLog(input: LogRerunInput): Promise<{ log: LogRecord; job: LogJobSnapshot }>;
  archiveLog(logId: string): Promise<void>;
  unarchiveLog(logId: string): Promise<void>;
  submitFeedback(input: LogFeedbackInput): Promise<void>;
  listLogDomains?(query?: LogDomainListQuery): Promise<LogDomain[]>;
  createLogDomain?(input: LogDomainCreateInput): Promise<LogDomain>;
  updateLogDomain?(input: LogDomainUpdateInput): Promise<LogDomain>;
  archiveLogDomain?(domainId: string): Promise<LogDomain>;
  listLogDomainKnowledgeLinks?(domainId: string): Promise<LogDomainKnowledgeLink[]>;
  setLogDomainKnowledgeLinks?(input: LogDomainKnowledgeLinksInput): Promise<LogDomainKnowledgeLink[]>;
}
