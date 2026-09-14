/**
 * Debug-node catalog transfer: full-set export, server-side import preview and atomic
 * merge import (Issue #846).
 *
 * Export reads one authoritative org-scoped snapshot (modules, every persisted node,
 * every binding) and renders `wiseeff.debug-node-catalog.v2`; legacy v1 documents stay
 * importable. Preview and execute share this module's parsing, matching and difference
 * rules, so the classification an admin confirms is the classification that is applied.
 *
 * Preview never writes. Execute runs inside one audited transaction, re-verifies that the
 * approved target state is unchanged, and applies every module, node and binding change or
 * none at all.
 */
import { createHash } from "node:crypto";
import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { withAuditedWrite } from "../audit/auditedWrite";
import { requireDebugAdmin } from "./policy";
import {
  createDebugNode,
  createDebugNodeModule,
  listAllDebugNodeBindings,
  listAllDebugNodes,
  listDebugNodeModules,
  updateDebugNodeModule,
  updateDebugNodePresence,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";
import {
  DEBUG_CATALOG_FORMAT_V1,
  DEBUG_CATALOG_FORMAT_V2,
  DEBUG_CATALOG_MAX_DOCUMENT_BYTES,
  debugCatalogDocumentSchema,
  debugCatalogV2DocumentSchema,
  type DebugCatalogV2Document
} from "./schemas";
import {
  DEBUG_NORMALIZATION_MODE_TRIM,
  DEBUG_VALUE_FORMAT_RAW,
  DEBUG_VALUE_KIND_SCALAR
} from "./types";
import type {
  DebugNodeBindingRecord,
  DebugNodeModuleRecord,
  DebugNodeRecord,
  DebugNormalizationMode,
  DebugValueFormat,
  DebugValueKind
} from "./types";
import type { DebugAccessMode } from "./status";
import type { DebugConnectionProtocol } from "./protocol";

export {
  DEBUG_CATALOG_FORMAT_V1,
  DEBUG_CATALOG_FORMAT_V2,
  DEBUG_CATALOG_MAX_DOCUMENT_BYTES
};

/** Preview responses cap per-object difference detail; classification totals stay exact. */
export const MAX_CATALOG_PREVIEW_DETAIL_ITEMS = 200;

export type CatalogImportExportContext = {
  requestId: string;
};

export type DebugCatalogV2Counts = {
  modules: number;
  nodes: number;
  bindings: number;
};

export type DebugCatalogSource = {
  organizationId?: string;
  organizationName?: string;
  exportedAt?: string;
};

export type DebugCatalogModuleExport = {
  name: string;
  parentNamePath: string[];
  description: string;
  scope: string;
  sortOrder: number;
};

export type DebugCatalogBindingExport = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  notes?: string;
};

export type DebugCatalogNodeExport = {
  sourceId: string;
  name: string;
  description: string;
  detailedDescription: string;
  writeFormatExample: string;
  writeFormatHint: string;
  moduleNamePath: string[];
  valueKind: DebugValueKind;
  valueFormat: DebugValueFormat;
  normalizationMode: DebugNormalizationMode;
  maxValueBytes: number | null;
  enabled: boolean;
  archived: boolean;
  archiveReason: string | null;
  bindings: DebugCatalogBindingExport[];
};

export type DebugCatalogExportDocument = {
  format: typeof DEBUG_CATALOG_FORMAT_V2;
  source: { organizationId: string; organizationName?: string; exportedAt: string };
  counts: DebugCatalogV2Counts;
  modules: DebugCatalogModuleExport[];
  nodes: DebugCatalogNodeExport[];
};

export type CatalogExportResult = {
  document: DebugCatalogExportDocument;
  counts: DebugCatalogV2Counts;
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
  sourceOrganization: DebugCatalogSource | null;
  targetOrganizationId: string;
  fileCounts: DebugCatalogV2Counts;
  declaredCounts: DebugCatalogV2Counts | null;
  modules: Record<CatalogImportClassification, number>;
  nodes: Record<CatalogImportClassification, number>;
  bindings: Record<CatalogImportClassification, number>;
  details: CatalogImportDifferenceDetail[];
  detailsTruncated: boolean;
  conflicts: CatalogImportConflict[];
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

type CatalogBindingValue = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  notes?: string | null;
  /**
   * Names of the optional fields this entry actually declared. v1 applies schema defaults
   * for legacy compatibility, so presence has to be tracked explicitly: an absent name
   * means "keep the target value" even when the in-memory value carries a default.
   */
  declaredFields?: ReadonlySet<string>;
};

type CatalogNodeValue = {
  sourceId?: string;
  name: string;
  description?: string;
  detailedDescription?: string;
  writeFormatExample?: string;
  writeFormatHint?: string;
  moduleNamePath: string[];
  valueKind?: DebugValueKind;
  valueFormat?: DebugValueFormat;
  normalizationMode?: DebugNormalizationMode;
  maxValueBytes?: number | null;
  enabled?: boolean;
  archived?: boolean;
  archiveReason?: string | null;
  bindings?: CatalogBindingValue[];
  declaredFields?: ReadonlySet<string>;
};

type CatalogModuleValue = {
  name: string;
  parentNamePath: string[];
  description?: string;
  scope?: string;
  sortOrder?: number;
  declaredFields?: ReadonlySet<string>;
};

type DeclaredFields = ReadonlySet<string> | undefined;

/** True when a normalized field should be treated as "provided" rather than "omitted". */
function isDeclared(declaredFields: DeclaredFields, field: string) {
  return declaredFields ? declaredFields.has(field) : false;
}

function declaredFieldNames(input: unknown, fields: readonly string[]): ReadonlySet<string> {
  const record = (input ?? {}) as Record<string, unknown>;
  const declared = new Set<string>();
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      declared.add(field);
    }
  }
  return declared;
}

export type NormalizedCatalogDocument = {
  format: string;
  source: DebugCatalogSource | null;
  declaredCounts: DebugCatalogV2Counts | null;
  modules: CatalogModuleValue[];
  nodes: CatalogNodeValue[];
  fileBytes: number;
};

type TargetModuleState = {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  scope: string;
  sortOrder: number;
};

type TargetNodeState = {
  id: string;
  name: string;
  moduleId: string | null;
  description: string;
  detailedDescription: string;
  writeFormatExample: string;
  writeFormatHint: string;
  valueKind: DebugValueKind;
  valueFormat: DebugValueFormat;
  normalizationMode: DebugNormalizationMode;
  maxValueBytes: number | null;
  enabled: boolean;
  archivedAt: string | null;
  archiveReason: string | null;
};

type TargetBindingState = {
  protocol: DebugConnectionProtocol;
  nodePath: string;
  accessMode: DebugAccessMode;
  enabled: boolean;
  notes: string | null;
};

export type CatalogTargetSnapshot = {
  organizationId: string;
  modules: TargetModuleState[];
  nodes: TargetNodeState[];
  bindingsByNodeId: Map<string, TargetBindingState[]>;
  modulePathById: Map<string, string[]>;
  moduleIdByPathKey: Map<string, string>;
  /** Nodes whose `debug_node_module_id` does not resolve inside the organization. */
  danglingNodeModuleRefs: Array<{ nodeId: string; nodeName: string; moduleId: string }>;
  /** Modules whose `parent_id` does not resolve inside the organization. */
  danglingModuleParentRefs: Array<{ moduleId: string; moduleName: string; parentId: string }>;
  /** Module parent chains that never reach an organization root. */
  cyclicModuleRefs: Array<{ moduleId: string }>;
};

type PlannedModuleWrite = {
  classification: CatalogImportClassification;
  changedFields: string[];
  key: string;
  namePath: string[];
  /** Id of the matched target module; absent when the module must be created. */
  targetId?: string;
  value: CatalogModuleValue;
};

type PlannedNodeWrite = {
  classification: CatalogImportClassification;
  changedFields: string[];
  /** Canonical `moduleNamePath + name` identity used for matching and conflict reporting. */
  key: string;
  name: string;
  moduleNamePath: string[];
  /** Module path key used to resolve the final module id while applying the plan. */
  moduleKey: string;
  /** Matched target id; absent when the node must be created. */
  targetId?: string;
  sourceId?: string;
  value: CatalogNodeValue;
};

type PlannedBindingWrite = {
  classification: CatalogImportClassification;
  changedFields: string[];
  protocol: DebugConnectionProtocol;
  nodeTargetId?: string;
  nodeKey: string;
  before?: TargetBindingState;
  value: CatalogBindingValue;
};

export type CatalogImportPlan = {
  organizationId: string;
  format: string;
  fileBytes: number;
  declaredCounts: DebugCatalogV2Counts | null;
  fileCounts: DebugCatalogV2Counts;
  modules: PlannedModuleWrite[];
  nodes: PlannedNodeWrite[];
  bindings: PlannedBindingWrite[];
  conflicts: CatalogImportConflict[];
  warnings: CatalogImportWarning[];
  /** Digest binding the canonical file, target scope and approved target states. */
  previewDigest: string;
};

function parseFailed(message: string, issues: unknown) {
  return new ApiError("VALIDATION_FAILED", message, { issues });
}

function assertWithinDocumentCapacity(input: unknown) {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(input) ?? "", "utf8");
  } catch {
    bytes = Number.POSITIVE_INFINITY;
  }
  if (bytes > DEBUG_CATALOG_MAX_DOCUMENT_BYTES) {
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      `Debug catalog document exceeds the ${DEBUG_CATALOG_MAX_DOCUMENT_BYTES} byte limit.`,
      { maxBytes: DEBUG_CATALOG_MAX_DOCUMENT_BYTES, bytes }
    );
  }
  return bytes;
}

const V2_MODULE_FIELDS = ["description", "scope", "sortOrder"] as const;
const V2_NODE_FIELDS = [
  "description",
  "detailedDescription",
  "writeFormatExample",
  "writeFormatHint",
  "valueKind",
  "valueFormat",
  "normalizationMode",
  "maxValueBytes",
  "enabled",
  "archived",
  "archiveReason"
] as const;
const V2_BINDING_FIELDS = ["enabled", "notes"] as const;

function normalizeV2Document(input: DebugCatalogV2Document, raw: unknown): NormalizedCatalogDocument {
  const fileBytes = assertWithinDocumentCapacity(raw);
  return {
    format: DEBUG_CATALOG_FORMAT_V2,
    source: {
      organizationId: input.source.organizationId,
      organizationName: input.source.organizationName,
      exportedAt: input.source.exportedAt
    },
    declaredCounts: { ...input.counts },
    modules: input.modules.map((module) => ({
      name: module.name,
      parentNamePath: module.parentNamePath,
      description: module.description,
      scope: module.scope,
      sortOrder: module.sortOrder,
      declaredFields: declaredFieldNames(module, V2_MODULE_FIELDS)
    })),
    nodes: input.nodes.map((node) => ({
      sourceId: node.sourceId,
      name: node.name,
      description: node.description,
      detailedDescription: node.detailedDescription,
      writeFormatExample: node.writeFormatExample,
      writeFormatHint: node.writeFormatHint,
      moduleNamePath: node.moduleNamePath,
      valueKind: node.valueKind,
      valueFormat: node.valueFormat,
      normalizationMode: node.normalizationMode,
      maxValueBytes: node.maxValueBytes,
      enabled: node.enabled,
      archived: node.archived,
      archiveReason: node.archiveReason,
      declaredFields: declaredFieldNames(node, V2_NODE_FIELDS),
      bindings: node.bindings?.map((binding) => ({
        protocol: binding.protocol,
        nodePath: binding.nodePath,
        accessMode: binding.accessMode,
        enabled: binding.enabled,
        notes: binding.notes,
        declaredFields: declaredFieldNames(binding, V2_BINDING_FIELDS)
      }))
    })),
    fileBytes
  };
}

const V1_MODULE_FIELDS = ["description", "scope", "sortOrder"] as const;
const V1_NODE_FIELDS = [
  "description",
  "detailedDescription",
  "writeFormatExample",
  "writeFormatHint",
  "valueKind",
  "valueFormat",
  "normalizationMode",
  "maxValueBytes",
  "enabled"
] as const;
const V1_BINDING_FIELDS = ["enabled", "notes"] as const;

type ParsedV1Document = {
  format: string;
  modules: Array<{ name: string; parentNamePath: string[]; description: string; scope: string; sortOrder?: number }>;
  nodes: Array<{
    id?: string;
    name: string;
    description: string;
    detailedDescription: string;
    writeFormatExample: string;
    writeFormatHint: string;
    module?: string;
    moduleId?: string;
    moduleNamePath?: string[];
    valueKind: DebugValueKind;
    valueFormat: DebugValueFormat;
    normalizationMode: DebugNormalizationMode;
    maxValueBytes?: number | null;
    enabled: boolean;
    bindings: Array<{
      protocol: DebugConnectionProtocol;
      nodePath: string;
      accessMode: DebugAccessMode;
      enabled: boolean;
      notes?: string;
    }>;
  }>;
};

function normalizeV1Document(input: ParsedV1Document, raw: unknown): NormalizedCatalogDocument {
  const fileBytes = assertWithinDocumentCapacity(raw);
  // v1 applies schema defaults, so presence is read from the raw JSON: a field the file
  // never declared must keep the target value even though parsing filled in a default.
  const rawModules = ((raw as { modules?: unknown }).modules ?? []) as Array<Record<string, unknown>>;
  const rawNodes = ((raw as { nodes?: unknown }).nodes ?? []) as Array<Record<string, unknown>>;
  return {
    format: DEBUG_CATALOG_FORMAT_V1,
    source: null,
    declaredCounts: null,
    modules: input.modules.map((module, index) => ({
      name: module.name,
      parentNamePath: module.parentNamePath,
      description: module.description,
      scope: module.scope,
      sortOrder: module.sortOrder,
      declaredFields: declaredFieldNames(rawModules[index], V1_MODULE_FIELDS)
    })),
    nodes: input.nodes.map((node, nodeIndex) => {
      const rawNode = rawNodes[nodeIndex] as { bindings?: Array<Record<string, unknown>> } | undefined;
      const rawBindings = rawNode?.bindings ?? [];
      const namePath = node.moduleNamePath && node.moduleNamePath.length > 0
        ? node.moduleNamePath
        : node.module
          ? [node.module]
          : [];
      if (namePath.length === 0) {
        throw new ApiError("VALIDATION_FAILED", "Catalog node module path could not be resolved.", {
          name: node.name,
          module: node.module,
          moduleId: node.moduleId
        });
      }
      return {
        sourceId: node.id,
        name: node.name,
        description: node.description,
        detailedDescription: node.detailedDescription,
        writeFormatExample: node.writeFormatExample,
        writeFormatHint: node.writeFormatHint,
        moduleNamePath: namePath,
        valueKind: node.valueKind,
        valueFormat: node.valueFormat,
        normalizationMode: node.normalizationMode,
        maxValueBytes: node.maxValueBytes,
        enabled: node.enabled,
        declaredFields: declaredFieldNames(rawNode, V1_NODE_FIELDS),
        bindings: node.bindings.map((binding, bindingIndex) => ({
          protocol: binding.protocol,
          nodePath: binding.nodePath,
          accessMode: binding.accessMode,
          enabled: binding.enabled,
          notes: binding.notes,
          declaredFields: declaredFieldNames(rawBindings[bindingIndex], V1_BINDING_FIELDS)
        }))
      };
    }),
    fileBytes
  };
}

export function parseDebugCatalogTransferDocument(input: unknown): NormalizedCatalogDocument {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw parseFailed("Debug catalog document must be a JSON object.", [
      { path: [], message: "Expected an object." }
    ]);
  }

  const format = (input as { format?: unknown }).format;
  if (format === DEBUG_CATALOG_FORMAT_V1) {
    const parsed = debugCatalogDocumentSchema.safeParse(input);
    if (!parsed.success) {
      throw parseFailed("Invalid v1 debug catalog document.", parsed.error.issues);
    }
    return normalizeV1Document(parsed.data, input);
  }

  const parsed = debugCatalogV2DocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw parseFailed("Invalid debug catalog document.", parsed.error.issues);
  }
  return normalizeV2Document(parsed.data, input);
}

export function loosePathKey(namePath: string[]) {
  return JSON.stringify(namePath);
}

export function catalogNodeKey(moduleNamePath: string[], nodeName: string) {
  return `${loosePathKey(moduleNamePath)}::${nodeName}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) {
        continue;
      }
      sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function toTargetModuleState(record: DebugNodeModuleRecord): TargetModuleState {
  return {
    id: record.id,
    name: record.name,
    parentId: record.parentId ?? null,
    description: record.description,
    scope: record.scope,
    sortOrder: record.sortOrder
  };
}

function toTargetNodeState(record: DebugNodeRecord): TargetNodeState {
  return {
    id: record.id,
    name: record.name,
    moduleId: record.moduleId ?? null,
    description: record.description,
    detailedDescription: record.detailedDescription,
    writeFormatExample: record.writeFormatExample,
    writeFormatHint: record.writeFormatHint,
    valueKind: record.valueKind,
    valueFormat: record.valueFormat,
    normalizationMode: record.normalizationMode,
    maxValueBytes: record.maxValueBytes ?? null,
    enabled: record.enabled,
    archivedAt: record.archivedAt,
    archiveReason: record.archiveReason
  };
}

function toTargetBindingState(record: DebugNodeBindingRecord): TargetBindingState {
  return {
    protocol: record.protocol,
    nodePath: record.nodePath,
    accessMode: record.accessMode,
    enabled: record.enabled,
    notes: record.notes ?? null
  };
}

/**
 * Reads the whole org target state needed to classify an import. The caller decides
 * whether to take concurrency control first: preview reads directly, execute reads after
 * the transaction has serialized concurrent catalog writers.
 */
export async function loadCatalogTargetSnapshot(
  db: Database,
  input: { organizationId: string }
): Promise<CatalogTargetSnapshot> {
  const [moduleRecords, nodeRecords, bindingRecords] = await Promise.all([
    listDebugNodeModules(db, { organizationId: input.organizationId }),
    listAllDebugNodes(db, { organizationId: input.organizationId }),
    listAllDebugNodeBindings(db, { organizationId: input.organizationId })
  ]);

  const modules = moduleRecords.map(toTargetModuleState);
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const modulePathById = new Map<string, string[]>();
  const cyclicModuleRefs: Array<{ moduleId: string }> = [];

  const pathFor = (module: TargetModuleState, visiting: Set<string>): string[] => {
    const cached = modulePathById.get(module.id);
    if (cached) {
      return cached;
    }
    const parent = module.parentId ? moduleById.get(module.parentId) : undefined;
    if (!module.parentId || !parent) {
      const path = [module.name];
      modulePathById.set(module.id, path);
      return path;
    }
    if (visiting.has(module.parentId)) {
      cyclicModuleRefs.push({ moduleId: module.id });
      const path = [module.name];
      modulePathById.set(module.id, path);
      return path;
    }
    visiting.add(module.id);
    const path = [...pathFor(parent, visiting), module.name];
    visiting.delete(module.id);
    modulePathById.set(module.id, path);
    return path;
  };

  for (const module of modules) {
    pathFor(module, new Set([module.id]));
  }

  const moduleIdByPathKey = new Map<string, string>();
  for (const module of modules) {
    moduleIdByPathKey.set(loosePathKey(modulePathById.get(module.id) ?? [module.name]), module.id);
  }

  const danglingModuleParentRefs: Array<{ moduleId: string; moduleName: string; parentId: string }> = [];
  for (const module of modules) {
    if (module.parentId && !moduleById.has(module.parentId)) {
      danglingModuleParentRefs.push({ moduleId: module.id, moduleName: module.name, parentId: module.parentId });
    }
  }

  const nodes = nodeRecords.map(toTargetNodeState);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const danglingNodeModuleRefs: Array<{ nodeId: string; nodeName: string; moduleId: string }> = [];
  for (const node of nodes) {
    if (node.moduleId && !moduleById.has(node.moduleId)) {
      danglingNodeModuleRefs.push({ nodeId: node.id, nodeName: node.name, moduleId: node.moduleId });
    }
  }

  const bindingsByNodeId = new Map<string, TargetBindingState[]>();
  for (const binding of bindingRecords) {
    if (!nodeIds.has(binding.nodeId)) {
      // Org-scoped reads cannot produce a binding whose node is missing; skip defensively
      // so a phantom reference never becomes part of a merge plan.
      continue;
    }
    const list = bindingsByNodeId.get(binding.nodeId) ?? [];
    list.push(toTargetBindingState(binding));
    bindingsByNodeId.set(binding.nodeId, list);
  }
  for (const list of bindingsByNodeId.values()) {
    list.sort((left, right) => (left.protocol < right.protocol ? -1 : left.protocol > right.protocol ? 1 : 0));
  }

  return {
    organizationId: input.organizationId,
    modules,
    nodes,
    bindingsByNodeId,
    modulePathById,
    moduleIdByPathKey,
    danglingNodeModuleRefs,
    danglingModuleParentRefs,
    cyclicModuleRefs
  };
}

type WorkingModule = {
  id: string;
  key: string;
  path: string[];
  description: string;
  scope: string;
  sortOrder: number;
  exists: boolean;
};

type WorkingNode = {
  id: string;
  key: string;
  name: string;
  modulePath: string[];
};

function countDocumentObjects(document: NormalizedCatalogDocument): DebugCatalogV2Counts {
  return {
    modules: document.modules.length,
    nodes: document.nodes.length,
    bindings: document.nodes.reduce((total, node) => total + (node.bindings?.length ?? 0), 0)
  };
}

/**
 * Validates the file, matches it against the target snapshot and produces one plan shared
 * by preview and execute. Conflicts are collected rather than thrown so the admin sees
 * every blocking problem at once; a non-empty conflict list means nothing may be applied.
 */
export function buildCatalogImportPlan(input: {
  organizationId: string;
  document: NormalizedCatalogDocument;
  target: CatalogTargetSnapshot;
}): CatalogImportPlan {
  const { organizationId, document, target } = input;
  const conflicts: CatalogImportConflict[] = [];
  const warnings: CatalogImportWarning[] = [];

  for (const dangling of target.danglingNodeModuleRefs) {
    conflicts.push({
      code: "dangling-target-module-reference",
      location: `debug_nodes/${dangling.nodeId}`,
      object: "node",
      message: `Target node "${dangling.nodeName}" references module ${dangling.moduleId}, which is not in this organization.`
    });
  }
  for (const dangling of target.danglingModuleParentRefs) {
    conflicts.push({
      code: "dangling-target-module-parent",
      location: `debug_node_modules/${dangling.moduleId}`,
      object: "module",
      message: `Target module "${dangling.moduleName}" references missing parent ${dangling.parentId}.`
    });
  }
  for (const cyclic of target.cyclicModuleRefs) {
    conflicts.push({
      code: "cyclic-target-module",
      location: `debug_node_modules/${cyclic.moduleId}`,
      object: "module",
      message: "Target module parent chain does not reach an organization root."
    });
  }

  const workingModules = new Map<string, WorkingModule>();
  for (const module of target.modules) {
    const path = target.modulePathById.get(module.id) ?? [module.name];
    workingModules.set(loosePathKey(path), {
      id: module.id,
      key: loosePathKey(path),
      path,
      description: module.description,
      scope: module.scope,
      sortOrder: module.sortOrder,
      exists: true
    });
  }

  const nodeByKey = new Map<string, WorkingNode>();
  const nodeById = new Map<string, WorkingNode>();
  for (const node of target.nodes) {
    const modulePath = node.moduleId ? target.modulePathById.get(node.moduleId) ?? [] : [];
    const working: WorkingNode = {
      id: node.id,
      key: catalogNodeKey(modulePath, node.name),
      name: node.name,
      modulePath
    };
    nodeById.set(working.id, working);
    if (!nodeByKey.has(working.key)) {
      nodeByKey.set(working.key, working);
    }
  }

  const modules = planModuleWrites({ document, conflicts, workingModules });
  const nodeTargets = planNodeWrites({ document, conflicts, warnings, target, modules, nodeByKey, nodeById });
  const bindings = planBindingWrites({ document, conflicts, warnings, target, nodeTargets });

  const approved = approvedTargetStates();

  return {
    organizationId,
    format: document.format,
    fileBytes: document.fileBytes,
    declaredCounts: document.declaredCounts,
    fileCounts: countDocumentObjects(document),
    modules,
    nodes: nodeTargets.map((entry) => entry.planned),
    bindings,
    conflicts,
    warnings,
    previewDigest: sha256Hex(
      canonicalJson({ format: document.format, organizationId, document, approved })
    )
  };

  function approvedTargetStates() {
    const approvedModuleStates: TargetModuleState[] = [];
    for (const module of modules) {
      const current = module.targetId
        ? target.modules.find((candidate) => candidate.id === module.targetId)
        : undefined;
      if (current) approvedModuleStates.push(current);
    }
    const approvedNodeStates: unknown[] = [];
    for (const entry of nodeTargets) {
      const targetId = entry.planned.targetId;
      const current = targetId ? target.nodes.find((candidate) => candidate.id === targetId) : undefined;
      if (!current) continue;
      approvedNodeStates.push({
        ...current,
        bindings: target.bindingsByNodeId.get(current.id) ?? []
      });
    }
    const sortByCanonical = (left: unknown, right: unknown) => {
      const leftJson = canonicalJson(left);
      const rightJson = canonicalJson(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    };
    return {
      modules: [...approvedModuleStates].sort(sortByCanonical),
      nodes: [...approvedNodeStates].sort(sortByCanonical)
    };
  }
}

function planModuleWrites(input: {
  document: NormalizedCatalogDocument;
  conflicts: CatalogImportConflict[];
  workingModules: Map<string, WorkingModule>;
}) {
  const { document, conflicts, workingModules } = input;
  const seenKeys = new Map<string, number>();
  const planned: PlannedModuleWrite[] = [];

  document.modules.forEach((module, index) => {
    const location = `modules[${index}]`;
    const namePath = [...module.parentNamePath, module.name];
    const key = loosePathKey(namePath);
    const existingIndex = seenKeys.get(key);
    if (existingIndex !== undefined) {
      conflicts.push({
        code: "duplicate-module-path",
        location,
        object: "module",
        message: `Module path ${namePath.join(" / ")} appears more than once in the file (also modules[${existingIndex}]).`
      });
      return;
    }
    seenKeys.set(key, index);

    if (module.parentNamePath.length > 0 && !workingModules.has(loosePathKey(module.parentNamePath))) {
      conflicts.push({
        code: "dangling-module-parent",
        location,
        object: "module",
        message: `Module "${module.name}" declares parent path ${module.parentNamePath.join(" / ")}, which is not present in the target organization or earlier in the file.`
      });
      return;
    }

    const existing = workingModules.get(key);
    const declaredDescription = isDeclared(module.declaredFields, "description") ? module.description ?? "" : undefined;
    const declaredScope = isDeclared(module.declaredFields, "scope") ? module.scope ?? "" : undefined;
    const declaredSortOrder = isDeclared(module.declaredFields, "sortOrder") ? module.sortOrder ?? 0 : undefined;
    const nextDescription = declaredDescription ?? existing?.description ?? "";
    const nextScope = declaredScope ?? existing?.scope ?? "";
    const nextSortOrder = declaredSortOrder ?? existing?.sortOrder ?? 0;

    if (!existing) {
      workingModules.set(key, {
        id: `pending:${key}`,
        key,
        path: namePath,
        description: nextDescription,
        scope: nextScope,
        sortOrder: nextSortOrder,
        exists: false
      });
      planned.push({ classification: "created", changedFields: [], key, namePath, value: module });
      return;
    }

    const changedFields: string[] = [];
    if (nextDescription !== existing.description) changedFields.push("description");
    if (nextScope !== existing.scope) changedFields.push("scope");
    if (nextSortOrder !== existing.sortOrder) changedFields.push("sortOrder");

    planned.push({
      classification: changedFields.length > 0 ? "updated" : "unchanged",
      changedFields,
      key,
      namePath,
      targetId: existing.id,
      value: module
    });
  });

  return planned;
}

type PlannedNodeResolution = {
  planned: PlannedNodeWrite;
  isNew: boolean;
};

function nodeChangedFields(node: CatalogNodeValue, target: TargetNodeState): string[] {
  const changed: string[] = [];
  const compare = (field: string, next: unknown, current: unknown) => {
    if (canonicalJson(next) !== canonicalJson(current)) {
      changed.push(field);
    }
  };
  const declared = (field: string) => isDeclared(node.declaredFields, field);

  if (node.name !== target.name) changed.push("name");
  if (declared("description")) compare("description", node.description ?? "", target.description);
  if (declared("detailedDescription")) compare("detailedDescription", node.detailedDescription ?? "", target.detailedDescription);
  if (declared("writeFormatExample")) compare("writeFormatExample", node.writeFormatExample ?? "", target.writeFormatExample);
  if (declared("writeFormatHint")) compare("writeFormatHint", node.writeFormatHint ?? "", target.writeFormatHint);
  if (declared("valueKind")) compare("valueKind", node.valueKind, target.valueKind);
  if (declared("valueFormat")) compare("valueFormat", node.valueFormat, target.valueFormat);
  if (declared("normalizationMode")) compare("normalizationMode", node.normalizationMode, target.normalizationMode);
  if (declared("maxValueBytes")) compare("maxValueBytes", node.maxValueBytes ?? null, target.maxValueBytes);
  if (declared("enabled")) compare("enabled", node.enabled, target.enabled);

  // Archive state is deliberately absent: an existing target keeps its archive status, so a
  // differing file value is reported as a warning instead of being written.
  return changed;
}

function planNodeWrites(input: {
  document: NormalizedCatalogDocument;
  conflicts: CatalogImportConflict[];
  warnings: CatalogImportWarning[];
  target: CatalogTargetSnapshot;
  modules: PlannedModuleWrite[];
  nodeByKey: Map<string, WorkingNode>;
  nodeById: Map<string, WorkingNode>;
}): PlannedNodeResolution[] {
  const { document, conflicts, warnings, target, modules, nodeByKey, nodeById } = input;
  const plannedModuleKeys = new Set(modules.map((module) => module.key));
  const claimedTargets = new Map<string, string>();
  const claimedSourceIds = new Map<string, number>();
  const resolutions: PlannedNodeResolution[] = [];

  document.nodes.forEach((node, index) => {
    const location = `nodes[${index}]`;
    const namePath = node.moduleNamePath;

    // An empty path is a legitimate root placement (module-less nodes exist in the target),
    // so only a non-empty path must resolve to a module in the target or the file.
    if (namePath.length > 0 && !plannedModuleKeys.has(loosePathKey(namePath))) {
      conflicts.push({
        code: "dangling-node-module",
        location,
        object: "node",
        message: `Node "${node.name}" declares module path ${namePath.join(" / ")}, which is not present in the target organization or the file.`
      });
      return;
    }

    if (node.sourceId) {
      const previousIndex = claimedSourceIds.get(node.sourceId);
      if (previousIndex !== undefined) {
        conflicts.push({
          code: "duplicate-source-id",
          location,
          object: "node",
          message: `Source node id ${node.sourceId} is used by more than one file node (also nodes[${previousIndex}]).`
        });
        return;
      }
      claimedSourceIds.set(node.sourceId, index);
    }

    const key = catalogNodeKey(namePath, node.name);
    const existingById = node.sourceId ? nodeById.get(node.sourceId) : undefined;
    const existingByKey = nodeByKey.get(key);

    if (existingById && existingByKey && existingById.id !== existingByKey.id) {
      conflicts.push({
        code: "id-and-name-path-match-different-targets",
        location,
        object: "node",
        message: `Source node id ${node.sourceId} and module/name path resolve to different target nodes.`
      });
      return;
    }

    if (existingById && existingById.key !== key) {
      conflicts.push({
        code: "source-id-name-path-mismatch",
        location,
        object: "node",
        message: `Source node id ${node.sourceId} matches target node "${existingById.name}" in module ${existingById.modulePath.join(" / ") || "(root)"}, but the file places "${node.name}" in ${namePath.join(" / ") || "(root)"}.`
      });
      return;
    }

    const existing = existingById ?? existingByKey;
    if (existing) {
      const claimedBy = claimedTargets.get(existing.id);
      if (claimedBy && claimedBy !== location) {
        conflicts.push({
          code: "duplicate-target-claim",
          location,
          object: "node",
          message: `Node "${node.name}" resolves to the same target node as ${claimedBy}.`
        });
        return;
      }
      claimedTargets.set(existing.id, location);
    }

    const targetNodeState = existing
      ? target.nodes.find((candidate) => candidate.id === existing.id)
      : undefined;
    const changedFields = targetNodeState ? nodeChangedFields(node, targetNodeState) : [];

    const planned: PlannedNodeWrite = {
      classification: targetNodeState
        ? changedFields.length > 0
          ? "updated"
          : "unchanged"
        : "created",
      changedFields,
      key,
      name: node.name,
      moduleNamePath: namePath,
      moduleKey: loosePathKey(namePath),
      targetId: existing?.id,
      sourceId: node.sourceId,
      value: node
    };

    if (targetNodeState && node.archived !== undefined && node.archived !== Boolean(targetNodeState.archivedAt)) {
      warnings.push({
        code: "archive-state-preserved",
        location,
        message: `Node "${node.name}" keeps its current archive state; use the separate archive/restore action to change it.`
      });
    }

    resolutions.push({ planned, isNew: !targetNodeState });
  });

  return resolutions;
}

function planBindingWrites(input: {
  document: NormalizedCatalogDocument;
  conflicts: CatalogImportConflict[];
  warnings: CatalogImportWarning[];
  target: CatalogTargetSnapshot;
  nodeTargets: PlannedNodeResolution[];
}): PlannedBindingWrite[] {
  const { document, conflicts, warnings, target, nodeTargets } = input;
  const planned: PlannedBindingWrite[] = [];

  nodeTargets.forEach(({ planned: node }) => {
    const fileBindings = node.value.bindings ?? [];
    const locationBase = `nodes[${document.nodes.indexOf(node.value)}]`;
    const seenProtocols = new Map<string, number>();

    const targetBindings = node.targetId ? target.bindingsByNodeId.get(node.targetId) ?? [] : [];
    const targetByProtocol = new Map(targetBindings.map((binding) => [binding.protocol, binding]));

    fileBindings.forEach((binding, index) => {
      const location = `${locationBase}.bindings[${index}]`;
      const previousIndex = seenProtocols.get(binding.protocol);
      if (previousIndex !== undefined) {
        conflicts.push({
          code: "duplicate-binding-protocol",
          location,
          object: "binding",
          message: `Node "${node.name}" declares protocol ${binding.protocol} more than once (also ${locationBase}.bindings[${previousIndex}]).`
        });
        return;
      }
      seenProtocols.set(binding.protocol, index);

      const before = targetByProtocol.get(binding.protocol);
      const changedFields: string[] = [];
      if (before) {
        if (binding.nodePath !== before.nodePath) changedFields.push("nodePath");
        if (binding.accessMode !== before.accessMode) changedFields.push("accessMode");
        if (isDeclared(binding.declaredFields, "enabled") && binding.enabled !== before.enabled) changedFields.push("enabled");
        if (isDeclared(binding.declaredFields, "notes") && (binding.notes ?? null) !== before.notes) changedFields.push("notes");
      }

      planned.push({
        classification: before ? (changedFields.length > 0 ? "updated" : "unchanged") : "created",
        changedFields,
        protocol: binding.protocol,
        nodeTargetId: node.targetId,
        nodeKey: node.key,
        before,
        value: binding
      });
    });

    if (!node.targetId) {
      return;
    }
    const fileProtocols = new Set(fileBindings.map((binding) => binding.protocol));
    for (const before of targetBindings) {
      if (fileProtocols.has(before.protocol)) {
        continue;
      }
      warnings.push({
        code: "target-binding-preserved",
        location: locationBase,
        message: `Target binding ${before.protocol} on node "${node.name}" is not present in the file and is preserved.`
      });
    }
  });

  return planned;
}

function organizationIdFor(auth: AuthContext) {
  return auth.organization.id || auth.user.organizationId;
}

/**
 * Applies a confirmed plan. Every module, node and binding write plus the success audit
 * event share one transaction, so a mid-way failure leaves the target catalog untouched.
 */
async function applyCatalogImportPlan(
  tx: Database,
  auth: AuthContext,
  plan: CatalogImportPlan
): Promise<DebugCatalogImportResult> {
  const organizationId = plan.organizationId;
  const operatorId = auth.user.id;

  const moduleIdByKey = new Map<string, string>();
  for (const module of plan.modules) {
    if (module.targetId) {
      moduleIdByKey.set(module.key, module.targetId);
    }
  }

  const summary: DebugCatalogImportResult = {
    modulesCreated: 0,
    modulesUpdated: 0,
    modulesUnchanged: 0,
    nodesCreated: 0,
    nodesUpdated: 0,
    nodesUnchanged: 0,
    bindingsCreated: 0,
    bindingsUpdated: 0,
    bindingsUnchanged: 0
  };

  const modulesInDepthOrder = [...plan.modules].sort(
    (left, right) => left.namePath.length - right.namePath.length
  );
  for (const module of modulesInDepthOrder) {
    if (module.classification === "created") {
      const parentId = module.namePath.length > 1
        ? moduleIdByKey.get(loosePathKey(module.namePath.slice(0, -1))) ?? null
        : null;
      const created = await createDebugNodeModule(tx, {
        organizationId,
        name: module.value.name,
        parentId,
        description: module.value.description ?? "",
        scope: module.value.scope ?? "",
        sortOrder: module.value.sortOrder ?? 0
      });
      moduleIdByKey.set(module.key, created.id);
      summary.modulesCreated += 1;
      continue;
    }

    if (module.classification === "updated" && module.targetId) {
      await updateDebugNodeModule(tx, {
        organizationId,
        moduleId: module.targetId,
        description: isDeclared(module.value.declaredFields, "description") ? module.value.description : undefined,
        scope: isDeclared(module.value.declaredFields, "scope") ? module.value.scope : undefined,
        sortOrder: isDeclared(module.value.declaredFields, "sortOrder") ? module.value.sortOrder : undefined
      });
      summary.modulesUpdated += 1;
      continue;
    }

    summary.modulesUnchanged += 1;
  }

  const nodeIdByKey = new Map<string, string>();
  for (const node of plan.nodes) {
    if (node.classification === "created") {
      const created = await createDebugNode(tx, {
        organizationId,
        name: node.name,
        description: node.value.description ?? "",
        detailedDescription: node.value.detailedDescription ?? "",
        writeFormatExample: node.value.writeFormatExample ?? "",
        writeFormatHint: node.value.writeFormatHint ?? "",
        module: node.moduleNamePath.length > 0 ? node.moduleNamePath[node.moduleNamePath.length - 1] : "",
        moduleId: moduleIdByKey.get(node.moduleKey) ?? null,
        valueKind: node.value.valueKind ?? DEBUG_VALUE_KIND_SCALAR,
        valueFormat: node.value.valueFormat ?? DEBUG_VALUE_FORMAT_RAW,
        normalizationMode: node.value.normalizationMode ?? DEBUG_NORMALIZATION_MODE_TRIM,
        maxValueBytes: node.value.maxValueBytes ?? null,
        enabled: node.value.enabled ?? true,
        archivedAt: node.value.archived ? new Date().toISOString() : null,
        archivedBy: node.value.archived ? operatorId : null,
        archiveReason: node.value.archived ? node.value.archiveReason ?? null : null
      });
      nodeIdByKey.set(node.key, created.id);
      summary.nodesCreated += 1;
      continue;
    }

    if (node.classification === "updated" && node.targetId) {
      const declared = (field: string) => isDeclared(node.value.declaredFields, field);
      await updateDebugNodePresence(tx, {
        organizationId,
        nodeId: node.targetId,
        name: node.value.name,
        description: declared("description") ? node.value.description ?? "" : undefined,
        detailedDescription: declared("detailedDescription") ? node.value.detailedDescription ?? "" : undefined,
        writeFormatExample: declared("writeFormatExample") ? node.value.writeFormatExample ?? "" : undefined,
        writeFormatHint: declared("writeFormatHint") ? node.value.writeFormatHint ?? "" : undefined,
        module: node.moduleNamePath.length > 0 ? node.moduleNamePath[node.moduleNamePath.length - 1] : undefined,
        moduleId: moduleIdByKey.get(node.moduleKey) ?? null,
        valueKind: declared("valueKind") ? node.value.valueKind : undefined,
        valueFormat: declared("valueFormat") ? node.value.valueFormat : undefined,
        normalizationMode: declared("normalizationMode") ? node.value.normalizationMode : undefined,
        maxValueBytes: declared("maxValueBytes") ? node.value.maxValueBytes ?? null : undefined,
        enabled: declared("enabled") ? node.value.enabled : undefined
      });
      nodeIdByKey.set(node.key, node.targetId);
      summary.nodesUpdated += 1;
      continue;
    }

    if (node.targetId) {
      nodeIdByKey.set(node.key, node.targetId);
    }
    summary.nodesUnchanged += 1;
  }

  for (const binding of plan.bindings) {
    if (binding.classification === "unchanged") {
      summary.bindingsUnchanged += 1;
      continue;
    }
    const targetNodeId = binding.nodeTargetId ?? nodeIdByKey.get(binding.nodeKey);
    if (!targetNodeId) {
      throw new ApiError("INTERNAL_ERROR", "Import plan lost the target node for a binding.");
    }
    const saved = await upsertDebugNodeBinding(tx, {
      organizationId,
      nodeId: targetNodeId,
      protocol: binding.value.protocol,
      nodePath: binding.value.nodePath,
      accessMode: binding.value.accessMode,
      enabled: isDeclared(binding.value.declaredFields, "enabled") ? binding.value.enabled : true,
      notes: binding.value.notes,
      preserveOmittedNotes: !isDeclared(binding.value.declaredFields, "notes")
    });
    if (!saved) {
      throw new ApiError("NOT_FOUND", "Debug node was not found.");
    }
    if (binding.classification === "created") {
      summary.bindingsCreated += 1;
    } else {
      summary.bindingsUpdated += 1;
    }
  }

  return summary;
}

/**
 * Exports the complete organization debug-node catalog. Reads modules, every persisted
 * node (archived and disabled included) and every binding through one org-scoped snapshot
 * so the document and its declared counts describe the same moment.
 */
export async function exportDebugCatalogFull(
  db: Database,
  auth: AuthContext,
  context: CatalogImportExportContext
): Promise<CatalogExportResult> {
  requireDebugAdmin(auth);
  const organizationId = organizationIdFor(auth);

  const snapshot = await loadCatalogTargetSnapshot(db, { organizationId });
  const modulePathById = snapshot.modulePathById;

  const modules: DebugCatalogModuleExport[] = snapshot.modules
    .map((module) => {
      const path = modulePathById.get(module.id) ?? [module.name];
      return {
        name: module.name,
        parentNamePath: path.slice(0, -1),
        description: module.description,
        scope: module.scope,
        sortOrder: module.sortOrder
      };
    })
    // Depth-first order keeps every parent before its children, so a file can be read
    // top-down without needing to re-sort it before import.
    .sort((left, right) => {
      if (left.parentNamePath.length !== right.parentNamePath.length) {
        return left.parentNamePath.length - right.parentNamePath.length;
      }
      const leftKey = loosePathKey([...left.parentNamePath, left.name]);
      const rightKey = loosePathKey([...right.parentNamePath, right.name]);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  const nodes: DebugCatalogNodeExport[] = snapshot.nodes
    .map((node) => {
      const moduleNamePath = node.moduleId ? modulePathById.get(node.moduleId) ?? [] : [];
      const bindings: DebugCatalogBindingExport[] = (snapshot.bindingsByNodeId.get(node.id) ?? []).map((binding) => ({
        protocol: binding.protocol,
        nodePath: binding.nodePath,
        accessMode: binding.accessMode,
        enabled: binding.enabled,
        notes: binding.notes ?? undefined
      }));
      return {
        sourceId: node.id,
        name: node.name,
        description: node.description,
        detailedDescription: node.detailedDescription,
        writeFormatExample: node.writeFormatExample,
        writeFormatHint: node.writeFormatHint,
        moduleNamePath,
        valueKind: node.valueKind,
        valueFormat: node.valueFormat,
        normalizationMode: node.normalizationMode,
        maxValueBytes: node.maxValueBytes,
        enabled: node.enabled,
        archived: Boolean(node.archivedAt),
        archiveReason: node.archiveReason,
        bindings
      };
    })
    .sort((left, right) => {
      const leftKey = catalogNodeKey(left.moduleNamePath, left.name);
      const rightKey = catalogNodeKey(right.moduleNamePath, right.name);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });

  const counts: DebugCatalogV2Counts = {
    modules: modules.length,
    nodes: nodes.length,
    bindings: nodes.reduce((total, node) => total + node.bindings.length, 0)
  };

  const document: DebugCatalogExportDocument = {
    format: DEBUG_CATALOG_FORMAT_V2,
    source: {
      organizationId,
      organizationName: auth.organization.name,
      exportedAt: new Date().toISOString()
    },
    counts,
    modules,
    nodes
  };

  const serializedBytes = Buffer.byteLength(JSON.stringify(document), "utf8");
  if (serializedBytes > DEBUG_CATALOG_MAX_DOCUMENT_BYTES) {
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      "Debug node catalog export exceeds the supported file size; no partial file was produced.",
      { maxBytes: DEBUG_CATALOG_MAX_DOCUMENT_BYTES, bytes: serializedBytes }
    );
  }

  await withAuditedWrite(db, auth, { requestId: context.requestId }, async () => ({
    result: undefined,
    audit: {
      app: "debugging",
      kind: "debug-node-catalog-export",
      action: "export",
      severity: "Low",
      projectId: null,
      targetType: "debug-node-catalog",
      targetId: organizationId,
      metadata: {
        format: DEBUG_CATALOG_FORMAT_V2,
        moduleCount: counts.modules,
        nodeCount: counts.nodes,
        bindingCount: counts.bindings,
        fileBytes: serializedBytes
      }
    }
  }));

  return { document, counts, organizationId, fileBytes: serializedBytes };
}

function classificationCounts(
  items: Array<{ classification: CatalogImportClassification }>
): Record<CatalogImportClassification, number> {
  const counts: Record<CatalogImportClassification, number> = { created: 0, updated: 0, unchanged: 0 };
  for (const item of items) {
    counts[item.classification] += 1;
  }
  return counts;
}

/**
 * Renders the plan the admin reviews. Every difference detail is derived from the same
 * classification execute applies, so the preview cannot drift from the merge.
 */
export function renderCatalogImportPreview(
  document: NormalizedCatalogDocument,
  plan: CatalogImportPlan,
  target: CatalogTargetSnapshot
): CatalogImportPreview {
  const canSubmit = plan.conflicts.length === 0;
  const details: CatalogImportDifferenceDetail[] = [];

  for (const module of plan.modules) {
    if (module.classification === "unchanged") continue;
    const current = module.targetId
      ? target.modules.find((candidate) => candidate.id === module.targetId)
      : undefined;
    details.push({
      path: `modules/${module.namePath.join("/")}`,
      name: module.value.name,
      object: "module",
      classification: module.classification,
      fields: moduleFieldDifferences(moduleNextValues(module, current), current)
    });
  }

  for (const node of plan.nodes) {
    const nodeBindings = plan.bindings.filter((binding) => binding.nodeKey === node.key);
    const hasBindingChange = nodeBindings.some((binding) => binding.classification !== "unchanged");
    if (node.classification === "unchanged" && !hasBindingChange) continue;
    const currentNode = node.targetId
      ? target.nodes.find((candidate) => candidate.id === node.targetId)
      : undefined;
    details.push({
      path: `nodes/${node.moduleNamePath.join("/")}/${node.name}`,
      name: node.name,
      object: "node",
      classification: node.classification,
      fields: nodeFieldDifferences(nodeNextValues(node, currentNode), currentNode)
    });
  }

  for (const binding of plan.bindings) {
    if (binding.classification === "unchanged") continue;
    details.push({
      path: `nodes/${binding.nodeKey}/bindings/${binding.protocol}`,
      name: binding.protocol,
      object: "binding",
      classification: binding.classification,
      fields: bindingFieldDifferences(bindingNextValues(binding), binding.before)
    });
  }

  return {
    canSubmit,
    previewDigest: canSubmit ? plan.previewDigest : null,
    format: document.format,
    sourceOrganization: document.source,
    targetOrganizationId: plan.organizationId,
    fileCounts: plan.fileCounts,
    declaredCounts: document.declaredCounts,
    modules: classificationCounts(plan.modules),
    nodes: classificationCounts(plan.nodes),
    bindings: classificationCounts(plan.bindings),
    details: details.slice(0, MAX_CATALOG_PREVIEW_DETAIL_ITEMS),
    detailsTruncated: details.length > MAX_CATALOG_PREVIEW_DETAIL_ITEMS,
    conflicts: plan.conflicts,
    warnings: plan.warnings
  };
}

/**
 * Difference list for one object, derived from the same resolved values the merge applies:
 * an omitted field keeps the target value, so it never appears as a phantom change, and an
 * omitted-but-defaulted binding field reports the value the write will actually store.
 */
function fieldDifferences(
  nextValues: Record<string, unknown>,
  current: Record<string, unknown> | undefined,
  fields: string[]
): CatalogImportFieldDifference[] {
  if (!current) return [];
  const differences: CatalogImportFieldDifference[] = [];
  for (const field of fields) {
    const before = current[field] ?? null;
    const after = nextValues[field] ?? null;
    if (canonicalJson(after) !== canonicalJson(before)) {
      differences.push({ field, before, after });
    }
  }
  return differences;
}

function moduleFieldDifferences(
  nextValues: Record<string, unknown>,
  current: TargetModuleState | undefined
) {
  return fieldDifferences(nextValues, current as Record<string, unknown> | undefined, [
    "description",
    "scope",
    "sortOrder"
  ]);
}

function nodeFieldDifferences(nextValues: Record<string, unknown>, current: TargetNodeState | undefined) {
  return fieldDifferences(nextValues, current as Record<string, unknown> | undefined, [
    "name",
    "description",
    "detailedDescription",
    "writeFormatExample",
    "writeFormatHint",
    "valueKind",
    "valueFormat",
    "normalizationMode",
    "maxValueBytes",
    "enabled"
  ]);
}

function bindingFieldDifferences(
  nextValues: Record<string, unknown>,
  current: TargetBindingState | undefined
) {
  return fieldDifferences(nextValues, current as Record<string, unknown> | undefined, [
    "nodePath",
    "accessMode",
    "enabled",
    "notes"
  ]);
}

function moduleNextValues(module: PlannedModuleWrite, target: TargetModuleState | undefined) {
  return {
    name: module.value.name,
    description: isDeclared(module.value.declaredFields, "description")
      ? module.value.description ?? ""
      : target?.description,
    scope: isDeclared(module.value.declaredFields, "scope") ? module.value.scope ?? "" : target?.scope,
    sortOrder: isDeclared(module.value.declaredFields, "sortOrder") ? module.value.sortOrder ?? 0 : target?.sortOrder
  };
}

function nodeNextValues(node: PlannedNodeWrite, target: TargetNodeState | undefined) {
  const declared = (field: string) => isDeclared(node.value.declaredFields, field);
  return {
    name: node.value.name,
    description: declared("description") ? node.value.description ?? "" : target?.description,
    detailedDescription: declared("detailedDescription") ? node.value.detailedDescription ?? "" : target?.detailedDescription,
    writeFormatExample: declared("writeFormatExample") ? node.value.writeFormatExample ?? "" : target?.writeFormatExample,
    writeFormatHint: declared("writeFormatHint") ? node.value.writeFormatHint ?? "" : target?.writeFormatHint,
    valueKind: declared("valueKind") ? node.value.valueKind : target?.valueKind,
    valueFormat: declared("valueFormat") ? node.value.valueFormat : target?.valueFormat,
    normalizationMode: declared("normalizationMode") ? node.value.normalizationMode : target?.normalizationMode,
    maxValueBytes: declared("maxValueBytes") ? node.value.maxValueBytes ?? null : target?.maxValueBytes,
    enabled: declared("enabled") ? node.value.enabled : target?.enabled
  };
}

function bindingNextValues(binding: PlannedBindingWrite) {
  const declared = (field: string) => isDeclared(binding.value.declaredFields, field);
  return {
    protocol: binding.value.protocol,
    nodePath: binding.value.nodePath,
    accessMode: binding.value.accessMode,
    // A new or legacy binding without an explicit flag stores the create default.
    enabled: declared("enabled") ? binding.value.enabled : binding.before ? binding.before.enabled : true,
    notes: declared("notes") ? binding.value.notes ?? null : binding.before?.notes ?? null
  };
}

/**
 * Server-side import preview. Read-only: it parses the document, snapshots the target,
 * classifies every module, node and binding, and returns a digest that execute accepts as
 * evidence the admin reviewed this exact file against this exact target state.
 */
export async function previewDebugCatalogImport(
  db: Database,
  auth: AuthContext,
  input: unknown,
  _context: CatalogImportExportContext
): Promise<CatalogImportPreview> {
  requireDebugAdmin(auth);
  const organizationId = organizationIdFor(auth);
  const document = parseDebugCatalogTransferDocument(input);
  const target = await loadCatalogTargetSnapshot(db, { organizationId });
  const plan = buildCatalogImportPlan({ organizationId, document, target });
  return renderCatalogImportPreview(document, plan, target);
}

/**
 * Serializes catalog-transfer writers for one organization. An advisory lock is used
 * instead of row locks so a large import never blocks unrelated admin node edits on rows
 * it does not touch; correctness still comes from re-verifying the approved target state.
 */
export async function lockCatalogWriter(tx: Database, organizationId: string) {
  await tx.query("select pg_advisory_xact_lock($1::bigint)", [advisoryLockKey(organizationId)]);
}

export function advisoryLockKey(organizationId: string) {
  const digest = createHash("sha256").update(`wiseeff.debug-node-catalog:${organizationId}`).digest();
  return digest.readBigInt64BE(0).toString();
}

/**
 * Merge-imports a previewed catalog document. The caller must have previewed the same file
 * against the same target; any divergence in the approved target state returns
 * CONFLICT/409 so the admin re-previews instead of silently overwriting unreviewed data.
 *
 * The document, the classification and the success audit event all live in one
 * transaction: a mid-way failure rolls every change back.
 */
export async function importDebugCatalog(
  db: Database,
  auth: AuthContext,
  input: unknown,
  context: CatalogImportExportContext
): Promise<DebugCatalogImportResult> {
  requireDebugAdmin(auth);
  const organizationId = organizationIdFor(auth);
  const body = input as { document?: unknown; previewDigest?: unknown } | null | undefined;
  if (!body || typeof body !== "object" || !("document" in body)) {
    throw new ApiError("VALIDATION_FAILED", "The import body must contain the previewed document.", {
      missing: ["document"]
    });
  }
  if (typeof body.previewDigest !== "string" || !body.previewDigest.trim()) {
    throw new ApiError(
      "VALIDATION_FAILED",
      "previewDigest is required; preview the document before importing it.",
      { missing: ["previewDigest"] }
    );
  }

  const document = parseDebugCatalogTransferDocument(body.document);
  const requestedDigest = body.previewDigest.trim();

  return withAuditedWrite(db, auth, { requestId: context.requestId }, async (tx) => {
    await lockCatalogWriter(tx, organizationId);
    const target = await loadCatalogTargetSnapshot(tx, { organizationId });
    const plan = buildCatalogImportPlan({ organizationId, document, target });

    if (plan.conflicts.length > 0) {
      throw new ApiError("CONFLICT", "The document has blocking conflicts and cannot be imported.", {
        conflicts: plan.conflicts
      });
    }
    if (plan.previewDigest !== requestedDigest) {
      throw new ApiError(
        "CONFLICT",
        "The target catalog changed after this preview; preview the document again before importing.",
        { reason: "stale-preview" }
      );
    }
    await assertTargetsUnchanged(tx, organizationId, plan);

    const summary = await applyCatalogImportPlan(tx, auth, plan);

    return {
      result: summary,
      audit: {
        app: "debugging",
        kind: "debug-node-catalog-import",
        action: "import",
        severity: "Medium",
        projectId: null,
        targetType: "debug-node-catalog",
        targetId: organizationId,
        metadata: {
          format: plan.format,
          fileBytes: plan.fileBytes,
          modulesCreated: summary.modulesCreated,
          modulesUpdated: summary.modulesUpdated,
          modulesUnchanged: summary.modulesUnchanged,
          nodesCreated: summary.nodesCreated,
          nodesUpdated: summary.nodesUpdated,
          nodesUnchanged: summary.nodesUnchanged,
          bindingsCreated: summary.bindingsCreated,
          bindingsUpdated: summary.bindingsUpdated,
          bindingsUnchanged: summary.bindingsUnchanged,
          previewDigest: plan.previewDigest
        }
      }
    };
  });
}

/**
 * Re-reads the approved targets inside the import transaction and fails when any of them
 * changed after the preview, including a node the file would create that now already
 * exists under the same module/name identity.
 */
async function assertTargetsUnchanged(tx: Database, organizationId: string, plan: CatalogImportPlan) {
  const approvedModuleIds = plan.modules.flatMap((module) => (module.targetId ? [module.targetId] : []));
  const approvedNodeIds = plan.nodes.flatMap((node) => (node.targetId ? [node.targetId] : []));

  if (approvedModuleIds.length > 0) {
    const rows = await tx.query<{ id: string }>(
      `select id from debug_node_modules where organization_id = $1 and id = any($2::text[])`,
      [organizationId, approvedModuleIds]
    );
    const present = new Set(rows.rows.map((row) => row.id));
    for (const module of plan.modules) {
      if (module.targetId && !present.has(module.targetId)) {
        throw staleConflict(`module ${module.namePath.join(" / ")} was removed`);
      }
    }
  }

  if (approvedNodeIds.length > 0) {
    const rows = await tx.query<{ id: string }>(
      `select id from debug_nodes where organization_id = $1 and id = any($2::text[])`,
      [organizationId, approvedNodeIds]
    );
    const present = new Set(rows.rows.map((row) => row.id));
    for (const node of plan.nodes) {
      if (node.targetId && !present.has(node.targetId)) {
        throw staleConflict(`node "${node.name}" was removed`);
      }
    }
  }

  const createdNodes = plan.nodes.filter((node) => node.classification === "created");
  if (createdNodes.length > 0) {
    // One read for every node the file would create, so a 2,000+ node import does not
    // issue one statement per node just to prove the name/module identity is still free.
    const names = [...new Set(createdNodes.map((node) => node.name))];
    const existing = await tx.query<{ name: string; module_name: string }>(
      `select n.name, coalesce(m.name, n.module, '') as module_name, n.module
       from debug_nodes n
       left join debug_node_modules m on m.id = n.debug_node_module_id and m.organization_id = n.organization_id
       where n.organization_id = $1
         and n.name = any($2::text[])`,
      [organizationId, names]
    );
    const occupied = new Set(existing.rows.map((row) => catalogNodeKey([row.module_name], row.name)));
    for (const node of createdNodes) {
      if (occupied.has(node.key)) {
        throw staleConflict(`node "${node.name}" now exists in the target organization`);
      }
    }
  }
}

function staleConflict(detail: string) {
  return new ApiError("CONFLICT", `The target catalog changed after this preview: ${detail}.`, {
    reason: "stale-preview"
  });
}
