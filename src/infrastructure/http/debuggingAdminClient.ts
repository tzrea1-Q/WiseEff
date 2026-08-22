import type {
  DebugConnectionProtocol,
  DebugNodeProtocolBinding,
  DebugNodeRegistryEntry,
  DebugParameterAccessMode
} from "@/domain/debugging/types";
import { normalizeBindingNodePath } from "@/domain/debugging/bindingNodePath";
import { createApiClient } from "./apiClient";
import {
  debugAdminModuleFromDto,
  debugAdminNodeBindingFromDto,
  debugAdminNodeFromDto,
  type DebugAdminBindingDto,
  type DebugAdminBindingWriteDto,
  type DebugAdminNodeDto,
  type DebugAdminNodeWriteDto,
  type DebugAdminModuleDto
} from "./debuggingAdminDtos";
import { createDefaultApiClient } from "./defaultApiClient";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";

type ApiClient = ReturnType<typeof createApiClient>;
type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };

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

export const DEBUG_CATALOG_FORMAT_V1 = "wiseeff.debug-node-catalog.v1" as const;

export type DebugCatalogModule = {
  name: string;
  parentNamePath: string[];
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type DebugCatalogNode = {
  id?: string;
  name: string;
  description?: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  module?: string;
  moduleId?: string;
  moduleNamePath?: string[];
  enabled?: boolean;
  bindings?: Array<{
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode: DebugParameterAccessMode;
    enabled?: boolean;
    notes?: string;
  }>;
};

export type DebugCatalogDocument = {
  format: typeof DEBUG_CATALOG_FORMAT_V1;
  modules: DebugCatalogModule[];
  nodes: DebugCatalogNode[];
};

export type DebugCatalogImportResult = {
  modulesCreated: number;
  modulesUpdated: number;
  nodesCreated: number;
  nodesUpdated: number;
  bindingsUpserted: number;
};

type DebugAdminBindingInput = DebugAdminBindingWriteDto & {
  accessMode: DebugParameterAccessMode;
};

function appendQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
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

function bindingWriteBody(binding: DebugAdminBindingInput): DebugAdminBindingWriteDto {
  return {
    nodePath: normalizeBindingNodePath(binding.nodePath),
    accessMode: binding.accessMode,
    enabled: binding.enabled,
    notes: binding.notes
  };
}

export function createDebuggingAdminClient(apiClient: ApiClient = createDefaultApiClient()) {
  return {
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
    async exportCatalog(query?: { includeArchived?: boolean }): Promise<DebugCatalogDocument> {
      const params = new URLSearchParams();
      if (query?.includeArchived !== false) {
        params.set("includeArchived", "true");
      }
      const response = await apiClient.get<ItemEnvelope<DebugCatalogDocument>>(
        appendQuery("/api/v1/debugging/admin/catalog/export", params)
      );
      return response.item;
    },
    async importCatalog(document: DebugCatalogDocument): Promise<DebugCatalogImportResult> {
      const response = await apiClient.post<ItemEnvelope<DebugCatalogImportResult>>(
        "/api/v1/debugging/admin/catalog/import",
        document
      );
      return response.item;
    }
  };
}
