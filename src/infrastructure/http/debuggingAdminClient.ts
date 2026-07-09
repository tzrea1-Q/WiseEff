import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugNodeProtocolBinding,
  DebugNodeRegistryEntry,
  DebugParameter,
  DebugParameterAccessMode
} from "@/domain/debugging/types";
import { normalizeBindingNodePath } from "@/domain/debugging/bindingNodePath";
import { createApiClient } from "./apiClient";
import type { ParameterReloadTargetDto } from "./debuggingDtos";
import {
  debugAdminBindingFromDto,
  debugAdminModuleFromDto,
  debugAdminNodeBindingFromDto,
  debugAdminNodeFromDto,
  debugAdminParameterFromDto,
  debugAdminParameterToDto,
  debugAdminReloadBindingFromDto,
  type DebugAdminBindingDto,
  type DebugAdminBindingWriteDto,
  type DebugAdminParameterBindingWriteDto,
  type DebugAdminParameterDto,
  type DebugAdminNodeDto,
  type DebugAdminNodeWriteDto,
  type DebugAdminModuleDto,
  type DebugAdminReloadBindingDto,
  type DebugAdminReloadBindingWriteDto
} from "./debuggingAdminDtos";
import { createDefaultApiClient } from "./defaultApiClient";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";

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
  module?: string;
  moduleId?: string;
  includeDescendants?: boolean;
  risk?: string | string[];
  protocol?: DebugConnectionProtocol;
  coverage?: DebugAdminCoverageFilter;
  includeArchived?: boolean;
};

export type DebugAdminParameterPatch = Partial<Omit<DebugAdminParameterDraft, "bindings">> & {
  bindings?: DebugAdminParameterBindingWriteDto[];
};

export type CreateDebugNodeModuleAdminInput = {
  name: string;
  parentId?: string | null;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type UpdateDebugNodeModuleAdminInput = {
  name?: string;
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type MoveDebugNodeModuleAdminInput = {
  parentId: string | null;
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
  if (query?.moduleId) {
    params.set("moduleId", query.moduleId);
    if (query.includeDescendants === false) {
      params.set("includeDescendants", "false");
    }
  } else if (query?.module) {
    params.set("module", query.module);
  }
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

function adminNodesPath(query?: { protocol?: DebugConnectionProtocol; includeArchived?: boolean; moduleId?: string; includeDescendants?: boolean }) {
  const params = new URLSearchParams();
  if (query?.protocol) params.set("protocol", query.protocol);
  if (query?.includeArchived) params.set("includeArchived", "true");
  if (query?.moduleId) {
    params.set("moduleId", query.moduleId);
    if (query.includeDescendants === false) {
      params.set("includeDescendants", "false");
    }
  }
  return appendQuery("/api/v1/debugging/admin/nodes", params);
}

function adminNodePath(nodeId: string) {
  return `/api/v1/debugging/admin/nodes/${encodeURIComponent(nodeId)}`;
}

function adminNodeBindingPath(nodeId: string, protocol: DebugConnectionProtocol) {
  return `${adminNodePath(nodeId)}/bindings/${protocol}`;
}

function adminModulePath(moduleId: string) {
  return `/api/v1/debugging/admin/modules/${encodeURIComponent(moduleId)}`;
}

function appendReloadTargetsQuery(path: string, query?: { protocol?: DebugConnectionProtocol }) {
  const params = new URLSearchParams();
  if (query?.protocol) params.set("protocol", query.protocol);
  return appendQuery(path, params);
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
    nodePath: normalizeBindingNodePath(binding.nodePath),
    accessMode: binding.accessMode,
    enabled: binding.enabled,
    notes: binding.notes
  };
}

function parameterBindingWriteBody(binding: DebugAdminParameterBindingWriteDto): DebugAdminParameterBindingWriteDto {
  return {
    protocol: binding.protocol,
    nodePath: normalizeBindingNodePath(binding.nodePath),
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
    },
    async listNodes(query?: {
      protocol?: DebugConnectionProtocol;
      includeArchived?: boolean;
      moduleId?: string;
      includeDescendants?: boolean;
    }) {
      const response = await apiClient.get<ItemsEnvelope<DebugAdminNodeDto>>(adminNodesPath(query));
      return response.items.map(debugAdminNodeFromDto);
    },
    async createNode(draft: DebugAdminNodeWriteDto): Promise<DebugNodeRegistryEntry> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminNodeDto>>("/api/v1/debugging/admin/nodes", draft);
      return debugAdminNodeFromDto(response.item);
    },
    async updateNode(nodeId: string, patch: Partial<DebugAdminNodeWriteDto>): Promise<DebugNodeRegistryEntry> {
      const response = await apiClient.patch<ItemEnvelope<DebugAdminNodeDto>>(adminNodePath(nodeId), patch);
      return debugAdminNodeFromDto(response.item);
    },
    async upsertNodeBinding(nodeId: string, protocol: DebugConnectionProtocol, binding: DebugAdminBindingInput): Promise<DebugNodeProtocolBinding> {
      const response = await apiClient.put<ItemEnvelope<DebugAdminBindingDto>>(
        adminNodeBindingPath(nodeId, protocol),
        bindingWriteBody(binding)
      );
      return debugAdminNodeBindingFromDto(response.item);
    },
    async archiveNodeBinding(nodeId: string, protocol: DebugConnectionProtocol): Promise<DebugNodeProtocolBinding> {
      const response = await apiClient.post<ItemEnvelope<DebugAdminBindingDto>>(`${adminNodeBindingPath(nodeId, protocol)}/archive`, {});
      return debugAdminNodeBindingFromDto(response.item);
    },
    async listModules(): Promise<FlatModuleNode[]> {
      const response = await apiClient.get<ItemsEnvelope<DebugAdminModuleDto>>("/api/v1/debugging/admin/modules");
      return response.items.map(debugAdminModuleFromDto);
    },
    async createModule(input: CreateDebugNodeModuleAdminInput) {
      const response = await apiClient.post<ItemEnvelope<DebugAdminModuleDto>>(
        "/api/v1/debugging/admin/modules",
        input
      );
      return debugAdminModuleFromDto(response.item);
    },
    async updateModule(moduleId: string, patch: UpdateDebugNodeModuleAdminInput) {
      const response = await apiClient.patch<ItemEnvelope<DebugAdminModuleDto>>(adminModulePath(moduleId), patch);
      return debugAdminModuleFromDto(response.item);
    },
    async moveModule(moduleId: string, input: MoveDebugNodeModuleAdminInput) {
      const response = await apiClient.post<ItemEnvelope<DebugAdminModuleDto>>(
        `${adminModulePath(moduleId)}/move`,
        input
      );
      return debugAdminModuleFromDto(response.item);
    },
    async deleteModule(moduleId: string) {
      await apiClient.delete(adminModulePath(moduleId));
    },
    async listReloadBindings() {
      const response = await apiClient.get<ItemsEnvelope<DebugAdminReloadBindingDto>>("/api/v1/debugging/admin/reload-bindings");
      return response.items.map(debugAdminReloadBindingFromDto);
    },
    async listReloadTargetCandidates(query?: { protocol?: DebugConnectionProtocol }): Promise<ParameterReloadTargetDto[]> {
      const response = await apiClient.get<ItemsEnvelope<ParameterReloadTargetDto>>(
        appendReloadTargetsQuery("/api/v1/debugging/reload-targets", query)
      );
      return response.items;
    },
    async upsertReloadBinding(input: DebugAdminReloadBindingWriteDto & { notes?: string | null }) {
      const response = await apiClient.put<ItemEnvelope<DebugAdminReloadBindingDto>>("/api/v1/debugging/admin/reload-bindings", input);
      return debugAdminReloadBindingFromDto(response.item);
    }
  };
}
