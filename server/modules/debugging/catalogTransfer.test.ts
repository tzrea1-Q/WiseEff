/**
 * Behavior coverage for the debug-node catalog transfer contract (Issue #846):
 * full-set export, presence-aware v1/v2 import semantics, server-side preview and
 * atomic merge — all through the real repository and a real PostgreSQL test database.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listAuditEvents } from "../audit/repository";
import { ApiError } from "../../shared/http/errors";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import type { AuthContext } from "../auth/types";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createDebugNode,
  createDebugNodeModule,
  listDebugNodeBindings,
  listDebugNodes,
  updateDebugNode,
  upsertDebugNodeBinding
} from "./catalogSplitRepository";
import { moveDebugNodeModule } from "./debugNodeModuleRepository";
import {
  DEBUG_CATALOG_FORMAT_V1,
  DEBUG_CATALOG_FORMAT_V2,
  DEBUG_CATALOG_MAX_DOCUMENT_BYTES,
  exportDebugCatalogFull,
  importDebugCatalog,
  parseDebugCatalogTransferDocument,
  previewDebugCatalogImport,
  type DebugCatalogExportDocument
} from "./catalogTransfer";

const databaseAvailable = await isTestDatabaseAvailable();

function adminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    ...makeTestAuthContext({
      userId: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      organizationName: "ChargeLab",
      roleId: "admin",
      permissions: ["debugging:view", "debugging:admin"]
    }),
    ...overrides
  };
}

function viewerAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-1",
    organizationId: "org-1",
    permissions: ["debugging:view"]
  });
}

async function seedDebugCatalog(db: InMemoryTestDatabase) {
  const battery = await createDebugNodeModule(db, {
    organizationId: "org-1",
    name: "Battery",
    description: "Battery pack",
    scope: "lab",
    sortOrder: 1
  });
  const charging = await createDebugNodeModule(db, {
    organizationId: "org-1",
    name: "Charging",
    parentId: battery.id,
    description: "Charge paths",
    scope: "lab",
    sortOrder: 2
  });
  const thermal = await createDebugNodeModule(db, {
    organizationId: "org-1",
    name: "Thermal",
    description: "Thermal limits"
  });

  const enabled = await createDebugNode(db, {
    organizationId: "org-1",
    name: "Fast charge current",
    description: "Enabled dual-protocol node",
    detailedDescription: "Detailed text",
    writeFormatExample: "1200",
    writeFormatHint: "mA",
    module: charging.name,
    moduleId: charging.id,
    valueKind: "scalar",
    valueFormat: "raw",
    normalizationMode: "trim",
    maxValueBytes: 16,
    enabled: true
  });
  await upsertDebugNodeBinding(db, {
    organizationId: "org-1",
    nodeId: enabled.id,
    protocol: "hdc",
    nodePath: "/sys/hdc/current",
    accessMode: "RW",
    enabled: true,
    notes: "primary"
  });
  await upsertDebugNodeBinding(db, {
    organizationId: "org-1",
    nodeId: enabled.id,
    protocol: "adb",
    nodePath: "/sys/adb/current",
    accessMode: "RO",
    enabled: false,
    notes: null
  });

  const disabled = await createDebugNode(db, {
    organizationId: "org-1",
    name: "Charge limit",
    module: charging.name,
    moduleId: charging.id,
    enabled: false
  });
  await upsertDebugNodeBinding(db, {
    organizationId: "org-1",
    nodeId: disabled.id,
    protocol: "hdc",
    nodePath: "/sys/hdc/limit",
    accessMode: "RW",
    enabled: true
  });

  const archived = await createDebugNode(db, {
    organizationId: "org-1",
    name: "Legacy gauge",
    module: thermal.name,
    moduleId: thermal.id,
    enabled: true,
    archivedAt: new Date().toISOString(),
    archivedBy: "user-1",
    archiveReason: "retired"
  });
  await upsertDebugNodeBinding(db, {
    organizationId: "org-1",
    nodeId: archived.id,
    protocol: "adb",
    nodePath: "/sys/adb/gauge",
    accessMode: "RO",
    enabled: true
  });

  const unbound = await createDebugNode(db, {
    organizationId: "org-1",
    name: "Pending node",
    module: thermal.name,
    moduleId: thermal.id
  });

  const rootNode = await createDebugNode(db, {
    organizationId: "org-1",
    name: "Ungrouped node",
    module: ""
  });

  const sameNameInThermal = await createDebugNode(db, {
    organizationId: "org-1",
    name: "Fast charge current",
    module: thermal.name,
    moduleId: thermal.id
  });
  await upsertDebugNodeBinding(db, {
    organizationId: "org-1",
    nodeId: sameNameInThermal.id,
    protocol: "hdc",
    nodePath: "/sys/hdc/current-thermal",
    accessMode: "RO",
    enabled: true
  });

  return { battery, charging, thermal, enabled, disabled, archived, unbound, rootNode, sameNameInThermal };
}

async function previewThenImport(
  db: InMemoryTestDatabase,
  document: unknown,
  auth: AuthContext = adminAuth(),
  requestId = "req-import"
) {
  const preview = await previewDebugCatalogImport(db, auth, document, { requestId: `${requestId}-preview` });
  expect(preview.conflicts).toEqual([]);
  expect(preview.canSubmit).toBe(true);
  expect(preview.previewDigest).toBeTruthy();
  const result = await importDebugCatalog(
    db,
    auth,
    { document, previewDigest: preview.previewDigest! },
    { requestId }
  );
  return { preview, result };
}

describe("parseDebugCatalogTransferDocument", () => {
  it("rejects an unsupported version, unknown fields and a non-absolute binding path", () => {
    expect(() => parseDebugCatalogTransferDocument({ format: "unknown", modules: [], nodes: [] })).toThrow(ApiError);
    expect(() =>
      parseDebugCatalogTransferDocument({
        format: DEBUG_CATALOG_FORMAT_V1,
        modules: [],
        nodes: [],
        extra: 1
      })
    ).toThrow(ApiError);
    expect(() =>
      parseDebugCatalogTransferDocument({
        format: DEBUG_CATALOG_FORMAT_V1,
        modules: [],
        nodes: [
          {
            name: "Broken",
            module: "Battery",
            bindings: [{ protocol: "hdc", nodePath: "relative/path", accessMode: "RO" }]
          }
        ]
      })
    ).toThrow(ApiError);
  });

  it("rejects a document over the 20 MiB UTF-8 capacity with PAYLOAD_TOO_LARGE", () => {
    const padding = "电".repeat(Math.ceil(DEBUG_CATALOG_MAX_DOCUMENT_BYTES / 3) + 1024);
    expect(() =>
      parseDebugCatalogTransferDocument({
        format: DEBUG_CATALOG_FORMAT_V2,
        source: {},
        counts: { modules: 0, nodes: 1, bindings: 0 },
        modules: [],
        nodes: [{ name: "Oversized", moduleNamePath: [], description: padding }]
      })
    ).toThrowError(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE", status: 413 })
    );
  });

  it("keeps omitted v2 optional fields absent instead of materialising defaults", () => {
    const parsed = parseDebugCatalogTransferDocument({
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 1, nodes: 1, bindings: 0 },
      modules: [{ name: "Battery" }],
      nodes: [{ name: "Cycle count", moduleNamePath: ["Battery"] }]
    });

    expect(parsed.nodes[0].description).toBeUndefined();
    expect(parsed.nodes[0].enabled).toBeUndefined();
    expect(parsed.nodes[0].maxValueBytes).toBeUndefined();
    expect(parsed.modules[0].description).toBeUndefined();
  });
});

describe.skipIf(!databaseAvailable)("catalogTransfer", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "Foreign Org" },
      users: [{ id: "user-foreign", name: "Foreign User", email: "foreign@example.com" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("refuses export, preview and import without debugging:admin", async () => {
    await expect(exportDebugCatalogFull(db, viewerAuth(), { requestId: "req-export" })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
    await expect(
      previewDebugCatalogImport(db, viewerAuth(), { format: DEBUG_CATALOG_FORMAT_V2, source: {}, counts: { modules: 0, nodes: 0, bindings: 0 }, modules: [], nodes: [] }, { requestId: "req-preview" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      importDebugCatalog(
        db,
        viewerAuth(),
        { document: { format: DEBUG_CATALOG_FORMAT_V2, source: {}, counts: { modules: 0, nodes: 0, bindings: 0 }, modules: [], nodes: [] }, previewDigest: "x" },
        { requestId: "req-import" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("exports every persisted node, module and binding with consistent counts and audit", async () => {
    const seeded = await seedDebugCatalog(db);
    await createDebugNode(db, { organizationId: "org-2", name: "Foreign node", module: "Other" });

    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });
    const document = exported.document;

    expect(document.format).toBe(DEBUG_CATALOG_FORMAT_V2);
    expect(document.source.organizationId).toBe("org-1");
    expect(document.source.organizationName).toBe("ChargeLab");
    expect(exported.organizationId).toBe("org-1");

    const nodeIds = document.nodes.map((node) => node.sourceId);
    expect(nodeIds).toEqual(
      expect.arrayContaining([
        seeded.enabled.id,
        seeded.disabled.id,
        seeded.archived.id,
        seeded.unbound.id,
        seeded.rootNode.id,
        seeded.sameNameInThermal.id
      ])
    );
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(document.nodes.some((node) => node.name === "Foreign node")).toBe(false);

    expect(document.counts).toEqual({
      modules: 3,
      nodes: 6,
      bindings: document.nodes.reduce((total, node) => total + node.bindings.length, 0)
    });
    expect(document.counts.bindings).toBe(5);

    const archived = document.nodes.find((node) => node.sourceId === seeded.archived.id)!;
    expect(archived).toMatchObject({ archived: true, archiveReason: "retired", enabled: true });
    const disabled = document.nodes.find((node) => node.sourceId === seeded.disabled.id)!;
    expect(disabled).toMatchObject({ enabled: false, archived: false });
    const unbound = document.nodes.find((node) => node.sourceId === seeded.unbound.id)!;
    expect(unbound.bindings).toEqual([]);
    expect(unbound.moduleNamePath).toEqual(["Thermal"]);
    const rootNode = document.nodes.find((node) => node.sourceId === seeded.rootNode.id)!;
    expect(rootNode.moduleNamePath).toEqual([]);

    const dual = document.nodes.find((node) => node.sourceId === seeded.enabled.id)!;
    expect(dual.moduleNamePath).toEqual(["Battery", "Charging"]);
    expect(dual.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true, notes: "primary" }),
        expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: false })
      ])
    );

    // Same node name in two different modules must stay two distinct entries.
    expect(document.nodes.filter((node) => node.name === "Fast charge current")).toHaveLength(2);

    expect(document.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Battery", parentNamePath: [], sortOrder: 1, description: "Battery pack", scope: "lab" }),
        expect.objectContaining({ name: "Charging", parentNamePath: ["Battery"], sortOrder: 2 }),
        expect.objectContaining({ name: "Thermal", parentNamePath: [] })
      ])
    );

    const audits = await listAuditEvents(db, {
      organizationId: "org-1",
      app: "debugging",
      kind: "debug-node-catalog-export"
    });
    const audit = audits.items.find((item) => item.traceId === "req-export")!;
    expect(audit).toMatchObject({
      action: "export",
      targetId: "org-1",
      metadata: expect.objectContaining({ moduleCount: 3, nodeCount: 6, bindingCount: 5 })
    });
    const serialized = JSON.stringify(audit.metadata);
    expect(serialized).not.toContain("/sys/hdc/current");
    expect(serialized).not.toContain("/sys/adb/gauge");
  });

  it("keeps the full export set stable across module moves, renames and filters", async () => {
    const seeded = await seedDebugCatalog(db);
    const before = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-before" });

    await moveDebugNodeModule(db, { organizationId: "org-1", moduleId: seeded.thermal.id, parentId: seeded.battery.id });
    await updateDebugNode(db, { organizationId: "org-1", nodeId: seeded.unbound.id, enabled: false });

    const after = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-after" });

    expect(new Set(after.document.nodes.map((node) => node.sourceId))).toEqual(
      new Set(before.document.nodes.map((node) => node.sourceId))
    );
    const moved = after.document.nodes.find((node) => node.sourceId === seeded.unbound.id)!;
    expect(moved.moduleNamePath).toEqual(["Battery", "Thermal"]);
    expect(moved.enabled).toBe(false);
    // Moving a module must not drop or duplicate its nodes.
    expect(after.document.counts).toMatchObject({ modules: 3, nodes: 6 });
  });

  it("reports a dangling target module reference and a dangling target module parent", async () => {
    const seeded = await seedDebugCatalog(db);
    // Model a target-only integrity break the schema still permits: an org-scoped module
    // whose parent row belongs to a different organization.
    await db.query(
      `insert into debug_node_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
       values ('foreign-parent', 'org-2', null, 'Foreign parent', 'foreign-parent', 1, 0, '', '')`
    );
    await db.query(
      `insert into debug_node_modules (id, organization_id, parent_id, name, path, depth, sort_order, description, scope)
       values ('cross-org-module', 'org-1', 'foreign-parent', 'Cross org', 'cross-org-module', 1, 0, '', '')`
    );
    await db.query("update debug_nodes set debug_node_module_id = 'cross-org-module' where id = $1", [seeded.unbound.id]);

    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });
    // No node is silently dropped from the file: the whole set stays present.
    expect(exported.counts.nodes).toBe(6);
    expect(exported.document.nodes.find((node) => node.sourceId === seeded.unbound.id)).toBeTruthy();

    const preview = await previewDebugCatalogImport(db, adminAuth(), exported.document, { requestId: "req-preview" });
    expect(preview.canSubmit).toBe(false);
    expect(preview.previewDigest).toBeNull();
    expect(preview.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "dangling-target-module-parent",
          location: "debug_node_modules/cross-org-module"
        })
      ])
    );

    await expect(
      importDebugCatalog(
        db,
        adminAuth(),
        { document: exported.document, previewDigest: "whatever" },
        { requestId: "req-import" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("previews a complete org catalog re-import as unchanged with no writes and no audit", async () => {
    await seedDebugCatalog(db);
    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });
    const before = await listDebugNodes(db, { organizationId: "org-1", includeArchived: true });

    const preview = await previewDebugCatalogImport(db, adminAuth(), exported.document, { requestId: "req-preview" });

    expect(preview.canSubmit).toBe(true);
    expect(preview.format).toBe(DEBUG_CATALOG_FORMAT_V2);
    expect(preview.targetOrganizationId).toBe("org-1");
    expect(preview.sourceOrganization).toMatchObject({ organizationId: "org-1" });
    expect(preview.fileCounts).toEqual({ modules: 3, nodes: 6, bindings: 5 });
    expect(preview.modules).toEqual({ created: 0, updated: 0, unchanged: 3 });
    expect(preview.nodes).toEqual({ created: 0, updated: 0, unchanged: 6 });
    expect(preview.bindings).toEqual({ created: 0, updated: 0, unchanged: 5 });
    expect(preview.details).toEqual([]);
    expect(preview.warnings).toEqual([]);

    const after = await listDebugNodes(db, { organizationId: "org-1", includeArchived: true });
    expect(after).toEqual(before);
    const audits = await listAuditEvents(db, { organizationId: "org-1", app: "debugging" });
    expect(audits.items.filter((item) => item.kind === "debug-node-catalog-import")).toEqual([]);
  });

  it("round-trips a full catalog into an empty organization and back out again", async () => {
    const seeded = await seedDebugCatalog(db);
    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });

    await db.query("delete from debug_node_bindings where organization_id = 'org-1'");
    await db.query("update debug_nodes set debug_node_module_id = null where organization_id = 'org-1'");
    await db.query("delete from debug_nodes where organization_id = 'org-1'");
    await db.query("delete from debug_node_modules where organization_id = 'org-1'");

    const { result } = await previewThenImport(db, exported.document, adminAuth(), "req-import");
    expect(result).toMatchObject({
      modulesCreated: 3,
      nodesCreated: 6,
      bindingsCreated: 5,
      modulesUpdated: 0,
      nodesUpdated: 0,
      modulesUnchanged: 0,
      nodesUnchanged: 0,
      bindingsUnchanged: 0
    });

    const reExported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-reexport" });
    expect(reExported.counts).toEqual(exported.counts);

    const semanticProjection = (document: DebugCatalogExportDocument) =>
      document.nodes
        .map((node) => ({
          name: node.name,
          moduleNamePath: node.moduleNamePath,
          description: node.description,
          detailedDescription: node.detailedDescription,
          writeFormatExample: node.writeFormatExample,
          writeFormatHint: node.writeFormatHint,
          valueKind: node.valueKind,
          valueFormat: node.valueFormat,
          normalizationMode: node.normalizationMode,
          maxValueBytes: node.maxValueBytes,
          enabled: node.enabled,
          archived: node.archived,
          archiveReason: node.archiveReason,
          bindings: [...node.bindings].sort((left, right) => (left.protocol < right.protocol ? -1 : 1))
        }))
        .sort((left, right) => (left.moduleNamePath.join("/") + left.name < right.moduleNamePath.join("/") + right.name ? -1 : 1));

    expect(semanticProjection(reExported.document)).toEqual(semanticProjection(exported.document));
    expect(reExported.document.modules).toEqual(exported.document.modules);

    const reimported = await previewDebugCatalogImport(db, adminAuth(), reExported.document, { requestId: "req-preview" });
    expect(reimported.nodes).toEqual({ created: 0, updated: 0, unchanged: 6 });
    expect(reimported.bindings).toEqual({ created: 0, updated: 0, unchanged: 5 });

    const archivedNode = reExported.document.nodes.find((node) => node.sourceId === seeded.archived.id);
    expect(archivedNode).toBeUndefined();
    const archivedByName = reExported.document.nodes.find((node) => node.name === "Legacy gauge")!;
    expect(archivedByName).toMatchObject({ archived: true, archiveReason: "retired" });
  });

  it("classifies created, updated and unchanged nodes and preserves target-only objects", async () => {
    const seeded = await seedDebugCatalog(db);
    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });
    const targetOnly = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Target only node",
      module: seeded.thermal.name,
      moduleId: seeded.thermal.id
    });

    const document = {
      ...exported.document,
      source: { organizationId: "org-9", organizationName: "Other Org", exportedAt: "2026-01-01T00:00:00.000Z" },
      nodes: [
        ...exported.document.nodes.map((node) =>
          node.sourceId === seeded.enabled.id
            ? {
                ...node,
                description: "Imported description",
                bindings: node.bindings.map((binding) =>
                  binding.protocol === "hdc" ? { ...binding, nodePath: "/sys/hdc/current-v2", notes: "updated" } : binding
                )
              }
            : node
        ),
        { name: "Brand new node", moduleNamePath: ["Thermal"], enabled: true }
      ]
    };

    const preview = await previewDebugCatalogImport(db, adminAuth(), document, { requestId: "req-preview" });
    expect(preview.conflicts).toEqual([]);
    expect(preview.nodes).toEqual({ created: 1, updated: 1, unchanged: 5 });
    expect(preview.bindings).toEqual({ created: 0, updated: 1, unchanged: 4 });
    const updatedNodeDetail = preview.details.find((detail) => detail.object === "node" && detail.name === "Fast charge current")!;
    expect(updatedNodeDetail.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "description", before: "Enabled dual-protocol node", after: "Imported description" })])
    );
    const updatedBindingDetail = preview.details.find((detail) => detail.object === "binding" && detail.name === "hdc")!;
    expect(updatedBindingDetail.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "nodePath", before: "/sys/hdc/current", after: "/sys/hdc/current-v2" }),
        expect.objectContaining({ field: "notes", before: "primary", after: "updated" })
      ])
    );

    const result = await importDebugCatalog(
      db,
      adminAuth(),
      { document, previewDigest: preview.previewDigest! },
      { requestId: "req-import" }
    );
    expect(result).toMatchObject({ nodesCreated: 1, nodesUpdated: 1, nodesUnchanged: 5, bindingsUpdated: 1, bindingsUnchanged: 4 });

    const listed = await listDebugNodes(db, { organizationId: "org-1", includeArchived: true });
    // Target-only objects survive the merge; the matched node keeps its target id.
    expect(listed.some((node) => node.id === targetOnly.id)).toBe(true);
    const updated = listed.find((node) => node.id === seeded.enabled.id)!;
    expect(updated).toMatchObject({ name: "Fast charge current", description: "Imported description" });
    const bindings = await listDebugNodeBindings(db, { organizationId: "org-1", nodeId: seeded.enabled.id });
    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/current-v2", notes: "updated" }),
        expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", enabled: false })
      ])
    );
  });

  it("keeps omitted v1 fields, applies explicit clears and gives new objects creation defaults", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery", description: "keep me", scope: "lab" });
    const existing = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Cycle count",
      module: battery.name,
      moduleId: battery.id,
      description: "existing description",
      detailedDescription: "existing detail",
      writeFormatHint: "existing hint",
      valueKind: "complex",
      maxValueBytes: 32,
      enabled: false
    });

    const { preview } = await previewThenImport(
      db,
      {
        format: DEBUG_CATALOG_FORMAT_V1,
        modules: [{ name: "Battery", parentNamePath: [] }],
        nodes: [
          { name: "Cycle count", module: "Battery" },
          { name: "Fresh node", module: "Battery", description: "" }
        ]
      },
      adminAuth(),
      "req-v1"
    );

    expect(preview.modules).toEqual({ created: 0, updated: 0, unchanged: 1 });
    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    const kept = listed.find((node) => node.id === existing.id)!;
    // v1 defaults must not act as "clear" for a field the file omits.
    expect(kept).toMatchObject({
      description: "existing description",
      detailedDescription: "existing detail",
      writeFormatHint: "existing hint",
      valueKind: "complex",
      maxValueBytes: 32,
      enabled: false
    });
    const fresh = listed.find((node) => node.name === "Fresh node")!;
    expect(fresh).toMatchObject({
      description: "",
      detailedDescription: "",
      valueKind: "scalar",
      valueFormat: "raw",
      normalizationMode: "trim",
      maxValueBytes: null,
      enabled: true
    });
  });

  it("distinguishes explicit clears from omission on v2 documents", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery", description: "keep me", scope: "lab" });
    const node = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Cycle count",
      module: battery.name,
      moduleId: battery.id,
      description: "clear me",
      maxValueBytes: 64
    });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "hdc",
      nodePath: "/sys/hdc/cycles",
      accessMode: "RO",
      enabled: true,
      notes: "clear me"
    });

    const preview = await previewDebugCatalogImport(
      db,
      adminAuth(),
      {
        format: DEBUG_CATALOG_FORMAT_V2,
        source: {},
        counts: { modules: 1, nodes: 1, bindings: 1 },
        modules: [{ name: "Battery" }],
        nodes: [
          {
            sourceId: node.id,
            name: "Cycle count",
            moduleNamePath: ["Battery"],
            description: "",
            maxValueBytes: null,
            bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/cycles", accessMode: "RO", notes: null }]
          }
        ]
      },
      { requestId: "req-clear" }
    );

    expect(preview.nodes).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(preview.bindings).toEqual({ created: 0, updated: 1, unchanged: 0 });
    // A module entry without description/scope keeps the target values.
    expect(preview.modules).toEqual({ created: 0, updated: 0, unchanged: 1 });

    const result = await importDebugCatalog(
      db,
      adminAuth(),
      {
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 1, nodes: 1, bindings: 1 },
          modules: [{ name: "Battery" }],
          nodes: [
            {
              sourceId: node.id,
              name: "Cycle count",
              moduleNamePath: ["Battery"],
              description: "",
              maxValueBytes: null,
              bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/cycles", accessMode: "RO", notes: null }]
            }
          ]
        },
        previewDigest: preview.previewDigest!
      },
      { requestId: "req-clear-import" }
    );
    expect(result).toMatchObject({ nodesUpdated: 1, bindingsUpdated: 1, modulesUnchanged: 1 });

    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed[0]).toMatchObject({ description: "", maxValueBytes: null });
    const bindings = await listDebugNodeBindings(db, { organizationId: "org-1", nodeId: node.id });
    expect(bindings[0]).toMatchObject({ notes: null });
    const modules = await db.query<{ description: string; scope: string }>(
      "select description, scope from debug_node_modules where organization_id = 'org-1'"
    );
    expect(modules.rows[0]).toMatchObject({ description: "keep me", scope: "lab" });
  });

  it("matches by source id, by unique name path, and creates when neither matches", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    const thermal = await createDebugNodeModule(db, { organizationId: "org-1", name: "Thermal" });
    const byId = await createDebugNode(db, { organizationId: "org-1", name: "By id", module: battery.name, moduleId: battery.id });
    const byName = await createDebugNode(db, { organizationId: "org-1", name: "By name", module: thermal.name, moduleId: thermal.id });

    const document = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 2, nodes: 3, bindings: 0 },
      modules: [{ name: "Battery" }, { name: "Thermal" }],
      nodes: [
        { sourceId: byId.id, name: "By id", moduleNamePath: ["Battery"], description: "id match" },
        { name: "By name", moduleNamePath: ["Thermal"], description: "name match" },
        { name: "Created node", moduleNamePath: ["Thermal"] }
      ]
    };

    const { preview } = await previewThenImport(db, document, adminAuth(), "req-match");
    expect(preview.nodes).toEqual({ created: 1, updated: 2, unchanged: 0 });

    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed.find((node) => node.id === byId.id)).toMatchObject({ description: "id match" });
    expect(listed.find((node) => node.id === byName.id)).toMatchObject({ description: "name match" });
    expect(listed.filter((node) => node.name === "By name")).toHaveLength(1);
  });

  it("blocks ambiguous, contradictory and duplicated input conflicts without writing", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    const thermal = await createDebugNodeModule(db, { organizationId: "org-1", name: "Thermal" });
    const node = await createDebugNode(db, { organizationId: "org-1", name: "Cycle count", module: battery.name, moduleId: battery.id });

    const cases: Array<{ name: string; document: unknown; code: string }> = [
      {
        name: "source id and name path disagree",
        code: "source-id-name-path-mismatch",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 2, nodes: 1, bindings: 0 },
          modules: [{ name: "Battery" }, { name: "Thermal" }],
          nodes: [{ sourceId: node.id, name: "Cycle count", moduleNamePath: ["Thermal"] }]
        }
      },
      {
        name: "two file nodes claim the same target",
        code: "duplicate-target-claim",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 1, nodes: 2, bindings: 0 },
          modules: [{ name: "Battery" }],
          nodes: [
            { sourceId: node.id, name: "Cycle count", moduleNamePath: ["Battery"] },
            { name: "Cycle count", moduleNamePath: ["Battery"] }
          ]
        }
      },
      {
        name: "duplicate source id",
        code: "duplicate-source-id",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 1, nodes: 2, bindings: 0 },
          modules: [{ name: "Battery" }],
          nodes: [
            { sourceId: "dup", name: "One", moduleNamePath: ["Battery"] },
            { sourceId: "dup", name: "Two", moduleNamePath: ["Battery"] }
          ]
        }
      },
      {
        name: "duplicate module path",
        code: "duplicate-module-path",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 2, nodes: 0, bindings: 0 },
          modules: [{ name: "Battery" }, { name: "Battery" }],
          nodes: []
        }
      },
      {
        name: "dangling module parent",
        code: "dangling-module-parent",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 1, nodes: 0, bindings: 0 },
          modules: [{ name: "Charging", parentNamePath: ["Missing"] }],
          nodes: []
        }
      },
      {
        name: "dangling node module",
        code: "dangling-node-module",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 0, nodes: 1, bindings: 0 },
          modules: [],
          nodes: [{ name: "Orphan", moduleNamePath: ["Nowhere"] }]
        }
      },
      {
        name: "duplicate binding protocol",
        code: "duplicate-binding-protocol",
        document: {
          format: DEBUG_CATALOG_FORMAT_V2,
          source: {},
          counts: { modules: 1, nodes: 1, bindings: 2 },
          modules: [{ name: "Battery" }],
          nodes: [
            {
              name: "Cycle count",
              moduleNamePath: ["Battery"],
              bindings: [
                { protocol: "hdc", nodePath: "/a", accessMode: "RO" },
                { protocol: "hdc", nodePath: "/b", accessMode: "RO" }
              ]
            }
          ]
        }
      }
    ];

    for (const testCase of cases) {
      const preview = await previewDebugCatalogImport(db, adminAuth(), testCase.document, { requestId: `req-${testCase.code}` });
      expect(preview.canSubmit, testCase.name).toBe(false);
      expect(preview.previewDigest, testCase.name).toBeNull();
      expect(preview.conflicts.map((conflict) => conflict.code), testCase.name).toContain(testCase.code);
      expect(preview.conflicts[0]?.location, testCase.name).toMatch(/^(modules|nodes)\[/);

      await expect(
        importDebugCatalog(db, adminAuth(), { document: testCase.document, previewDigest: "anything" }, { requestId: `req-import-${testCase.code}` })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    }

    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: node.id, name: "Cycle count", moduleId: battery.id });
  });

  it("rejects an import whose document or target changed after the preview", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    const document = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 1, nodes: 1, bindings: 0 },
      modules: [{ name: "Battery" }],
      nodes: [{ name: "Cycle count", moduleNamePath: ["Battery"], description: "from file" }]
    };

    const preview = await previewDebugCatalogImport(db, adminAuth(), document, { requestId: "req-preview" });
    expect(preview.canSubmit).toBe(true);

    // The file itself changed after the preview.
    await expect(
      importDebugCatalog(
        db,
        adminAuth(),
        {
          document: { ...document, nodes: [{ ...document.nodes[0], description: "different" }] },
          previewDigest: preview.previewDigest!
        },
        { requestId: "req-import-file" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT", details: expect.objectContaining({ reason: "stale-preview" }) });

    // The target changed after the preview.
    const created = await createDebugNode(db, { organizationId: "org-1", name: "Cycle count", module: battery.name, moduleId: battery.id });
    await expect(
      importDebugCatalog(db, adminAuth(), { document, previewDigest: preview.previewDigest! }, { requestId: "req-import-target" })
    ).rejects.toMatchObject({ code: "CONFLICT", details: expect.objectContaining({ reason: "stale-preview" }) });

    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed).toEqual([expect.objectContaining({ id: created.id, name: "Cycle count", description: "" })]);
  });

  it("rejects an old preview when the approved target node was edited, moved or removed", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    await createDebugNodeModule(db, { organizationId: "org-1", name: "Thermal" });
    const node = await createDebugNode(db, { organizationId: "org-1", name: "Cycle count", module: battery.name, moduleId: battery.id });
    const document = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 2, nodes: 1, bindings: 0 },
      modules: [{ name: "Battery" }, { name: "Thermal" }],
      nodes: [{ sourceId: node.id, name: "Cycle count", moduleNamePath: ["Battery"], description: "from file" }]
    };

    const preview = await previewDebugCatalogImport(db, adminAuth(), document, { requestId: "req-preview" });
    expect(preview.canSubmit).toBe(true);
    await updateDebugNode(db, { organizationId: "org-1", nodeId: node.id, description: "edited after preview" });

    await expect(
      importDebugCatalog(db, adminAuth(), { document, previewDigest: preview.previewDigest! }, { requestId: "req-import" })
    ).rejects.toMatchObject({ code: "CONFLICT", details: expect.objectContaining({ reason: "stale-preview" }) });

    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed[0]).toMatchObject({ description: "edited after preview" });
  });

  it("preserves archive state on existing nodes and archives newly created archived nodes", async () => {
    const battery = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    const archived = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Already archived",
      module: battery.name,
      moduleId: battery.id,
      archivedAt: new Date().toISOString(),
      archivedBy: "user-1",
      archiveReason: "old decision"
    });
    const active = await createDebugNode(db, { organizationId: "org-1", name: "Active node", module: battery.name, moduleId: battery.id });

    const document = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 1, nodes: 3, bindings: 0 },
      modules: [{ name: "Battery" }],
      nodes: [
        { sourceId: archived.id, name: "Already archived", moduleNamePath: ["Battery"], archived: false },
        { sourceId: active.id, name: "Active node", moduleNamePath: ["Battery"], archived: true },
        { name: "New archived node", moduleNamePath: ["Battery"], archived: true, archiveReason: "migrated as archived" }
      ]
    };

    const preview = await previewDebugCatalogImport(db, adminAuth(), document, { requestId: "req-preview" });
    expect(preview.conflicts).toEqual([]);
    expect(preview.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "archive-state-preserved" })])
    );

    const result = await importDebugCatalog(
      db,
      adminAuth(),
      { document, previewDigest: preview.previewDigest! },
      { requestId: "req-import" }
    );
    expect(result).toMatchObject({ nodesCreated: 1, nodesUpdated: 0, nodesUnchanged: 2 });

    const listed = await listDebugNodes(db, { organizationId: "org-1", includeArchived: true });
    const stillArchived = listed.find((node) => node.id === archived.id)!;
    expect(stillArchived.archivedAt).toBeTruthy();
    expect(stillArchived.archiveReason).toBe("old decision");
    const stillActive = listed.find((node) => node.id === active.id)!;
    expect(stillActive.archivedAt).toBeNull();
    const newArchived = listed.find((node) => node.name === "New archived node")!;
    expect(newArchived.archivedAt).toBeTruthy();
    expect(newArchived.archiveReason).toBe("migrated as archived");
    expect(newArchived.archivedBy).toBe("user-1");
  });

  it("is idempotent: re-importing the same file produces zero further business changes", async () => {
    await seedDebugCatalog(db);
    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });

    const first = await previewThenImport(db, exported.document, adminAuth(), "req-first");
    expect(first.result).toMatchObject({ nodesCreated: 0, nodesUpdated: 0, nodesUnchanged: 6, modulesUnchanged: 3 });

    const secondPreview = await previewDebugCatalogImport(db, adminAuth(), exported.document, { requestId: "req-second-preview" });
    expect(secondPreview.nodes).toEqual({ created: 0, updated: 0, unchanged: 6 });
    expect(secondPreview.modules).toEqual({ created: 0, updated: 0, unchanged: 3 });
    expect(secondPreview.bindings).toEqual({ created: 0, updated: 0, unchanged: 5 });

    const before = await listDebugNodes(db, { organizationId: "org-1", includeArchived: true });
    const second = await importDebugCatalog(
      db,
      adminAuth(),
      { document: exported.document, previewDigest: secondPreview.previewDigest! },
      { requestId: "req-second" }
    );
    expect(second).toMatchObject({
      nodesCreated: 0,
      nodesUpdated: 0,
      nodesUnchanged: 6,
      modulesCreated: 0,
      modulesUpdated: 0,
      bindingsCreated: 0,
      bindingsUpdated: 0
    });
    const after = await listDebugNodes(db, { organizationId: "org-1", includeArchived: true });
    expect(after.map((node) => node.id)).toEqual(before.map((node) => node.id));
  });

  it("rolls back every change and the audit event when a write fails mid-import", async () => {
    await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    const document = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 1, nodes: 2, bindings: 1 },
      modules: [{ name: "Battery" }],
      nodes: [
        { name: "First node", moduleNamePath: ["Battery"] },
        {
          name: "Second node",
          moduleNamePath: ["Battery"],
          bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/second", accessMode: "RO" }]
        }
      ]
    };

    const preview = await previewDebugCatalogImport(db, adminAuth(), document, { requestId: "req-preview" });
    expect(preview.canSubmit).toBe(true);

    // Fail only the second node's binding write: the first node insert and the module
    // insert before it must roll back too.
    await db.query(
      `create or replace function wiseeff_test_fail_binding() returns trigger as $$
       begin
         if new.node_path = '/sys/hdc/second' then
           raise exception 'injected binding failure';
         end if;
         return new;
       end;
       $$ language plpgsql`
    );
    await db.query("create trigger wiseeff_test_fail_binding before insert on debug_node_bindings for each row execute function wiseeff_test_fail_binding()");

    await expect(
      importDebugCatalog(db, adminAuth(), { document, previewDigest: preview.previewDigest! }, { requestId: "req-import" })
    ).rejects.toThrow(/injected binding failure/);

    await db.query("drop trigger if exists wiseeff_test_fail_binding on debug_node_bindings");

    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed).toEqual([]);
    // Only the pre-existing module survives: the module inserted by the failed import rolled back.
    const modules = await db.query<{ id: string }>(
      "select id from debug_node_modules where organization_id = 'org-1'"
    );
    expect(modules.rows).toHaveLength(1);
    expect(modules.rows[0].id).toBeTruthy();
    const audits = await listAuditEvents(db, { organizationId: "org-1", app: "debugging", kind: "debug-node-catalog-import" });
    expect(audits.items).toEqual([]);
  });

  it("writes the import audit event with counts and digest but without raw node paths", async () => {
    await seedDebugCatalog(db);
    const exported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-export" });
    const preview = await previewDebugCatalogImport(db, adminAuth(), exported.document, { requestId: "req-preview-import" });
    const imported = await importDebugCatalog(
      db,
      adminAuth(),
      { document: exported.document, previewDigest: preview.previewDigest! },
      { requestId: "req-import-audit" }
    );
    expect(imported).toMatchObject({ nodesCreated: 0, nodesUpdated: 0, nodesUnchanged: 6, bindingsUnchanged: 5 });

    const audits = await listAuditEvents(db, { organizationId: "org-1", app: "debugging", kind: "debug-node-catalog-import" });
    const audit = audits.items.find((item) => item.traceId === "req-import-audit")!;
    expect(audit).toMatchObject({
      action: "import",
      targetId: "org-1",
      metadata: expect.objectContaining({
        nodesUnchanged: 6,
        previewDigest: expect.any(String)
      })
    });
    const serialized = JSON.stringify(audit.metadata);
    expect(serialized).not.toContain("/sys/hdc/current");
    expect(serialized).not.toContain("Fast charge current");
  });

  it("handles documents beyond the former 2,000 node / 500 module import caps", async () => {
    const modules = Array.from({ length: 501 }, (_, index) => ({
      name: `Module ${String(index).padStart(3, "0")}`,
      parentNamePath: [] as string[]
    }));
    const nodes = Array.from({ length: 2001 }, (_, index) => {
      const moduleName = modules[index % modules.length].name;
      return {
        name: `Node ${String(index).padStart(4, "0")}`,
        moduleNamePath: [moduleName],
        enabled: index % 3 !== 0,
        archived: index % 100 === 0,
        bindings:
          index % 4 === 0
            ? []
            : [
                {
                  protocol: index % 2 === 0 ? ("hdc" as const) : ("adb" as const),
                  nodePath: `/sys/acceptance/node-${index}`,
                  accessMode: "RW" as const,
                  enabled: index % 5 !== 0
                }
              ]
      };
    });
    const document = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: {
        modules: modules.length,
        nodes: nodes.length,
        bindings: nodes.reduce((total, node) => total + node.bindings.length, 0)
      },
      modules,
      nodes
    };

    const preview = await previewDebugCatalogImport(db, adminAuth(), document, { requestId: "req-capacity-preview" });
    expect(preview.canSubmit).toBe(true);
    expect(preview.fileCounts).toEqual(document.counts);
    expect(preview.nodes).toEqual({ created: 2001, updated: 0, unchanged: 0 });
    expect(preview.modules).toEqual({ created: 501, updated: 0, unchanged: 0 });

    const result = await importDebugCatalog(
      db,
      adminAuth(),
      { document, previewDigest: preview.previewDigest! },
      { requestId: "req-capacity-import" }
    );
    expect(result).toMatchObject({ modulesCreated: 501, nodesCreated: 2001 });

    const reExported = await exportDebugCatalogFull(db, adminAuth(), { requestId: "req-capacity-export" });
    expect(reExported.counts).toEqual(document.counts);
    expect(reExported.document.nodes.every((node) => node.moduleNamePath.length === 1)).toBe(true);

    const rePreview = await previewDebugCatalogImport(db, adminAuth(), reExported.document, { requestId: "req-capacity-repreview" });
    expect(rePreview.nodes).toEqual({ created: 0, updated: 0, unchanged: 2001 });
    expect(rePreview.modules).toEqual({ created: 0, updated: 0, unchanged: 501 });
  });

  it("round-trips a document just under the 20 MiB capacity and rejects one over it without writes", async () => {
    const filler = "x".repeat(4000);
    const nodes = Array.from({ length: 400 }, (_, index) => ({
      name: `Padding node ${index}`,
      moduleNamePath: [] as string[],
      description: filler
    }));
    const withinCapacity = {
      format: DEBUG_CATALOG_FORMAT_V2,
      source: {},
      counts: { modules: 0, nodes: nodes.length, bindings: 0 },
      modules: [],
      nodes
    };
    const withinBytes = Buffer.byteLength(JSON.stringify(withinCapacity), "utf8");
    expect(withinBytes).toBeLessThan(DEBUG_CATALOG_MAX_DOCUMENT_BYTES);

    const { result } = await previewThenImport(db, withinCapacity, adminAuth(), "req-capacity-fit");
    expect(result.nodesCreated).toBe(nodes.length);

    const oversized = {
      ...withinCapacity,
      counts: { modules: 0, nodes: 1, bindings: 0 },
      nodes: [{ name: "Too big", moduleNamePath: [], description: "电".repeat(DEBUG_CATALOG_MAX_DOCUMENT_BYTES / 3 + 1024) }]
    };
    const before = await listDebugNodes(db, { organizationId: "org-1" });
    await expect(
      previewDebugCatalogImport(db, adminAuth(), oversized, { requestId: "req-too-big" })
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
    const after = await listDebugNodes(db, { organizationId: "org-1" });
    expect(after).toEqual(before);
  });
});
