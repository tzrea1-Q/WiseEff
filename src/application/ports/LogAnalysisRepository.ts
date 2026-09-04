import type {
  LogDomain,
  LogDomainKnowledgeLink,
  LogDomainStatus,
  LogFeedbackInsight,
  LogRecord,
  LogWebhookDelivery,
  TimeWindow
} from "@/domain/logs/types";

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

export type LogRelatedParameterPin = {
  kind: "canonical-pin";
  bindingId: string;
  definitionId?: string;
  definitionRevisionId?: string;
};

export type LogUploadInput = {
  file: File;
  analysisQuestion?: string;
  relatedParameterId?: string;
  relatedParameterPin?: LogRelatedParameterPin;
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
  /** undefined = keep; null = clear back to the global model (P3b). */
  modelOverride?: string | null;
};

/** Replace-style webhook config; `secret` undefined keeps the stored secret, null clears it. */
export type LogDomainWebhookInput = {
  domainId: string;
  url: string | null;
  enabled: boolean;
  secret?: string | null;
};

export type LogWebhookTestOutcome = {
  status: "delivered" | "failed" | "skipped";
  attempts: number;
  httpStatus?: number;
  error?: string;
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

export type LogFeedbackInsightsQuery = {
  timeWindow?: TimeWindow;
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
  listFeedbackInsights?(query?: LogFeedbackInsightsQuery): Promise<LogFeedbackInsight[]>;
  setLogDomainWebhook?(input: LogDomainWebhookInput): Promise<LogDomain>;
  listLogDomainWebhookDeliveries?(domainId: string, limit?: number): Promise<LogWebhookDelivery[]>;
  sendLogDomainWebhookTest?(domainId: string): Promise<LogWebhookTestOutcome>;
}
