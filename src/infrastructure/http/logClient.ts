import type {
  LogAnalysisRepository,
  LogDomainCreateInput,
  LogDomainKnowledgeLinksInput,
  LogDomainListQuery,
  LogDomainUpdateInput,
  LogDomainWebhookInput,
  LogFeedbackInput,
  LogFeedbackInsightsQuery,
  LogListQuery,
  LogRerunInput,
  LogUploadInput,
  LogWebhookTestOutcome
} from "@/application/ports/LogAnalysisRepository";
import type { LogRecord } from "@/domain/logs/types";
import { createApiClient, WiseEffApiError } from "./apiClient";
import { parseContractDto } from "./parseContractDto";
import {
  jobResponseSchema,
  logJobDtoSchema,
  logDomainKnowledgeLinkListResponseSchema,
  logDomainListResponseSchema,
  logSkillListResponseSchema,
  logSkillResponseSchema,
  logSkillRevisionResponseSchema,
  logSkillRevisionListResponseSchema,
  logSkillTemplateListResponseSchema,
  logSkillSampleResponseSchema,
  logSkillSampleReplaceResponseSchema,
  logSourceSnapshotListResponseSchema,
  logSourceSnapshotResponseSchema,
  logSourceEvidenceResponseSchema,
  logSourceLocateResponseSchema,
  logDomainResponseSchema,
  logFeedbackInsightsResponseSchema,
  logFileUploadResponseSchema,
  logRecordListResponseSchema,
  logRecordResponseSchema,
  logLineRangeResponseSchema,
  logRunResponseSchema,
  logWebhookDeliveryListResponseSchema,
  logWebhookTestOutcomeResponseSchema
} from "@wiseeff/dto-schemas";
import { parsePreviewResponseSchema, signalPreviewResponseSchema } from "@wiseeff/dto-schemas";
import {
  jobSnapshotFromDto,
  logDomainFromDto,
  logDomainKnowledgeLinkFromDto,
  logDomainListFromDto,
  logFeedbackInsightFromDto,
  logListFromDto,
  logRecordFromDto,
  logWebhookDeliveryFromDto,
  type LogDomainDto,
  type LogDomainKnowledgeLinkDto,
  type LogFeedbackInsightDto,
  type LogJobDto,
  type LogRecordDto,
  type LogWebhookDeliveryDto
} from "./logDtos";
import { createDefaultApiClient } from "./defaultApiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";

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
    fileName: input.file.name,
    contentType: input.file.type || "application/octet-stream",
    contentBase64,
    ...(input.sourceVersion !== undefined ? { sourceVersion: input.sourceVersion } : {}),
    ...(input.analysisQuestion !== undefined ? { analysisQuestion: input.analysisQuestion } : {}),
    ...(input.relatedParameterPin !== undefined ? { relatedParameterPin: input.relatedParameterPin } : {}),
    ...(input.logDomainId !== undefined ? { logDomainId: input.logDomainId } : {}),
    ...(input.skillId !== undefined ? { skillId: input.skillId } : {})
  };
}

function rerunBody(input: LogRerunInput) {
  return {
    ...(input.revisionPolicy !== undefined ? { revisionPolicy: input.revisionPolicy } : {}),
    ...(input.analysisQuestion !== undefined ? { analysisQuestion: input.analysisQuestion } : {}),
    ...(input.logDomainId !== undefined ? { logDomainId: input.logDomainId } : {}),
    ...(input.skillId !== undefined ? { skillId: input.skillId } : {})
  };
}

function buildLogDomainsPath(query?: LogDomainListQuery) {
  const params = new URLSearchParams();
  if (query?.includeArchived !== undefined) params.set("includeArchived", String(query.includeArchived));
  return appendQuery("/api/v1/log-domains", params);
}

function logDomainCreateBody(input: LogDomainCreateInput) {
  return {
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.formatProfile !== undefined ? { formatProfile: input.formatProfile } : {})
  };
}

function logDomainUpdateBody(input: LogDomainUpdateInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.formatProfile !== undefined ? { formatProfile: input.formatProfile } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.modelOverride !== undefined ? { modelOverride: input.modelOverride } : {})
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
  const baseUrl = options.baseUrl ?? resolveWiseEffApiBaseUrl();
  const apiClient = options.apiClient ?? createDefaultApiClient({ baseUrl });

  async function uploadFiles(input: LogUploadInput): Promise<LogUploadResponse> {
    if (!input.files) return apiClient.post<LogUploadResponse>("/api/v1/log-files", uploadBody(input, await fileToBase64(input.file)));
    const form = new FormData();
    if (input.sourceVersion !== undefined) form.append("sourceVersion", input.sourceVersion);
    for (const file of input.files) form.append("file", file);
    if (input.analysisQuestion) form.append("analysisQuestion", input.analysisQuestion);
    if (input.skillId ?? input.logDomainId) form.append("skillId", (input.skillId ?? input.logDomainId)!);
    if (input.relatedParameterPin) form.append("relatedParameterPin", JSON.stringify(input.relatedParameterPin));
    return (await apiClient.raw("/api/v1/log-files", { method: "POST", body: form })).json() as Promise<LogUploadResponse>;
  }
  const repository: LogAnalysisRepository = {
    async getLogLines(logId, file, startLine, endLine) {
      const params = new URLSearchParams({ file, startLine: String(startLine), endLine: String(endLine) });
      return parseContractDto(logLineRangeResponseSchema,
        await apiClient.get(appendQuery(`${routeLogPath(logId)}/lines`, params)), "LogLineRangeResponse").item;
    },
    async parsePreview(id, input) {
      return parseContractDto(parsePreviewResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/parse-preview`, input), "LogParsePreviewResponse");
    },
    async signalPreview(id, input) {
      return parseContractDto(signalPreviewResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/signals-preview`, input), "LogSignalPreviewResponse");
    },
    async getSkillSampleText(id) {
      try {
        const result = await apiClient.get<{ item: { content?: string; fileName?: string } | null }>(`/api/v1/log-skills/${encodeURIComponent(id)}/sample`);
        const text = result.item?.content;
        return typeof text === "string" ? { text, fileName: result.item?.fileName } : null;
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") return null;
        throw error;
      }
    },
    async listLogs(query?: LogListQuery) {
      const response = parseContractDto(
        logRecordListResponseSchema,
        await apiClient.get<{ items: LogRecordDto[] }>(buildLogsPath(query)),
        "LogRecordListResponse"
      );
      return logListFromDto(response);
    },
    async getLog(logId: string) {
      try {
        const response = parseContractDto(
          logRecordResponseSchema,
          await apiClient.get<ItemEnvelope<LogRecordDto>>(routeLogPath(logId)),
          "LogRecordResponse"
        );
        return logRecordFromDto(response.item);
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "NOT_FOUND") {
          return null;
        }
        throw error;
      }
    },
    async uploadLog(input: LogUploadInput) {
      const response = parseContractDto(
        logFileUploadResponseSchema,
        await uploadFiles(input),
        "LogFileUploadResponse"
      );
      return {
        log: logRecordFromDto(response.log),
        job: response.job ? jobSnapshotFromDto(response.job) : null
      };
    },
    async getJob(jobId: string) {
      const response = parseContractDto(
        jobResponseSchema,
        await apiClient.get<ItemEnvelope<LogJobDto>>(routeJobPath(jobId)),
        "JobResponse"
      );
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
          const snapshot = jobSnapshotFromDto(
            parseContractDto(logJobDtoSchema, JSON.parse(event.data), "LogJobDto")
          );
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
      const response = parseContractDto(
        logRunResponseSchema,
        await apiClient.post<LogRerunResponse>(`${routeLogPath(input.logId)}/rerun`, rerunBody(input)),
        "LogRunResponse"
      );
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
    },
    async listLogSkills(query?: LogDomainListQuery) {
      const response = parseContractDto(logSkillListResponseSchema,
        await apiClient.get(buildLogDomainsPath(query).replace("log-domains", "log-skills")), "LogSkillListResponse");
      return logDomainListFromDto(response);
    },
    async listSkillTemplates() {
      return parseContractDto(logSkillTemplateListResponseSchema, await apiClient.get("/api/v1/log-skill-templates"), "LogSkillTemplateListResponse").items;
    },
    async createLogSkill(input) {
      return parseContractDto(logSkillResponseSchema, await apiClient.post("/api/v1/log-skills", input), "LogSkillResponse").item;
    },
    async getSkillSample(id) {
      return parseContractDto(logSkillSampleResponseSchema, await apiClient.get(`/api/v1/log-skills/${encodeURIComponent(id)}/sample`), "LogSkillSampleResponse").item;
    },
    async replaceSkillSample(id, file) {
      parseContractDto(logSkillSampleReplaceResponseSchema, await apiClient.put(`/api/v1/log-skills/${encodeURIComponent(id)}/sample`, {
        fileName: file.name, contentBase64: await fileToBase64(file)
      }), "LogSkillSampleReplaceResponse");
    },
    async deleteSkillSample(id) {
      await apiClient.delete(`/api/v1/log-skills/${encodeURIComponent(id)}/sample`);
    },
    async getLogSkill(id) {
      return parseContractDto(logSkillResponseSchema, await apiClient.get(`/api/v1/log-skills/${encodeURIComponent(id)}`), "LogSkillResponse").item;
    },
    async listSkillRevisions(id) {
      return parseContractDto(logSkillRevisionListResponseSchema, await apiClient.get(`/api/v1/log-skills/${encodeURIComponent(id)}/revisions`), "LogSkillRevisionListResponse").items;
    },
    async saveSkillDraft(id, spec, baseDraftRevisionId, basePublishedRevisionId) {
      return parseContractDto(logSkillRevisionResponseSchema, await apiClient.put(`/api/v1/log-skills/${encodeURIComponent(id)}/draft`, { spec, baseDraftRevisionId, basePublishedRevisionId }), "LogSkillRevisionResponse").item;
    },
    async discardSkillDraft(id, draftRevisionId) {
      await apiClient.delete(`/api/v1/log-skills/${encodeURIComponent(id)}/draft?draftRevisionId=${encodeURIComponent(draftRevisionId)}`);
    },
    async publishSkill(id, draftRevisionId) {
      return parseContractDto(logSkillResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/publish`, { draftRevisionId }), "LogSkillResponse").item;
    },
    async restoreSkillRevision(id, revisionId) {
      return parseContractDto(logSkillResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`, {}), "LogSkillResponse").item;
    },
    async listSourceSnapshots(id) {
      return parseContractDto(logSourceSnapshotListResponseSchema, await apiClient.get(`/api/v1/log-skills/${encodeURIComponent(id)}/source-snapshots`), "LogSourceSnapshotListResponse").items;
    },
    async uploadSourceSnapshot(id, { versionLabel, file }) {
      const body = new FormData();
      body.append("versionLabel", versionLabel);
      body.append("file", file);
      const response = await apiClient.raw(`/api/v1/log-skills/${encodeURIComponent(id)}/source-snapshots`, { method: "POST", body });
      return parseContractDto(logSourceSnapshotResponseSchema, await response.json(), "LogSourceSnapshotResponse").item;
    },
    async setDefaultSourceSnapshot(id, snapshotId) {
      return parseContractDto(logSkillResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/source-snapshots/${encodeURIComponent(snapshotId)}/default`, {}), "LogSkillResponse").item;
    },
    async archiveSourceSnapshot(id, snapshotId) {
      return parseContractDto(logSourceSnapshotResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/source-snapshots/${encodeURIComponent(snapshotId)}/archive`, {}), "LogSourceSnapshotResponse").item;
    },
    async locateSourceStatement(id, snapshotId, line) {
      return parseContractDto(logSourceLocateResponseSchema, await apiClient.post(`/api/v1/log-skills/${encodeURIComponent(id)}/source-snapshots/${encodeURIComponent(snapshotId)}/locate`, { line }), "LogSourceLocateResponse");
    },
    async getSourceEvidence(logId, evidenceId) {
      return parseContractDto(logSourceEvidenceResponseSchema, await apiClient.get(`${routeLogPath(logId)}/evidence/${encodeURIComponent(evidenceId)}/source`), "LogSourceEvidenceResponse").item;
    },
    async listLogDomains(query?: LogDomainListQuery) {
      const response = parseContractDto(
        logDomainListResponseSchema,
        await apiClient.get<{ items: LogDomainDto[] }>(buildLogDomainsPath(query)),
        "LogDomainListResponse"
      );
      return logDomainListFromDto(response);
    },
    async createLogDomain(input: LogDomainCreateInput) {
      const response = parseContractDto(
        logDomainResponseSchema,
        await apiClient.post<ItemEnvelope<LogDomainDto>>("/api/v1/log-domains", logDomainCreateBody(input)),
        "LogDomainResponse"
      );
      return logDomainFromDto(response.item);
    },
    async updateLogDomain(input: LogDomainUpdateInput) {
      const response = parseContractDto(
        logDomainResponseSchema,
        await apiClient.patch<ItemEnvelope<LogDomainDto>>(
          `/api/v1/log-domains/${encodeURIComponent(input.domainId)}`,
          logDomainUpdateBody(input)
        ),
        "LogDomainResponse"
      );
      return logDomainFromDto(response.item);
    },
    async archiveLogDomain(domainId: string) {
      const response = parseContractDto(
        logDomainResponseSchema,
        await apiClient.post<ItemEnvelope<LogDomainDto>>(
          `/api/v1/log-domains/${encodeURIComponent(domainId)}/archive`,
          {}
        ),
        "LogDomainResponse"
      );
      return logDomainFromDto(response.item);
    },
    async listLogDomainKnowledgeLinks(domainId: string) {
      const response = parseContractDto(
        logDomainKnowledgeLinkListResponseSchema,
        await apiClient.get<{ items: LogDomainKnowledgeLinkDto[] }>(
          `/api/v1/log-domains/${encodeURIComponent(domainId)}/knowledge-links`
        ),
        "LogDomainKnowledgeLinkListResponse"
      );
      return response.items.map(logDomainKnowledgeLinkFromDto);
    },
    async setLogDomainKnowledgeLinks(input: LogDomainKnowledgeLinksInput) {
      const response = parseContractDto(
        logDomainKnowledgeLinkListResponseSchema,
        await apiClient.put<{ items: LogDomainKnowledgeLinkDto[] }>(
          `/api/v1/log-domains/${encodeURIComponent(input.domainId)}/knowledge-links`,
          { knowledgeEntryIds: input.knowledgeEntryIds }
        ),
        "LogDomainKnowledgeLinkListResponse"
      );
      return response.items.map(logDomainKnowledgeLinkFromDto);
    },
    async listFeedbackInsights(query?: LogFeedbackInsightsQuery) {
      const params = new URLSearchParams();
      if (query?.timeWindow) params.set("timeWindow", query.timeWindow);
      const response = parseContractDto(
        logFeedbackInsightsResponseSchema,
        await apiClient.get<{ items: LogFeedbackInsightDto[] }>(
          appendQuery("/api/v1/logs/feedback-insights", params)
        ),
        "LogFeedbackInsightsResponse"
      );
      return response.items.map(logFeedbackInsightFromDto);
    },
    async setLogDomainWebhook(input: LogDomainWebhookInput) {
      const response = parseContractDto(
        logDomainResponseSchema,
        await apiClient.put<ItemEnvelope<LogDomainDto>>(
          `/api/v1/log-domains/${encodeURIComponent(input.domainId)}/webhook`,
          {
            url: input.url,
            enabled: input.enabled,
            ...(input.secret !== undefined ? { secret: input.secret } : {})
          }
        ),
        "LogDomainResponse"
      );
      return logDomainFromDto(response.item);
    },
    async listLogDomainWebhookDeliveries(domainId: string, limit?: number) {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set("limit", String(limit));
      const response = parseContractDto(
        logWebhookDeliveryListResponseSchema,
        await apiClient.get<{ items: LogWebhookDeliveryDto[] }>(
          appendQuery(`/api/v1/log-domains/${encodeURIComponent(domainId)}/webhook-deliveries`, params)
        ),
        "LogWebhookDeliveryListResponse"
      );
      return response.items.map(logWebhookDeliveryFromDto);
    },
    async sendLogDomainWebhookTest(domainId: string) {
      const response = parseContractDto(
        logWebhookTestOutcomeResponseSchema,
        await apiClient.post<{ outcome: LogWebhookTestOutcome }>(
          `/api/v1/log-domains/${encodeURIComponent(domainId)}/webhook-test`,
          {}
        ),
        "LogWebhookTestOutcomeResponse"
      );
      return response.outcome;
    }
  };

  return repository;
}
