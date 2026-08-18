/**
 * Behavior coverage for debug-node catalog import/export: document validation,
 * org-scoped round-trip through repository reads, and audit evidence that
 * never copies raw node paths.
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
  upsertDebugNodeBinding
} from "./catalogSplitRepository";
import {
  DEBUG_CATALOG_FORMAT_V1,
  exportDebugCatalog,
  importDebugCatalog,
  parseDebugCatalogDocument
} from "./catalogImportExport";

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

const validDocument = {
  format: DEBUG_CATALOG_FORMAT_V1,
  modules: [
    { name: "Battery", parentNamePath: [], description: "Battery pack", scope: "lab", sortOrder: 1 },
    { name: "Charging", parentNamePath: ["Battery"], description: "Charge paths", scope: "" }
  ],
  nodes: [
    {
      name: "Fast charge current",
      moduleNamePath: ["Battery", "Charging"],
      description: "Charge current node",
      enabled: true,
      bindings: [
        { protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true },
        { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true, notes: "lab" }
      ]
    }
  ]
};

describe("parseDebugCatalogDocument", () => {
  it("accepts a v1 catalog document and rejects an unknown format", () => {
    expect(parseDebugCatalogDocument(validDocument)).toMatchObject({
      format: DEBUG_CATALOG_FORMAT_V1,
      modules: [expect.objectContaining({ name: "Battery" }), expect.objectContaining({ name: "Charging" })],
      nodes: [expect.objectContaining({ name: "Fast charge current" })]
    });
    expect(() => parseDebugCatalogDocument({ format: "unknown", modules: [], nodes: [] })).toThrow(ApiError);
  });

  it("rejects bindings whose node path is not absolute", () => {
    expect(() =>
      parseDebugCatalogDocument({
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
});

describe.skipIf(!databaseAvailable)("catalogImportExport", () => {
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

  it("refuses export and import without debugging:admin", async () => {
    await expect(exportDebugCatalog(db, viewerAuth(), { requestId: "req-export" })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
    await expect(importDebugCatalog(db, viewerAuth(), validDocument, { requestId: "req-import" })).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });

  it("exports org-scoped modules and nodes, then writes summary audit without raw paths", async () => {
    const parent = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Battery",
      description: "Battery pack"
    });
    const child = await createDebugNodeModule(db, {
      organizationId: "org-1",
      name: "Charging",
      parentId: parent.id,
      description: "Charge paths"
    });
    const node = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Fast charge current",
      description: "Charge current node",
      module: child.name,
      moduleId: child.id
    });
    await upsertDebugNodeBinding(db, {
      organizationId: "org-1",
      nodeId: node.id,
      protocol: "hdc",
      nodePath: "/sys/hdc/current",
      accessMode: "RW",
      enabled: true
    });
    await createDebugNode(db, { organizationId: "org-2", name: "Foreign node", module: "Other" });

    const document = await exportDebugCatalog(db, adminAuth(), { requestId: "req-export" });

    expect(document.format).toBe(DEBUG_CATALOG_FORMAT_V1);
    expect(document.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Battery", parentNamePath: [] }),
        expect.objectContaining({ name: "Charging", parentNamePath: ["Battery"] })
      ])
    );
    expect(document.nodes).toEqual([
      expect.objectContaining({
        id: node.id,
        name: "Fast charge current",
        moduleNamePath: ["Battery", "Charging"],
        bindings: [expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW" })]
      })
    ]);
    expect(document.nodes.some((item) => item.name === "Foreign node")).toBe(false);

    const audits = await listAuditEvents(db, { organizationId: "org-1", app: "debugging", kind: "debug-node-catalog-export" });
    expect(audits.items[0]).toMatchObject({
      action: "export",
      targetType: "debug-node-catalog",
      traceId: "req-export",
      metadata: expect.objectContaining({ moduleCount: 2, nodeCount: 1, bindingCount: 1 })
    });
    expect(JSON.stringify(audits.items[0].metadata)).not.toContain("/sys/hdc/current");
  });

  it("imports a catalog by creating missing modules and nodes, then updates the same id on re-import", async () => {
    const created = await importDebugCatalog(db, adminAuth(), validDocument, { requestId: "req-import-1" });
    expect(created).toEqual({
      modulesCreated: 2,
      modulesUpdated: 0,
      nodesCreated: 1,
      nodesUpdated: 0,
      bindingsUpserted: 2
    });

    const nodes = await listDebugNodes(db, { organizationId: "org-1" });
    expect(nodes).toEqual([expect.objectContaining({ name: "Fast charge current", module: "Charging" })]);
    const bindings = await listDebugNodeBindings(db, { organizationId: "org-1", nodeId: nodes[0].id });
    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO" }),
        expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW" })
      ])
    );

    const updated = await importDebugCatalog(
      db,
      adminAuth(),
      {
        format: DEBUG_CATALOG_FORMAT_V1,
        modules: validDocument.modules,
        nodes: [
          {
            ...validDocument.nodes[0],
            id: nodes[0].id,
            description: "Updated description",
            bindings: [{ protocol: "hdc", nodePath: "/sys/hdc/updated", accessMode: "RW", enabled: true }]
          }
        ]
      },
      { requestId: "req-import-2" }
    );
    expect(updated).toMatchObject({ modulesCreated: 0, nodesCreated: 0, nodesUpdated: 1, bindingsUpserted: 1 });

    const after = await listDebugNodes(db, { organizationId: "org-1" });
    expect(after).toEqual([expect.objectContaining({ id: nodes[0].id, description: "Updated description" })]);
    const afterBindings = await listDebugNodeBindings(db, { organizationId: "org-1", nodeId: nodes[0].id });
    expect(afterBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/updated" }),
        expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current" })
      ])
    );

    const audits = await listAuditEvents(db, { organizationId: "org-1", app: "debugging", kind: "debug-node-catalog-import" });
    expect(audits.items[0]).toMatchObject({
      action: "import",
      targetType: "debug-node-catalog",
      traceId: "req-import-2"
    });
    expect(JSON.stringify(audits.items.map((item) => item.metadata))).not.toContain("/sys/hdc/updated");
  });

  it("matches an existing node by name and module path when the document omits id", async () => {
    const module = await createDebugNodeModule(db, { organizationId: "org-1", name: "Battery" });
    const existing = await createDebugNode(db, {
      organizationId: "org-1",
      name: "Cycle count",
      module: module.name,
      moduleId: module.id,
      description: "old"
    });

    const result = await importDebugCatalog(
      db,
      adminAuth(),
      {
        format: DEBUG_CATALOG_FORMAT_V1,
        modules: [{ name: "Battery", parentNamePath: [] }],
        nodes: [{ name: "Cycle count", moduleNamePath: ["Battery"], description: "from import" }]
      },
      { requestId: "req-match" }
    );

    expect(result).toMatchObject({ nodesCreated: 0, nodesUpdated: 1 });
    const listed = await listDebugNodes(db, { organizationId: "org-1" });
    expect(listed).toEqual([expect.objectContaining({ id: existing.id, description: "from import" })]);
  });
});
