import type { LogRecord, TimeWindow } from "@/domain/logs/types";

export type LogListQuery = {
  projectId?: string;
  status?: LogRecord["status"];
  timeWindow?: TimeWindow;
  includeArchived?: boolean;
};

export type UploadLogInput = {
  fileName: string;
  supported: boolean;
  question?: string;
};

export interface LogAnalysisRepository {
  listLogs(query?: LogListQuery): Promise<LogRecord[]>;
  getLog(logId: string): Promise<LogRecord | null>;
  uploadLog(input: UploadLogInput): Promise<LogRecord>;
  archiveLog(logId: string): Promise<void>;
  unarchiveLog(logId: string): Promise<void>;
}
