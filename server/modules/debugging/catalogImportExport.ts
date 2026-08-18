import { ApiError } from "../../shared/http/errors";
import type { Database } from "../../shared/database/client";
import { withAuditedWrite } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { requireDebugAdmin } from "./policy";
import {
  createDebugNode,
  createDebugNodeModule,
  getDebugNode,
  listDebugNodeBindings,
  listDebugNodes,
  updateDebugNode,
  updateDebugNodeModule,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";
import { getDebugNodeModuleByName, listDebugNodeModules } from "./debugNodeModuleRepository";
import {
  DEBUG_CATALOG_FORMAT_V1,
  debugCatalogDocumentSchema,
  type DebugCatalogDocument,
  type DebugCatalogModule,
  type DebugCatalogNode
} from "./schemas";
import type { DebugNodeModuleRecord, DebugNodeRecord } from "./types";

export { DEBUG_CATALOG_FORMAT_V1 };
export type { DebugCatalogDocument, DebugCatalogModule, DebugCatalogNode };

export type CatalogImportExportContext = {
  requestId: string;
  includeArchived?: boolean;
};

export type DebugCatalogImportResult = {
  modulesCreated: number;
  modulesUpdated: number;
  nodesCreated: number;
  nodesUpdated: number;
  bindingsUpserted: number;
};

function organizationIdFor(auth: AuthContext) {
  return auth.organization.id || auth.user.organizationId;
}

function parseFailed(issues: unknown) {
  return new ApiError("VALIDATION_FAILED", "Invalid debug catalog document.", { issues });
}

export function parseDebugCatalogDocument(input: unknown): DebugCatalogDocument {
  const parsed = debugCatalogDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw parseFailed(parsed.error.issues);
  }
  return parsed.data;
}

function moduleNamePathById(modules: DebugNodeModuleRecord[]): Map<string, string[]> {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const paths = new Map<string, string[]>();

  const pathFor = (module: DebugNodeModuleRecord): string[] => {
    const cached = paths.get(module.id);
    if (cached) {
      return cached;
    }
    const parentPath = module.parentId ? (byId.has(module.parentId) ? pathFor(byId.get(module.parentId)!) : []) : [];
    const path = [...parentPath, module.name];
    paths.set(module.id, path);
    return path;
  };

  for (const module of modules) {
    pathFor(module);
  }
  return paths;
}

function sameNamePath(left: string[] | undefined, right: string[]): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  return left.every((segment, index) => segment === right[index]);
}

async function resolveModuleByNamePath(
  db: Database,
  organizationId: string,
  namePath: string[]
): Promise<DebugNodeModuleRecord | null> {
  let parentId: string | null = null;
  let current: DebugNodeModuleRecord | null = null;
  for (const name of namePath) {
    current = await getDebugNodeModuleByName(db, { organizationId, name, parentId });
    if (!current) {
      return null;
    }
    parentId = current.id;
  }
  return current;
}

function nodeModuleNamePath(node: DebugNodeRecord, modulePaths: Map<string, string[]>): string[] {
  if (node.moduleId && modulePaths.has(node.moduleId)) {
    return modulePaths.get(node.moduleId)!;
  }
  if (node.modulePath && node.modulePath.length > 0) {
    return node.modulePath;
  }
  return node.module ? [node.module] : [];
}

export async function exportDebugCatalog(
  db: Database,
  auth: AuthContext,
  context: CatalogImportExportContext
): Promise<DebugCatalogDocument> {
  requireDebugAdmin(auth);
  const organizationId = organizationIdFor(auth);
  const includeArchived = context.includeArchived !== false;

  const modules = await listDebugNodeModules(db, { organizationId });
  const modulePaths = moduleNamePathById(modules);
  const nodes = await listDebugNodes(db, { organizationId, includeArchived });
  const nodesWithBindings = await Promise.all(
    nodes.map(async (node) => {
      const bindings = await listDebugNodeBindings(db, { organizationId, nodeId: node.id });
      return { node, bindings };
    })
  );

  const document: DebugCatalogDocument = {
    format: DEBUG_CATALOG_FORMAT_V1,
    modules: modules.map((module) => {
      const path = modulePaths.get(module.id) ?? [module.name];
      return {
        name: module.name,
        parentNamePath: path.slice(0, -1),
        description: module.description,
        scope: module.scope,
        sortOrder: module.sortOrder
      };
    }),
    nodes: nodesWithBindings.map(({ node, bindings }) => ({
      id: node.id,
      name: node.name,
      description: node.description,
      detailedDescription: node.detailedDescription,
      writeFormatExample: node.writeFormatExample,
      writeFormatHint: node.writeFormatHint,
      module: node.module,
      moduleId: node.moduleId,
      moduleNamePath: nodeModuleNamePath(node, modulePaths),
      valueKind: node.valueKind,
      valueFormat: node.valueFormat,
      normalizationMode: node.normalizationMode,
      maxValueBytes: node.maxValueBytes,
      enabled: node.enabled,
      bindings: bindings.map((binding) => ({
        protocol: binding.protocol,
        nodePath: binding.nodePath,
        accessMode: binding.accessMode,
        enabled: binding.enabled,
        notes: binding.notes ?? undefined
      }))
    }))
  };

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
        moduleCount: document.modules.length,
        nodeCount: document.nodes.length,
        bindingCount: document.nodes.reduce((count, node) => count + node.bindings.length, 0),
        includeArchived
      }
    }
  }));

  return document;
}

async function upsertImportedModule(
  tx: Database,
  organizationId: string,
  incoming: DebugCatalogModule
): Promise<"created" | "updated"> {
  const parent = incoming.parentNamePath.length
    ? await resolveModuleByNamePath(tx, organizationId, incoming.parentNamePath)
    : null;
  if (incoming.parentNamePath.length > 0 && !parent) {
    throw new ApiError("VALIDATION_FAILED", "Catalog module parent was not found.", {
      name: incoming.name,
      parentNamePath: incoming.parentNamePath
    });
  }

  const existing = await getDebugNodeModuleByName(tx, {
    organizationId,
    name: incoming.name,
    parentId: parent?.id ?? null
  });
  if (!existing) {
    await createDebugNodeModule(tx, {
      organizationId,
      name: incoming.name,
      parentId: parent?.id ?? null,
      description: incoming.description,
      scope: incoming.scope,
      sortOrder: incoming.sortOrder
    });
    return "created";
  }

  await updateDebugNodeModule(tx, {
    organizationId,
    moduleId: existing.id,
    name: incoming.name,
    description: incoming.description,
    scope: incoming.scope,
    sortOrder: incoming.sortOrder
  });
  return "updated";
}

async function resolveIncomingModule(
  tx: Database,
  organizationId: string,
  incoming: DebugCatalogNode
): Promise<{ module: string; moduleId: string | null }> {
  if (incoming.moduleNamePath && incoming.moduleNamePath.length > 0) {
    const resolved = await resolveModuleByNamePath(tx, organizationId, incoming.moduleNamePath);
    if (!resolved) {
      throw new ApiError("VALIDATION_FAILED", "Catalog node module path was not found.", {
        name: incoming.name,
        moduleNamePath: incoming.moduleNamePath
      });
    }
    return { module: resolved.name, moduleId: resolved.id };
  }

  if (incoming.moduleId) {
    const resolved = await resolveModuleByNamePath(tx, organizationId, incoming.module ? [incoming.module] : []);
    if (resolved) {
      return { module: resolved.name, moduleId: resolved.id };
    }
  }

  const moduleName = incoming.module?.trim();
  if (!moduleName) {
    throw new ApiError("VALIDATION_FAILED", "Either module or moduleNamePath is required.");
  }
  const root = await getDebugNodeModuleByName(tx, { organizationId, name: moduleName, parentId: null });
  return { module: moduleName, moduleId: root?.id ?? null };
}

async function findExistingNode(
  tx: Database,
  organizationId: string,
  incoming: DebugCatalogNode,
  known: DebugNodeRecord[],
  assignment: { module: string; moduleId: string | null }
): Promise<DebugNodeRecord | null> {
  if (incoming.id) {
    const byId = await getDebugNode(tx, { organizationId, nodeId: incoming.id, includeArchived: true });
    if (byId) {
      return byId;
    }
  }

  const matches = known.filter((node) => {
    if (node.name !== incoming.name) {
      return false;
    }
    if (assignment.moduleId && node.moduleId) {
      return node.moduleId === assignment.moduleId;
    }
    return node.module === assignment.module;
  });
  if (matches.length > 1) {
    throw new ApiError("CONFLICT", "Multiple debug nodes match the imported name and module.", {
      name: incoming.name,
      module: assignment.module
    });
  }
  return matches[0] ?? null;
}

export async function importDebugCatalog(
  db: Database,
  auth: AuthContext,
  input: unknown,
  context: CatalogImportExportContext
): Promise<DebugCatalogImportResult> {
  requireDebugAdmin(auth);
  const organizationId = organizationIdFor(auth);
  const document = parseDebugCatalogDocument(input);

  return withAuditedWrite(db, auth, { requestId: context.requestId }, async (tx) => {
    const summary: DebugCatalogImportResult = {
      modulesCreated: 0,
      modulesUpdated: 0,
      nodesCreated: 0,
      nodesUpdated: 0,
      bindingsUpserted: 0
    };

    const modulesInOrder = [...document.modules].sort((left, right) => left.parentNamePath.length - right.parentNamePath.length);
    for (const incoming of modulesInOrder) {
      const outcome = await upsertImportedModule(tx, organizationId, incoming);
      if (outcome === "created") {
        summary.modulesCreated += 1;
      } else {
        summary.modulesUpdated += 1;
      }
    }

    const knownNodes = await listDebugNodes(tx, { organizationId, includeArchived: true });
    for (const incoming of document.nodes) {
      const assignment = await resolveIncomingModule(tx, organizationId, incoming);
      const existing = await findExistingNode(tx, organizationId, incoming, knownNodes, assignment);
      const node = existing
        ? await updateDebugNode(tx, {
            organizationId,
            nodeId: existing.id,
            name: incoming.name,
            description: incoming.description,
            detailedDescription: incoming.detailedDescription,
            writeFormatExample: incoming.writeFormatExample,
            writeFormatHint: incoming.writeFormatHint,
            module: assignment.module,
            moduleId: assignment.moduleId,
            valueKind: incoming.valueKind,
            valueFormat: incoming.valueFormat,
            normalizationMode: incoming.normalizationMode,
            maxValueBytes: incoming.maxValueBytes ?? null,
            enabled: incoming.enabled
          })
        : await createDebugNode(tx, {
            organizationId,
            name: incoming.name,
            description: incoming.description,
            detailedDescription: incoming.detailedDescription,
            writeFormatExample: incoming.writeFormatExample,
            writeFormatHint: incoming.writeFormatHint,
            module: assignment.module,
            moduleId: assignment.moduleId,
            valueKind: incoming.valueKind,
            valueFormat: incoming.valueFormat,
            normalizationMode: incoming.normalizationMode,
            maxValueBytes: incoming.maxValueBytes ?? null,
            enabled: incoming.enabled
          });
      if (!node) {
        throw new ApiError("NOT_FOUND", "Debug node was not found.");
      }
      if (existing) {
        summary.nodesUpdated += 1;
      } else {
        summary.nodesCreated += 1;
        knownNodes.push(node);
      }

      for (const binding of incoming.bindings) {
        const saved = await upsertDebugNodeBinding(tx, {
          organizationId,
          nodeId: node.id,
          protocol: binding.protocol,
          nodePath: binding.nodePath,
          accessMode: binding.accessMode,
          enabled: binding.enabled,
          notes: binding.notes
        });
        if (!saved) {
          throw new ApiError("NOT_FOUND", "Debug node was not found.");
        }
        summary.bindingsUpserted += 1;
      }
    }

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
        metadata: { ...summary }
      }
    };
  });
}
