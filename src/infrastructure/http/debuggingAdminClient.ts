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
export const DEBUG_CATALOG_FORMAT_V2 = "wiseeff.debug-node-catalog.v2" as const;

/** Mirrors the server contract: one debug catalog document is capped at 20 MiB of UTF-8. */
export const DEBUG_CATALOG_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

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
  valueKind?: string;
  valueFormat?: string;
  normalizationMode?: string;
  maxValueBytes?: number | null;
  enabled?: boolean;
  bindings?: Array<{
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode: DebugParameterAccessMode;
    enabled?: boolean;
    notes?: string | null;
  }>;
};

export type DebugCatalogV2Module = {
  name: string;
  parentNamePath: string[];
  description?: string;
  scope?: string;
  sortOrder?: number;
};

export type DebugCatalogV2Node = {
  sourceId?: string;
  name: string;
  description?: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  moduleNamePath: string[];
  valueKind?: string;
  valueFormat?: string;
  normalizationMode?: string;
  maxValueBytes?: number | null;
  enabled?: boolean;
  archived?: boolean;
  archiveReason?: string | null;
  bindings?: Array<{
    protocol: DebugConnectionProtocol;
    nodePath: string;
    accessMode: DebugParameterAccessMode;
    enabled?: boolean;
    notes?: string | null;
  }>;
};

export type DebugCatalogV1Document = {
  format: typeof DEBUG_CATALOG_FORMAT_V1;
  modules: DebugCatalogModule[];
  nodes: DebugCatalogNode[];
};

export type DebugCatalogV2Document = {
  format: typeof DEBUG_CATALOG_FORMAT_V2;
  source: { organizationId?: string; organizationName?: string; exportedAt?: string };
  counts: { modules: number; nodes: number; bindings: number };
  modules: DebugCatalogV2Module[];
  nodes: DebugCatalogV2Node[];
};

/** Any document the server accepts: the current v2 export plus legacy v1 files. */
export type DebugCatalogDocument = DebugCatalogV2Document | DebugCatalogV1Document;

export type DebugCatalogV1Node = DebugCatalogNode;

export type DebugCatalogExportResult = {
  document: DebugCatalogDocument;
  counts: { modules: number; nodes: number; bindings: number };
  organizationId: string;
  fileBytes: number;
};

export type CatalogImportClassification = "created" | "updated" | "unchanged";

export type CatalogImportFieldDifference = {
  field: string;
  before: unknown;
  after: unknown;
};

export type CatalogImportDifferenceDetail = {
  path: string;
  name: string;
  object: "module" | "node" | "binding";
  classification: CatalogImportClassification;
  fields: CatalogImportFieldDifference[];
};

export type CatalogImportConflict = {
  code: string;
  location: string;
  message: string;
  object?: "module" | "node" | "binding";
};

export type CatalogImportWarning = {
  code: string;
  location: string;
  message: string;
};

export type CatalogImportPreview = {
  canSubmit: boolean;
  previewDigest: string | null;
  format: string;
  sourceOrganization: { organizationId?: string; organizationName?: string; exportedAt?: string } | null;
  targetOrganizationId: string;
  fileCounts: { modules: number; nodes: number; bindings: number };
  declaredCounts: { modules: number; nodes: number; bindings: number } | null;
  modules: Record<CatalogImportClassification, number>;
  nodes: Record<CatalogImportClassification, number>;
  bindings: Record<CatalogImportClassification, number>;
  details: CatalogImportDifferenceDetail[];
  detailsTruncated: boolean;
  conflicts: CatalogImportConflict[];
  /** Declared-count contradictions, separate from identity/reference conflicts. */
  countConflicts: CatalogImportConflict[];
  warnings: CatalogImportWarning[];
};

export type DebugCatalogImportResult = {
  modulesCreated: number;
  modulesUpdated: number;
  modulesUnchanged: number;
  nodesCreated: number;
  nodesUpdated: number;
  nodesUnchanged: number;
  bindingsCreated: number;
  bindingsUpdated: number;
  bindingsUnchanged: number;
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
    async deleteNode(nodeId: string): Promise<void> {
      await apiClient.delete(adminNodePath(nodeId));
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
    /**
     * Downloads the complete org catalog. Export is always a full snapshot: the server no
     * longer narrows it by search, module, protocol, paging or tree state.
     */
    async exportCatalog(): Promise<DebugCatalogExportResult> {
      const params = new URLSearchParams({ includeArchived: "true" });
      const response = await apiClient.get<ItemEnvelope<DebugCatalogExportResult>>(
        appendQuery("/api/v1/debugging/admin/catalog/export", params)
      );
      return response.item;
    },
    /** Server-side, read-only classification of a file against the current target catalog. */
    async previewCatalogImport(document: DebugCatalogDocument): Promise<CatalogImportPreview> {
      const response = await apiClient.post<ItemEnvelope<CatalogImportPreview>>(
        "/api/v1/debugging/admin/catalog/import-preview",
        document
      );
      return response.item;
    },
    /**
     * Applies a previewed file. The digest returned by `previewCatalogImport` is required:
     * the server rejects an import whose file or target changed after the preview.
     */
    async importCatalog(document: DebugCatalogDocument, previewDigest: string): Promise<DebugCatalogImportResult> {
      const response = await apiClient.post<ItemEnvelope<DebugCatalogImportResult>>(
        "/api/v1/debugging/admin/catalog/import",
        { document, previewDigest }
      );
      return response.item;
    }
  };
}
