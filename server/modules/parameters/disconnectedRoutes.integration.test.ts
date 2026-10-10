import { describe, expect, it } from "vitest";
import { buildWiseEffRouter, createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { withTempDatabase } from "../../testing/tempDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { requestJson } from "../../test/testClient";
import { listCatalogBindingRowsForProject } from "../parameter-bindings/catalogProjectValueSync";
import { makeTestAuthContext } from "../../testing/authContext";

describe("canonical import ownership after disconnected legacy cleanup", () => {
  it("registers one owner per import, upload, binding list and draft endpoint", async () => {
    await withTempDatabase({ prefix: "t1086_route_owners" }, async ({ connectionString }) => {
      const db = createPostgresDatabase(connectionString);
      try {
        const { router } = buildWiseEffRouter({ db });
        for (const [method, pattern] of [
          ["POST", "/api/v1/parameter-import-batches"],
          ["POST", "/api/v1/parameter-import-batches/:batchId/apply"],
          ["POST", "/api/v1/projects/:projectId/parameter-files"],
          ["GET", "/api/v2/projects/:projectId/parameter-bindings"],
          ["POST", "/api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts"]
        ]) {
          expect(router.listRoutes().filter((route) => route.method === method && route.pattern === pattern),
            `${method} ${pattern}`).toHaveLength(1);
        }
      } finally {
        await db.close();
      }
    });
  });

  it("keeps import authorization, tenant, validation and conflict refusals at the canonical HTTP owner", async () => {
    await withTempDatabase({ prefix: "t1086_import_guards" }, async ({ db: fixtureDb, connectionString }) => {
      await seedCoreGraph(fixtureDb, {
        organization: { id: "org-t1086" },
        users: [{ id: "admin-t1086" }, { id: "viewer-t1086" }],
        projects: [{ id: "project-t1086" }]
      });
      await seedCoreGraph(fixtureDb, {
        organization: { id: "org-foreign-t1086" },
        users: [{ id: "admin-foreign-t1086" }],
        projects: [{ id: "project-foreign-t1086" }]
      });
      await fixtureDb.query(`insert into user_role_bindings (id, organization_id, user_id, role_id, project_id)
        values ('admin-t1086', 'org-t1086', 'admin-t1086', 'admin', null),
          ('viewer-t1086', 'org-t1086', 'viewer-t1086', 'software-user', 'project-t1086'),
          ('admin-foreign-t1086', 'org-foreign-t1086', 'admin-foreign-t1086', 'admin', null)`);
      const db = createPostgresDatabase(connectionString);
      try {
        const server = createWiseEffServer({ db, objectStore: createMemoryObjectStore() });
        const reviewMetadata = {
          skippedRows: [{ rowKey: "row-2", name: "skipped-property", module: "Power", reason: "Reviewed and excluded" }],
          notes: "Reviewed before preview"
        };
        const body = { projectId: "project-t1086", sourceName: "guard.csv", items: [{
          name: "unbound-property", module: "Power", risk: "High", unit: "A", range: "0-10", currentValue: "3"
        }], reviewMetadata };
        const preview = (payload: unknown, userId = "admin-t1086") => requestJson(server,
          "/api/v1/parameter-import-batches", {
            method: "POST", headers: { "X-WiseEff-User": userId }, body: JSON.stringify(payload)
          });
        expect((await preview(body, "viewer-t1086")).status).toBe(403);
        expect((await preview({ ...body, projectId: "project-foreign-t1086" })).status).toBe(404);
        expect((await preview({ ...body, items: [{ name: "invalid" }] })).status).toBe(400);
        expect((await db.query("select count(*)::integer as count from parameter_import_batches")).rows[0].count).toBe(0);
        const response = await preview(body);
        expect(response.status).toBe(201);
        const batch = (response.body as { item: { id: string; items: Array<{ id: string; classification: string; definitionId?: string }> } }).item;
        expect(batch.items).toEqual([expect.objectContaining({ classification: "conflict", riskFlag: true })]);
        expect(batch.items[0].definitionId).toBeUndefined();
        const audit = (await db.query(`select action, target_id, trace_id, metadata from audit_events
          where target_id = $1 and kind = 'batch-import' and action = 'preview'`, [batch.id])).rows;
        expect(audit).toEqual([{ action: "preview", target_id: batch.id, trace_id: "test-request", metadata: expect.objectContaining({
          batchId: batch.id, summary: { added: 0, updated: 0, skipped: 1 }, reviewMetadata, catalogRewrite: true
        }) }]);
        const apply = (selectedItemIds: string[], userId = "admin-t1086") => requestJson(server,
          `/api/v1/parameter-import-batches/${batch.id}/apply`, {
            method: "POST", headers: { "X-WiseEff-User": userId }, body: JSON.stringify({ selectedItemIds })
          });
        expect((await apply([batch.items[0].id], "viewer-t1086")).status).toBe(403);
        expect((await apply([batch.items[0].id], "admin-foreign-t1086")).status).toBe(404);
        expect((await apply([])).status).toBe(400);
        expect((await apply(["unknown-row"])).status).toBe(400);
        expect((await apply([batch.items[0].id])).status).toBe(409);
        expect((await db.query("select status, applied_at from parameter_import_batches where id = $1", [batch.id])).rows[0])
          .toEqual({ status: "previewed", applied_at: null });
        expect(await listCatalogBindingRowsForProject(db, makeTestAuthContext({ organizationId: "org-t1086" }), { projectId: "project-t1086" })).toEqual([]);
      } finally {
        await db.close();
      }
    });
  });
});
