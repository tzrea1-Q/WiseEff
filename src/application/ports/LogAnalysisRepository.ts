import type { LogRecord, TimeWindow } from "@/domain/logs/types";

export type LogRunStatus = "queued" | "processing" | "complete" | "failed";

export type LogListQuery = {
  projectId?: string;
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
  projectId: string;
  file: File;
  analysisQuestion?: string;
  relatedParameterId?: string;
};

export type LogRerunInput = {
  logId: string;
  analysisQuestion?: string;
};

export type LogFeedbackInput = {
  logId: string;
  rating: "helpful" | "not_helpful";
  note?: string;
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
}
