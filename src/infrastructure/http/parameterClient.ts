import type {
  ApplyParameterImportBatchInput,
  ChangeRequestListQuery,
  ParameterImportPreviewInput,
  ParameterListQuery,
  ParameterRepository,
  ReviewParameterChangeInput,
  SubmissionRoundListQuery
} from "@/application/ports/ParameterRepository";
import { createApiClient } from "./apiClient";
import {
  changeRequestFromDto,
  importBatchFromDto,
  parameterDraftFromDto,
  parameterHistoryEntryFromDto,
  parameterRecordFromDto,
  projectFromDto,
  submissionRoundFromDto,
  type ChangeRequestDto,
  type ParameterDraftDto,
  type ParameterHistoryEntryDto,
  type ParameterImportBatchDto,
  type ParameterRecordDto,
  type ParameterSubmissionRoundDto,
  type ProjectDto
} from "./parameterDtos";
import { wiseEffApiBaseUrl } from "./runtimeMode";

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
type OkEnvelope = { ok: true };

type ApiClient = ReturnType<typeof createApiClient>;

const changeRequestStatusToDto: Record<NonNullable<ChangeRequestListQuery["status"]>[number], string> = {
  硬件Committer检视: "hardware_review",
  软件Committer检视: "software_review",
  软件User合入: "software_merge",
  待审阅: "submitted",
  自动检查通过: "software_review",
  等待合入: "software_merge",
  已合入: "merged",
  已打回: "rejected"
};

const submissionRoundStatusToDto: Record<NonNullable<SubmissionRoundListQuery["status"]>[number], string> = {
  ...changeRequestStatusToDto,
  已撤回: "withdrawn",
  已暂存: "stashed"
};

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function buildParametersPath(query?: ParameterListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.module) params.set("module", query.module);
  for (const risk of query?.risk ?? []) params.append("risk", risk);
  return appendQuery("/api/v1/parameters", params);
}

function buildDraftsPath(projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  return appendQuery("/api/v1/parameter-drafts/mine", params);
}

function buildChangeRequestsPath(query?: ChangeRequestListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.assignedTo) params.set("assignedTo", query.assignedTo);
  for (const status of query?.status ?? []) params.append("status", changeRequestStatusToDto[status]);
  return appendQuery("/api/v1/parameter-change-requests", params);
}

function buildSubmissionRoundsPath(query?: SubmissionRoundListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  for (const status of query?.status ?? []) params.append("status", submissionRoundStatusToDto[status]);
  return appendQuery("/api/v1/parameter-submission-rounds", params);
}

function reviewBody(input: ReviewParameterChangeInput) {
  return {
    decision: input.decision,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {})
  };
}

function applyImportBody(input: ApplyParameterImportBatchInput) {
  return {
    ...(input.selectedItemIds !== undefined ? { selectedItemIds: input.selectedItemIds } : {})
  };
}

export function createHttpParameterRepository(apiClient: ApiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })): ParameterRepository {
  return {
    async listProjects() {
      const response = await apiClient.get<ItemsEnvelope<ProjectDto>>("/api/v1/projects");
      return response.items.map(projectFromDto);
    },
    async listParameters(query?: ParameterListQuery) {
      const response = await apiClient.get<ItemsEnvelope<ParameterRecordDto>>(buildParametersPath(query));
      return response.items.map(parameterRecordFromDto);
    },
    async getParameter(parameterId: string) {
      const response = await apiClient.get<ItemEnvelope<ParameterRecordDto>>(`/api/v1/parameters/${encodeURIComponent(parameterId)}`);
      return parameterRecordFromDto(response.item);
    },
    async listParameterHistory(parameterId: string) {
      const response = await apiClient.get<ItemsEnvelope<ParameterHistoryEntryDto>>(`/api/v1/parameters/${encodeURIComponent(parameterId)}/history`);
      return response.items.map(parameterHistoryEntryFromDto);
    },
    async listDrafts(projectId?: string) {
      const response = await apiClient.get<ItemsEnvelope<ParameterDraftDto>>(buildDraftsPath(projectId));
      return response.items.map(parameterDraftFromDto);
    },
    async saveDraft(input) {
      const response = await apiClient.post<ItemEnvelope<ParameterDraftDto>>("/api/v1/parameter-drafts", input);
      return parameterDraftFromDto(response.item);
    },
    async deleteDraft(draftId: string) {
      await apiClient.delete<OkEnvelope>(`/api/v1/parameter-drafts/${encodeURIComponent(draftId)}`);
    },
    async listChangeRequests(query?: ChangeRequestListQuery) {
      const response = await apiClient.get<ItemsEnvelope<ChangeRequestDto>>(buildChangeRequestsPath(query));
      return response.items.map(changeRequestFromDto);
    },
    async listSubmissionRounds(query?: SubmissionRoundListQuery) {
      const response = await apiClient.get<ItemsEnvelope<ParameterSubmissionRoundDto>>(buildSubmissionRoundsPath(query));
      return response.items.map(submissionRoundFromDto);
    },
    async submitParameterChanges(input) {
      const response = await apiClient.post<ItemEnvelope<ParameterSubmissionRoundDto>>("/api/v1/parameter-submission-rounds", input);
      return submissionRoundFromDto(response.item);
    },
    async reviewChange(input: ReviewParameterChangeInput) {
      const response = await apiClient.post<ItemEnvelope<ChangeRequestDto>>(
        `/api/v1/parameter-change-requests/${encodeURIComponent(input.requestId)}/review`,
        reviewBody(input)
      );
      return changeRequestFromDto(response.item);
    },
    async createImportPreview(input: ParameterImportPreviewInput) {
      const response = await apiClient.post<ItemEnvelope<ParameterImportBatchDto>>("/api/v1/parameter-import-batches", input);
      return importBatchFromDto(response.item);
    },
    async applyImportBatch(input: ApplyParameterImportBatchInput) {
      const response = await apiClient.post<ItemEnvelope<ParameterImportBatchDto>>(
        `/api/v1/parameter-import-batches/${encodeURIComponent(input.batchId)}/apply`,
        applyImportBody(input)
      );
      return importBatchFromDto(response.item);
    }
  };
}
