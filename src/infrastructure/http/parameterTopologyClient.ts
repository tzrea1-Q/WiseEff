import type {
  BindingDraftResult,
  CreateBindingDraftInput,
  ParameterTopologyRepository
} from "@/application/ports/ParameterTopologyRepository";
import type {
  IdentityMappingTask,
  ParameterSpecDetail,
  ParameterSpecSummary,
  ProjectParameterBinding,
  ResolveSpecReviewInput,
  SpecQuery,
  SpecReviewTask,
  SpecReviewTaskListResult,
  SpecReviewTaskQuery,
  TopologyDiagnostic,
  TopologyTree,
  ValidationRun
} from "@/domain/parameter-topology/types";
import { createApiClient, WiseEffApiError } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
type ApiClient = ReturnType<typeof createApiClient>;

export type ProjectBindingDto = {
  id: string;
  parameterSpecId: string;
  parameterSpecVersionId: string;
  propertyKey: string;
  driverModule: string | null;
  logicalNodeId: string | null;
  instanceName: string | null;
  locator: string | null;
  effectiveValue: ProjectParameterBinding["effectiveValue"];
  rawValue: string;
  schemaState: ProjectParameterBinding["schemaState"];
  policyState: ProjectParameterBinding["policyState"];
};

export type ParameterSpecSummaryDto = ParameterSpecSummary;
export type ParameterSpecDetailDto = ParameterSpecDetail;
export type SpecReviewTaskDto = SpecReviewTask;

export type ParameterTopologyMappedError =
  | {
      kind: "stale-revision";
      message: string;
      reason: "stale-revision";
      bindingId?: string;
      baseRevisionId?: string;
      details: Record<string, unknown>;
      cause: WiseEffApiError;
    }
  | {
      kind: "diagnostics";
      message: string;
      diagnostics: TopologyDiagnostic[];
      details: Record<string, unknown>;
      cause: WiseEffApiError;
    }
  | {
      kind: "cancelled";
      message: string;
      cause: unknown;
    }
  | {
      kind: "api";
      message: string;
      code: string;
      details: Record<string, unknown>;
      cause: WiseEffApiError;
    }
  | {
      kind: "unknown";
      message: string;
      cause: unknown;
    };

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function buildSpecsPath(query: SpecQuery = {}) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.sourceKind) params.set("sourceKind", query.sourceKind);
  if (query.lifecycle) params.set("lifecycle", query.lifecycle);
  if (query.driverModule) params.set("driverModule", query.driverModule);
  if (query.propertyKey) params.set("propertyKey", query.propertyKey);
  return appendQuery("/api/v2/parameter-specs", params);
}

function buildSpecReviewTasksPath(query: SpecReviewTaskQuery = {}) {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return appendQuery("/api/v2/parameter-spec-review-tasks", params);
}

function buildBindingsPath(projectId: string, revisionId: string) {
  const params = new URLSearchParams({ revisionId });
  return appendQuery(`/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings`, params);
}

function buildTopologyPath(
  projectId: string,
  configSetId: string,
  revisionId: string,
  view: "source" | "effective"
) {
  const params = new URLSearchParams({ view });
  return appendQuery(
    `/api/v2/projects/${encodeURIComponent(projectId)}/config-sets/${encodeURIComponent(configSetId)}/revisions/${encodeURIComponent(revisionId)}/topology`,
    params
  );
}

function buildMappingTasksPath(projectId?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  return appendQuery("/api/v2/identity-mapping-tasks", params);
}

/** Maps wire DTO → domain binding. Never invents recommendedValue or path identity. */
export function bindingFromDto(dto: ProjectBindingDto): ProjectParameterBinding {
  return {
    id: dto.id,
    parameterSpecId: dto.parameterSpecId,
    parameterSpecVersionId: dto.parameterSpecVersionId,
    propertyKey: dto.propertyKey,
    driverModule: dto.driverModule,
    logicalNodeId: dto.logicalNodeId,
    instanceName: dto.instanceName,
    locator: dto.locator,
    effectiveValue: dto.effectiveValue,
    rawValue: dto.rawValue,
    schemaState: dto.schemaState,
    policyState: dto.policyState
  };
}

export function specSummaryFromDto(dto: ParameterSpecSummaryDto): ParameterSpecSummary {
  return {
    id: dto.id,
    organizationId: dto.organizationId ?? null,
    sourceKind: dto.sourceKind,
    specificationKey: dto.specificationKey,
    propertyKey: dto.propertyKey,
    driverModule: dto.driverModule,
    lifecycle: dto.lifecycle,
    currentVersionId: dto.currentVersionId,
    currentVersion: dto.currentVersion
  };
}

/** Keeps exampleValue / schemaDefault / policyTarget as distinct fields. */
export function specDetailFromDto(dto: ParameterSpecDetailDto): ParameterSpecDetail {
  return {
    ...specSummaryFromDto(dto),
    displayName: dto.displayName,
    description: dto.description,
    valueShape: dto.valueShape,
    schemaDefault: dto.schemaDefault,
    exampleValue: dto.exampleValue,
    schemaNamespace: dto.schemaNamespace,
    units: dto.units,
    constraints: dto.constraints,
    documentation: dto.documentation,
    compatiblePatterns: dto.compatiblePatterns,
    policyTarget: dto.policyTarget
  };
}

export function specReviewTaskFromDto(dto: SpecReviewTaskDto): SpecReviewTask {
  return {
    id: dto.id,
    status: dto.status,
    parameterSpecId: dto.parameterSpecId,
    propertyKey: dto.propertyKey,
    driverModule: dto.driverModule,
    evidence: dto.evidence,
    candidates: dto.candidates.map((candidate) => ({ id: candidate.id, label: candidate.label })),
    ambiguous: dto.ambiguous,
    projectCount: dto.projectCount,
    createdAt: dto.createdAt,
    resolvedAt: dto.resolvedAt,
    reason: dto.reason
  };
}

function mappingTaskFromDto(dto: IdentityMappingTask): IdentityMappingTask {
  return {
    id: dto.id,
    projectId: dto.projectId,
    configRevisionId: dto.configRevisionId,
    previousLogicalNodeId: dto.previousLogicalNodeId,
    candidateLogicalNodeIds: dto.candidateLogicalNodeIds,
    ...(dto.evidence != null ? { evidence: dto.evidence } : {}),
    status: dto.status,
    reason: dto.reason,
    createdAt: dto.createdAt,
    resolvedAt: dto.resolvedAt
  };
}

function validationRunFromDto(dto: ValidationRun): ValidationRun {
  return {
    id: dto.id,
    status: dto.status,
    stage: dto.stage,
    ...(dto.artifactHashes !== undefined ? { artifactHashes: dto.artifactHashes } : {}),
    ...(dto.diagnostics !== undefined ? { diagnostics: dto.diagnostics } : {})
  };
}

function bindingDraftFromDto(dto: BindingDraftResult): BindingDraftResult {
  return {
    draftId: dto.draftId,
    candidateRevisionId: dto.candidateRevisionId,
    rawText: dto.rawText,
    parameterSpecId: dto.parameterSpecId,
    projectParameterBindingId: dto.projectParameterBindingId,
    writeTarget: dto.writeTarget,
    overlayFileId: dto.overlayFileId,
    overlayFileName: dto.overlayFileName
  };
}

function isAbortError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

function readDiagnostics(details: Record<string, unknown>): TopologyDiagnostic[] | undefined {
  const diagnostics = details.diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return undefined;
  }
  return diagnostics as TopologyDiagnostic[];
}

export function isParameterTopologyStaleRevisionError(error: unknown): error is WiseEffApiError {
  return (
    error instanceof WiseEffApiError &&
    error.code === "CONFLICT" &&
    error.details?.reason === "stale-revision"
  );
}

export function isParameterTopologyValidationError(error: unknown): error is WiseEffApiError {
  if (!(error instanceof WiseEffApiError)) {
    return false;
  }
  if (error.code === "VALIDATION_FAILED") {
    return true;
  }
  return Array.isArray(error.details?.diagnostics) && error.details.diagnostics.length > 0;
}

/**
 * Preserve structured diagnostics and 409 stale-revision details.
 * Do not collapse them into a generic string.
 */
export function mapParameterTopologyError(error: unknown): ParameterTopologyMappedError {
  if (isAbortError(error)) {
    return {
      kind: "cancelled",
      message: error instanceof Error ? error.message : "Request cancelled.",
      cause: error
    };
  }

  if (isParameterTopologyStaleRevisionError(error)) {
    return {
      kind: "stale-revision",
      message: error.message,
      reason: "stale-revision",
      bindingId: typeof error.details.bindingId === "string" ? error.details.bindingId : undefined,
      baseRevisionId:
        typeof error.details.baseRevisionId === "string" ? error.details.baseRevisionId : undefined,
      details: error.details,
      cause: error
    };
  }

  if (error instanceof WiseEffApiError) {
    const diagnostics = readDiagnostics(error.details);
    if (diagnostics || error.code === "VALIDATION_FAILED") {
      return {
        kind: "diagnostics",
        message: error.message,
        diagnostics: diagnostics ?? [],
        details: error.details,
        cause: error
      };
    }
    return {
      kind: "api",
      message: error.message,
      code: error.code,
      details: error.details,
      cause: error
    };
  }

  return {
    kind: "unknown",
    message: error instanceof Error ? error.message : "Parameter topology request failed.",
    cause: error
  };
}

export function createHttpParameterTopologyRepository(
  apiClient: ApiClient = createDefaultApiClient()
): ParameterTopologyRepository {
  return {
    async listSpecs(query) {
      const response = await apiClient.get<ItemsEnvelope<ParameterSpecSummaryDto>>(buildSpecsPath(query));
      return response.items.map(specSummaryFromDto);
    },
    async getSpec(specId) {
      const response = await apiClient.get<ItemEnvelope<ParameterSpecDetailDto>>(
        `/api/v2/parameter-specs/${encodeURIComponent(specId)}`
      );
      return specDetailFromDto(response.item);
    },
    async listSpecReviewTasks(query = {}) {
      const response = await apiClient.get<{ items: SpecReviewTaskDto[]; nextCursor: string | null }>(
        buildSpecReviewTasksPath(query)
      );
      return {
        items: response.items.map(specReviewTaskFromDto),
        nextCursor: response.nextCursor
      } satisfies SpecReviewTaskListResult;
    },
    async resolveSpecReviewTask(taskId, input: ResolveSpecReviewInput) {
      await apiClient.post<ItemEnvelope<{ id: string; status: string; draftCreated?: boolean; message?: string }>>(
        `/api/v2/parameter-spec-review-tasks/${encodeURIComponent(taskId)}/resolve`,
        input
      );
    },
    async activateParameterSpec(specId, input) {
      const response = await apiClient.post<ItemEnvelope<ParameterSpecDetailDto>>(
        `/api/v2/parameter-specs/${encodeURIComponent(specId)}/activate`,
        input
      );
      return specDetailFromDto(response.item);
    },
    async listBindings(projectId, revisionId) {
      const response = await apiClient.get<ItemsEnvelope<ProjectBindingDto>>(
        buildBindingsPath(projectId, revisionId)
      );
      return response.items.map(bindingFromDto);
    },
    async getTopology(projectId, configSetId, revisionId, view) {
      const response = await apiClient.get<ItemEnvelope<TopologyTree>>(
        buildTopologyPath(projectId, configSetId, revisionId, view)
      );
      return response.item;
    },
    async listMappingTasks(projectId) {
      const response = await apiClient.get<ItemsEnvelope<IdentityMappingTask>>(
        buildMappingTasksPath(projectId)
      );
      return response.items.map(mappingTaskFromDto);
    },
    async resolveMapping(taskId, input) {
      await apiClient.post<ItemEnvelope<{ id: string; status: string }>>(
        `/api/v2/identity-mapping-tasks/${encodeURIComponent(taskId)}/resolve`,
        input
      );
    },
    async validateRevision(projectId, revisionId) {
      const response = await apiClient.post<ItemEnvelope<ValidationRun>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/config-revisions/${encodeURIComponent(revisionId)}/validate`,
        {}
      );
      return validationRunFromDto(response.item);
    },
    async createBindingDraft(projectId, bindingId, input: CreateBindingDraftInput) {
      const response = await apiClient.post<ItemEnvelope<BindingDraftResult>>(
        `/api/v2/projects/${encodeURIComponent(projectId)}/parameter-bindings/${encodeURIComponent(bindingId)}/drafts`,
        input
      );
      return bindingDraftFromDto(response.item);
    }
  };
}

export type ParameterTopologyClient = ReturnType<typeof createHttpParameterTopologyRepository>;
