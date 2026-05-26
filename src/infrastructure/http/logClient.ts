import type {
  LogAnalysisRepository,
  LogFeedbackInput,
  LogListQuery,
  LogRerunInput,
  LogUploadInput
} from "@/application/ports/LogAnalysisRepository";
import type { LogRecord } from "@/domain/logs/types";
import { createApiClient, WiseEffApiError } from "./apiClient";
import {
  jobSnapshotFromDto,
  logListFromDto,
  logRecordFromDto,
  type LogJobDto,
  type LogRecordDto
} from "./logDtos";
import { wiseEffApiBaseUrl } from "./runtimeMode";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemEnvelope<T> = { item: T };
type OkEnvelope = { ok: true };
type LogUploadResponse = { fileObject: unknown; log: LogRecordDto; job: LogJobDto | null };
type LogRerunResponse = { log: LogRecordDto; job: LogJobDto };
type HttpLogAnalysisRepositoryOptions = { apiClient?: undefined; baseUrl?: string } | { apiClient: ApiClient; baseUrl: string };

const terminalJobStatuses = new Set(["complete", "failed"]);

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function buildLogsPath(query?: LogListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.status) params.set("status", backendStatus(query.status));
  if (query?.timeWindow) params.set("timeWindow", query.timeWindow);
  if (query?.includeArchived !== undefined) params.set("includeArchived", String(query.includeArchived));
  return appendQuery("/api/v1/logs", params);
}

function routeLogPath(logId: string) {
  return `/api/v1/logs/${encodeURIComponent(logId)}`;
}

function routeJobPath(jobId: string) {
  return `/api/v1/jobs/${encodeURIComponent(jobId)}`;
}

function apiUrl(baseUrl: string, path: string) {
  return new URL(path, baseUrl).toString();
}

function backendStatus(status: LogRecord["status"]) {
  if (status === "Complete") return "complete";
  if (status === "Failed") return "failed";
  return "processing";
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadBody(input: LogUploadInput, contentBase64: string) {
  return {
    projectId: input.projectId,
    fileName: input.file.name,
    contentType: input.file.type || "application/octet-stream",
    contentBase64,
    ...(input.analysisQuestion !== undefined ? { analysisQuestion: input.analysisQuestion } : {}),
    ...(input.relatedParameterId !== undefined ? { relatedParameterId: input.relatedParameterId } : {})
  };
}

function rerunBody(input: LogRerunInput) {
  return {
    ...(input.analysisQuestion !== undefined ? { analysisQuestion: input.analysisQuestion } : {})
  };
}

function feedbackBody(input: LogFeedbackInput) {
  return {
    rating: input.rating,
    ...(input.note !== undefined ? { note: input.note } : {})
  };
}

function isTerminalStatus(status: string | undefined) {
  return status !== undefined && terminalJobStatuses.has(status);
}

export function createHttpLogAnalysisRepository(
  options: HttpLogAnalysisRepositoryOptions = {}
): LogAnalysisRepository {
  const baseUrl = options.baseUrl ?? wiseEffApiBaseUrl;
  const apiClient = options.apiClient ?? createApiClient({ baseUrl });

  const repository: LogAnalysisRepository = {
    async listLogs(query?: LogListQuery) {
      const response = await apiClient.get<{ items: LogRecordDto[] }>(buildLogsPath(query));
      return logListFromDto(response);
    },
    async getLog(logId: string) {
      try {
        const response = await apiClient.get<ItemEnvelope<LogRecordDto>>(routeLogPath(logId));
        return logRecordFromDto(response.item);
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async uploadLog(input: LogUploadInput) {
      const response = await apiClient.post<LogUploadResponse>("/api/v1/log-files", uploadBody(input, await fileToBase64(input.file)));
      return {
        log: logRecordFromDto(response.log),
        job: response.job ? jobSnapshotFromDto(response.job) : null
      };
    },
    async getJob(jobId: string) {
      const response = await apiClient.get<ItemEnvelope<LogJobDto>>(routeJobPath(jobId));
      return jobSnapshotFromDto(response.item);
    },
    watchJob(jobId, onEvent) {
      let stopped = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let eventSource: EventSource | undefined;
      let eventSourceClosed = false;
      let lastStatus: string | undefined;

      const stopPolling = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      const closeEventSource = () => {
        if (eventSourceClosed) return;
        eventSourceClosed = true;
        eventSource?.close();
      };

      const cleanup = () => {
        stopped = true;
        stopPolling();
        closeEventSource();
      };

      const poll = async () => {
        try {
          const snapshot = await repository.getJob(jobId);
          if (stopped) return;
          lastStatus = snapshot.status;
          onEvent(snapshot);
          if (!terminalJobStatuses.has(snapshot.status)) {
            timeoutId = setTimeout(poll, 1000);
          }
        } catch {
          if (!stopped) {
            timeoutId = setTimeout(poll, 1000);
          }
        }
      };

      const startPolling = () => {
        if (stopped || timeoutId) return;
        timeoutId = setTimeout(poll, 1000);
      };

      if (typeof EventSource !== "undefined") {
        eventSource = new EventSource(apiUrl(baseUrl, `${routeJobPath(jobId)}/events`));
        eventSource.addEventListener("job", (event) => {
          const snapshot = jobSnapshotFromDto(JSON.parse(event.data) as LogJobDto);
          lastStatus = snapshot.status;
          onEvent(snapshot);
          if (terminalJobStatuses.has(snapshot.status)) {
            cleanup();
          }
        });
        eventSource.onerror = () => {
          closeEventSource();
          if (!isTerminalStatus(lastStatus)) {
            startPolling();
          }
        };
        return cleanup;
      }

      void poll();
      return cleanup;
    },
    async rerunLog(input: LogRerunInput) {
      const response = await apiClient.post<LogRerunResponse>(`${routeLogPath(input.logId)}/rerun`, rerunBody(input));
      return {
        log: logRecordFromDto(response.log),
        job: jobSnapshotFromDto(response.job)
      };
    },
    async archiveLog(logId: string) {
      await apiClient.post<ItemEnvelope<LogRecordDto>>(`${routeLogPath(logId)}/archive`, {});
    },
    async unarchiveLog(logId: string) {
      await apiClient.post<ItemEnvelope<LogRecordDto>>(`${routeLogPath(logId)}/unarchive`, {});
    },
    async submitFeedback(input: LogFeedbackInput) {
      await apiClient.post<OkEnvelope>(`${routeLogPath(input.logId)}/feedback`, feedbackBody(input));
    }
  };

  return repository;
}
