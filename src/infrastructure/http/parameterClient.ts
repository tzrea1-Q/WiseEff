import { z } from "zod";

import type {
  ApplyParameterImportBatchInput,
  ChangeRequestListQuery,
  DtsImportParseResult,
  ParameterImportPreviewInput,
  ParameterListQuery,
  ParameterRepository,
  ReviewParameterChangeInput,
  SubmissionRoundListQuery,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import { createApiClient, WiseEffApiError } from "./apiClient";
import { parseContractDto } from "./parseContractDto";
import {
  parameterChangeRequestListResponseSchema,
  parameterChangeRequestResponseSchema,
  parameterDraftDtoSchema,
  parameterHistoryEntryDtoSchema,
  parameterImportBatchResponseSchema,
  parameterRecordDtoSchema,
  parameterSubmissionRoundListResponseSchema,
  parameterSubmissionRoundResponseSchema,
  projectListResponseSchema,
  projectValueDraftListResponseSchema
} from "@wiseeff/dto-schemas";
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
import type { CatalogBindingDraftDto } from "./parameterCatalogDtos";
import type { ParameterModuleNode } from "@/application/ports/ParameterRepository";
import { createDefaultApiClient } from "./defaultApiClient";

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
type OkEnvelope = { ok: true };
type SubmissionRoundApiListQuery = SubmissionRoundListQuery & { mine?: boolean };

type ApiClient = ReturnType<typeof createApiClient>;

const canonicalPinFields = {
  bindingId: z.string().optional(),
  effectiveRevisionId: z.string().optional(),
  currentValueId: z.string().optional()
};

const workbenchParameterRecordSchema = parameterRecordDtoSchema.extend(canonicalPinFields);
const workbenchHistoryEntrySchema = parameterHistoryEntryDtoSchema.extend(canonicalPinFields);
const workbenchDraftSchema = parameterDraftDtoSchema.extend(canonicalPinFields);
const workbenchParameterListSchema = z.object({ items: z.array(workbenchParameterRecordSchema) });
const workbenchParameterResponseSchema = z.object({ item: workbenchParameterRecordSchema });
const workbenchHistoryResponseSchema = z.object({ items: z.array(workbenchHistoryEntrySchema) });
const workbenchDraftListSchema = z.object({ items: z.array(workbenchDraftSchema) });
const workbenchDraftResponseSchema = z.object({ item: workbenchDraftSchema });

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
  if (query?.moduleId) params.set("moduleId", query.moduleId);
  if (query?.module) params.set("module", query.module);
  if (query?.includeDescendants === false) params.set("includeDescendants", "false");
  for (const risk of query?.risk ?? []) params.append("risk", risk);
  if (query?.limit !== undefined) params.set("limit", String(query.limit));
  return appendQuery("/api/v1/parameters", params);
}

function buildDraftsPath(projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  return appendQuery("/api/v1/parameter-drafts/mine", params);
}

function buildProjectValueDraftsPath(projectId: string) {
  return `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-value-drafts`;
}

function canonicalDraftToWorkbenchDraft(
  projectId: string,
  draft: CatalogBindingDraftDto
): ParameterDraftDto {
  return {
    id: draft.id,
    projectId,
    parameterId: draft.bindingId,
    targetValue: draft.targetValue,
    reason: draft.reason,
    updatedAt: draft.updatedAt,
    action: draft.action as "set" | "delete",
    sourceFormat: draft.sourceFormat as "dts" | "json",
    sourceTarget: draft.sourceTarget,
    baseRevisionId: draft.baseRevisionId,
    sourcePinId: draft.sourcePinId,
    candidateId: draft.candidateId,
    projectParameterBindingId: draft.bindingId,
    bindingId: draft.bindingId,
    effectiveRevisionId: draft.effectiveRevisionId,
    currentValueId: draft.currentValueId ?? undefined,
    candidateConfigRevisionId: draft.baseRevisionId
  };
}

function buildChangeRequestsPath(query?: ChangeRequestListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.assignedTo) params.set("assignedTo", query.assignedTo);
  for (const status of query?.status ?? []) params.append("status", changeRequestStatusToDto[status]);
  return appendQuery("/api/v1/parameter-change-requests", params);
}

function buildSubmissionRoundsPath(query?: SubmissionRoundApiListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.mine) params.set("mine", "true");
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
    ...(input.selectedItemIds !== undefined ? { selectedItemIds: input.selectedItemIds } : {}),
    ...(input.reviewMetadata !== undefined ? { reviewMetadata: input.reviewMetadata } : {})
  };
}

export function createHttpParameterRepository(apiClient: ApiClient = createDefaultApiClient()): ParameterRepository {
  return {
    async listProjects() {
      const response = parseContractDto(
        projectListResponseSchema,
        await apiClient.get<ItemsEnvelope<ProjectDto>>("/api/v1/projects"),
        "ProjectListResponse"
      );
      return response.items.map(projectFromDto);
    },
    async listParameterModules() {
      const response = await apiClient.get<ItemsEnvelope<ParameterModuleNode>>("/api/v1/parameter-modules");
      return response.items;
    },
    async listParameters(query?: ParameterListQuery) {
      const response = parseContractDto(
        workbenchParameterListSchema,
        await apiClient.get<ItemsEnvelope<ParameterRecordDto>>(buildParametersPath(query)),
        "ParameterListResponse"
      );
      return response.items.map(parameterRecordFromDto);
    },
    async getParameter(parameterId: string) {
      try {
        const response = parseContractDto(
          workbenchParameterResponseSchema,
          await apiClient.get<ItemEnvelope<ParameterRecordDto>>(
            `/api/v1/parameters/${encodeURIComponent(parameterId)}`
          ),
          "ParameterResponse"
        );
        return parameterRecordFromDto(response.item);
      } catch (error) {
        if (error instanceof WiseEffApiError && error.code === "GONE") {
          // The canonical Catalog answers an archived old link with the
          // `legacy-id-archived` diagnostic, while the pre-cutover surface used
          // `legacy-parameter-id-retired`. Both mean the same thing to the caller:
          // the record was archived and is not current data. Normalizing them here
          // keeps one archived outcome instead of letting the canonical diagnostic
          // fall through as a generic error.
          //
          // The diagnostic travels in `details.diagnostic` on the workbench route
          // and in `details.reason` on the operator Catalog route, so all three
          // carriers are read; the two routes disagree on the field name, and a
          // missed carrier would silently degrade an archived link to a generic
          // error.
          const carriers = [error.details?.diagnostic, error.details?.reason, error.message];
          const diagnostic = carriers.includes("legacy-id-archived")
            ? "legacy-id-archived"
            : carriers.includes("legacy-parameter-id-retired")
              ? "legacy-parameter-id-retired"
              : null;
          if (diagnostic) {
            throw new WiseEffApiError(
              "GONE",
              diagnostic,
              {
                ...error.details,
                diagnostic,
                migrationEvidenceId: error.details?.migrationEvidenceId
              },
              error.requestId
            );
          }
        }
        throw error;
      }
    },
    async listParameterHistory(parameterId: string) {
      const response = parseContractDto(
        workbenchHistoryResponseSchema,
        await apiClient.get<ItemsEnvelope<ParameterHistoryEntryDto>>(
          `/api/v1/parameters/${encodeURIComponent(parameterId)}/history`
        ),
        "ParameterHistoryResponse"
      );
      return response.items.map(parameterHistoryEntryFromDto);
    },
    async listDrafts(projectId?: string) {
      if (projectId && projectId.trim() !== "") {
        const response = parseContractDto(
          projectValueDraftListResponseSchema,
          await apiClient.get<unknown>(buildProjectValueDraftsPath(projectId)),
          "ProjectValueDraftListResponse"
        );
        return response.items.map((item) => canonicalDraftToWorkbenchDraft(projectId, item));
      }
      const response = parseContractDto(
        workbenchDraftListSchema,
        await apiClient.get<ItemsEnvelope<ParameterDraftDto>>(buildDraftsPath()),
        "ParameterDraftListResponse"
      );
      return response.items.map(parameterDraftFromDto);
    },
    async saveDraft(input) {
      const response = parseContractDto(
        workbenchDraftResponseSchema,
        await apiClient.post<ItemEnvelope<ParameterDraftDto>>("/api/v1/parameter-drafts", input),
        "ParameterDraftResponse"
      );
      return parameterDraftFromDto(response.item);
    },
    async deleteDraft(draftId: string, projectId?: string) {
      if (projectId && projectId.trim() !== "") {
        await apiClient.delete<OkEnvelope>(
          `${buildProjectValueDraftsPath(projectId)}/${encodeURIComponent(draftId)}`
        );
        return;
      }
      await apiClient.delete<OkEnvelope>(`/api/v1/parameter-drafts/${encodeURIComponent(draftId)}`);
    },
    async listChangeRequests(query?: ChangeRequestListQuery) {
      const response = parseContractDto(
        parameterChangeRequestListResponseSchema,
        await apiClient.get<ItemsEnvelope<ChangeRequestDto>>(buildChangeRequestsPath(query)),
        "ParameterChangeRequestListResponse"
      );
      return response.items.map(changeRequestFromDto);
    },
    async listSubmissionRounds(query?: SubmissionRoundApiListQuery) {
      const response = parseContractDto(
        parameterSubmissionRoundListResponseSchema,
        await apiClient.get<ItemsEnvelope<ParameterSubmissionRoundDto>>(buildSubmissionRoundsPath(query)),
        "ParameterSubmissionRoundListResponse"
      );
      return response.items.map(submissionRoundFromDto);
    },
    async listWorkflowAssignees(projectId: string) {
      const response = await apiClient.get<ItemEnvelope<WorkflowAssigneeCandidates>>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/parameter-workflow-assignees`,
      );
      return response.item;
    },
    async submitParameterChanges(input) {
      const response = parseContractDto(
        parameterSubmissionRoundResponseSchema,
        await apiClient.post<ItemEnvelope<ParameterSubmissionRoundDto>>("/api/v1/parameter-submission-rounds", input),
        "ParameterSubmissionRoundResponse"
      );
      return submissionRoundFromDto(response.item);
    },
    async withdrawSubmissionRound(roundId: string) {
      const response = parseContractDto(
        parameterSubmissionRoundResponseSchema,
        await apiClient.post<ItemEnvelope<ParameterSubmissionRoundDto>>(
          `/api/v1/parameter-submission-rounds/${encodeURIComponent(roundId)}/withdraw`,
          {}
        ),
        "ParameterSubmissionRoundResponse"
      );
      return submissionRoundFromDto(response.item);
    },
    async reviewChange(input: ReviewParameterChangeInput) {
      const response = parseContractDto(
        parameterChangeRequestResponseSchema,
        await apiClient.post<ItemEnvelope<ChangeRequestDto>>(
          `/api/v1/parameter-change-requests/${encodeURIComponent(input.requestId)}/review`,
          reviewBody(input)
        ),
        "ParameterChangeRequestResponse"
      );
      return changeRequestFromDto(response.item);
    },
    async createImportPreview(input: ParameterImportPreviewInput) {
      const response = parseContractDto(
        parameterImportBatchResponseSchema,
        await apiClient.post<ItemEnvelope<ParameterImportBatchDto>>("/api/v1/parameter-import-batches", input),
        "ParameterImportBatchResponse"
      );
      return importBatchFromDto(response.item);
    },
    async applyImportBatch(input: ApplyParameterImportBatchInput) {
      const response = parseContractDto(
        parameterImportBatchResponseSchema,
        await apiClient.post<ItemEnvelope<ParameterImportBatchDto>>(
          `/api/v1/parameter-import-batches/${encodeURIComponent(input.batchId)}/apply`,
          applyImportBody(input)
        ),
        "ParameterImportBatchResponse"
      );
      return importBatchFromDto(response.item);
    },
    async parseDtsImport(input) {
      return apiClient.post<DtsImportParseResult>("/api/v1/parameter-import/parse-dts", input);
    }
  };
}
