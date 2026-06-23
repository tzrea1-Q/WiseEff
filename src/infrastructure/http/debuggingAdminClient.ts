import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugParameter,
  DebugParameterAccessMode
} from "@/domain/debugging/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient } from "./defaultApiClient";
import {
  debugAdminBindingFromDto,
  debugAdminParameterFromDto,
  debugAdminParameterToDto,
  type DebugAdminBindingDto,
  type DebugAdminBindingWriteDto,
  type DebugAdminParameterBindingWriteDto,
  type DebugAdminParameterDto
} from "./debuggingAdminDtos";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };

export type DebugAdminCoverageFilter =
  | "dual-protocol"
  | "hdc-configured"
  | "adb-configured"
  | "missing-hdc"
  | "missing-adb"
  | "archived";

export type DebugAdminListQuery = {
  projectId?: string;
  module?: string;
  risk?: string | string[];
  protocol?: DebugConnectionProtocol;
  coverage?: DebugAdminCoverageFilter;
  includeArchived?: boolean;
};

export type DebugAdminParameterPatch = Partial<Omit<DebugAdminParameterDraft, "bindings">> & {
  bindings?: DebugAdminParameterBindingWriteDto[];
};

type DebugAdminBindingInput = DebugAdminBindingWriteDto & {
  accessMode: DebugParameterAccessMode;
};

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function adminParametersPath(query?: DebugAdminListQuery) {
  const params = new URLSearchParams();
  if (query?.projectId) params.set("projectId", query.projectId);
  if (query?.module) params.set("module", query.module);
  const risks = Array.isArray(query?.risk) ? query.risk : query?.risk ? [query.risk] : [];
  risks.forEach((risk) => params.append("risk", risk));
  if (query?.protocol) params.set("protocol", query.protocol);
  if (query?.coverage) params.set("coverage", query.coverage);
  if (query?.includeArchived) params.set("includeArchived", "true");
  return appendQuery("/api/v1/debugging/admin/parameters", params);
}

function adminParameterPath(parameterId: string) {
  return `/api/v1/debugging/admin/parameters/${encodeURIComponent(parameterId)}`;
}

function adminBindingPath(parameterId: string, protocol: DebugConnectionProtocol) {
  return `${adminParameterPath(parameterId)}/bindings/${protocol}`;
}

function parameterWriteBody(draftOrPatch: DebugAdminParameterDraft | DebugAdminParameterPatch) {
  if (isFullDraft(draftOrPatch)) {
    return debugAdminParameterToDto(draftOrPatch);
  }

  if (!draftOrPatch.bindings) {
    return draftOrPatch;
  }

  return {
    ...draftOrPatch,
    bindings: draftOrPatch.bindings.map(parameterBindingWriteBody)
  };
}

function isFullDraft(draftOrPatch: DebugAdminParameterDraft | DebugAdminParameterPatch): draftOrPatch is DebugAdminParameterDraft {
  return (
    typeof draftOrPatch.name === "string" &&
    typeof draftOrPatch.key === "string" &&
    typeof draftOrPatch.description === "string" &&
    typeof draftOrPatch.module === "string" &&
    typeof draftOrPatch.currentValue === "string" &&
    typeof draftOrPatch.targetValue === "string" &&
    typeof draftOrPatch.unit === "string" &&
    typeof draftOrPatch.range === "string" &&
    typeof draftOrPatch.risk === "string" &&
    typeof draftOrPatch.nodePath === "string" &&
    typeof draftOrPatch.accessMode === "string" &&
    typeof draftOrPatch.sortOrder === "number" &&
    typeof draftOrPatch.enabled === "boolean" &&
    Array.isArray(draftOrPatch.bindings)
  );
}

function bindingWriteBody(binding: DebugAdminBindingInput): DebugAdminBindingWriteDto {
  return {
    nodePath: binding.nodePath,
    accessMode: binding.accessMode,
    enabled: binding.enabled,
    notes: binding.notes
  };
}

function parameterBindingWriteBody(binding: DebugAdminParameterBindingWriteDto): DebugAdminParameterBindingWriteDto {
  return {
    protocol: binding.protocol,
    nodePath: binding.nodePath,
    accessMode: binding.accessMode,
    enabled: binding.enabled,
    notes: binding.notes
  };
}

export function createDebuggingAdminClient(apiClient: ApiClient = createDefaultApiClient()) {
  return {
    async listParameters(query?: DebugAdminListQuery): Promise<DebugParameter[]> {
      const response = await apiClient.get<ItemsEnvelope<DebugAdminParameterDto>>(adminParametersPath(query));
      return response.items.map(debugAdminParameterFromDto);
    },
    async createParameter(draft: DebugAdminParameterDraft): Promise<DebugParameter> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminParameterDto>>(
        "/api/v1/debugging/admin/parameters",
        debugAdminParameterToDto(draft)
      );
      return debugAdminParameterFromDto(response.item);
    },
    async updateParameter(parameterId: string, draftOrPatch: DebugAdminParameterDraft | DebugAdminParameterPatch): Promise<DebugParameter> {
      const response = await apiClient.patch<ItemEnvelope<DebugAdminParameterDto>>(
        adminParameterPath(parameterId),
        parameterWriteBody(draftOrPatch)
      );
      return debugAdminParameterFromDto(response.item);
    },
    async archiveParameter(parameterId: string, reason?: string): Promise<DebugParameter> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminParameterDto>>(
        `${adminParameterPath(parameterId)}/archive`,
        reason ? { reason } : {}
      );
      return debugAdminParameterFromDto(response.item);
    },
    async restoreParameter(parameterId: string): Promise<DebugParameter> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminParameterDto>>(`${adminParameterPath(parameterId)}/restore`, {});
      return debugAdminParameterFromDto(response.item);
    },
    async upsertBinding(parameterId: string, protocol: DebugConnectionProtocol, binding: DebugAdminBindingInput) {
      const response = await apiClient.put<ItemEnvelope<DebugAdminBindingDto>>(adminBindingPath(parameterId, protocol), bindingWriteBody(binding));
      return debugAdminBindingFromDto(response.item);
    },
    async archiveBinding(parameterId: string, protocol: DebugConnectionProtocol) {
      const response = await apiClient.post<ItemEnvelope<DebugAdminBindingDto>>(`${adminBindingPath(parameterId, protocol)}/archive`, {});
      return debugAdminBindingFromDto(response.item);
    }
  };
}
