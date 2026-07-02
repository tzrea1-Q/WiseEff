import type {
  DebugAdminParameterDraft,
  DebugConnectionProtocol,
  DebugNodeProtocolBinding,
  DebugNodeRegistryEntry,
  DebugParameter,
  DebugParameterAccessMode
} from "@/domain/debugging/types";
import { createApiClient } from "./apiClient";
import type { ParameterReloadTargetDto } from "./debuggingDtos";
import {
  debugAdminBindingFromDto,
  debugAdminModuleFromDto,
  debugAdminModuleToDto,
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
import type { ParameterModuleDraft } from "@/powerManagementConfig";

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

function adminNodePath(nodeId: string) {
  return `/api/v1/debugging/admin/nodes/${encodeURIComponent(nodeId)}`;
}

function adminNodeBindingPath(nodeId: string, protocol: DebugConnectionProtocol) {
  return `${adminNodePath(nodeId)}/bindings/${protocol}`;
}

function adminModulePath(moduleName: string) {
  return `/api/v1/debugging/admin/modules/${encodeURIComponent(moduleName)}`;
}

function appendReloadTargetsQuery(path: string, query: { projectId: string; protocol?: DebugConnectionProtocol }) {
  const params = new URLSearchParams();
  params.set("projectId", query.projectId);
  if (query.protocol) params.set("protocol", query.protocol);
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
    },
    async listNodes(query?: { projectId?: string; protocol?: DebugConnectionProtocol; includeArchived?: boolean }) {
      const params = new URLSearchParams();
      if (query?.projectId) params.set("projectId", query.projectId);
      if (query?.protocol) params.set("protocol", query.protocol);
      if (query?.includeArchived) params.set("includeArchived", "true");
      const response = await apiClient.get<ItemsEnvelope<DebugAdminNodeDto>>(appendQuery("/api/v1/debugging/admin/nodes", params));
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
    async listModules() {
      const response = await apiClient.get<ItemsEnvelope<DebugAdminModuleDto>>("/api/v1/debugging/admin/modules");
      return response.items.map(debugAdminModuleFromDto);
    },
    async createModule(draft: ParameterModuleDraft) {
      const response = await apiClient.post<ItemEnvelope<DebugAdminModuleDto>>(
        "/api/v1/debugging/admin/modules",
        debugAdminModuleToDto(draft)
      );
      return debugAdminModuleFromDto(response.item);
    },
    async updateModule(moduleName: string, patch: Partial<ParameterModuleDraft>) {
      const response = await apiClient.patch<ItemEnvelope<DebugAdminModuleDto>>(adminModulePath(moduleName), debugAdminModuleToDto({
        name: patch.name ?? moduleName,
        description: patch.description ?? "",
        owner: patch.owner ?? "",
        scope: patch.scope ?? ""
      }));
      return debugAdminModuleFromDto(response.item);
    },
    async deleteModule(moduleName: string) {
      await apiClient.delete(adminModulePath(moduleName));
    },
    async listReloadBindings(query?: { projectId?: string }) {
      const params = new URLSearchParams();
      if (query?.projectId) params.set("projectId", query.projectId);
      const response = await apiClient.get<ItemsEnvelope<DebugAdminReloadBindingDto>>(appendQuery("/api/v1/debugging/admin/reload-bindings", params));
      return response.items.map(debugAdminReloadBindingFromDto);
    },
    async listReloadTargetCandidates(query: { projectId: string; protocol?: DebugConnectionProtocol }): Promise<ParameterReloadTargetDto[]> {
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
