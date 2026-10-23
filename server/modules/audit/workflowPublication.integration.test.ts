import { describe, expect, it } from "vitest";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { createUserInvocation } from "../auth/trustedInvocation";
import type { AuthContext } from "../auth/types";
import { updateWorkflowPublication } from "../workflow-publication/service";
import type { ListAuditEventsResult } from "./listTypes";
import { createAuditEvent, listAuditEvents, writePlatformAuditEvent } from "./repository";
import { registerAuditRoutes } from "./routes";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("workflow publication audit visibility", () => {
  it("admits only the trusted super administrator to global publication history, preserving other scopes and filters", async () => {
    await withTempDatabase({ prefix: "publication_audit_read" }, async ({ db }) => {
      await seedCoreGraph(db, { organization: { id: "audit-home" }, users: [{ id: "home-admin", name: "Home administrator" }] });
      await seedCoreGraph(db, { organization: { id: "audit-other" }, users: [{ id: "publication-editor", name: "Publication editor" }] });
      const publisher = makeTestAuthContext({ roleId: "platform-admin", userId: "publication-editor", organizationId: "audit-other" });
      await updateWorkflowPublication(db, createUserInvocation(publisher), {
        workflows: { "parameter-management": true, debugging: true, "log-analysis": false, knowledge: false }, expectedVersion: 0
      }, "publication-change");
      const localEvent = {
        id: "own-event", organizationId: "audit-home", projectId: null, actorUserId: "home-admin",
        actorType: "user" as const, app: "platform", kind: "own-operation", action: "update", severity: "High" as const,
        targetType: "organization", targetId: "audit-home", metadata: {}, traceId: "own-trace"
      };
      await createAuditEvent(db, localEvent);
      await createAuditEvent(db, { ...localEvent, id: "other-tenant", organizationId: "audit-other",
        actorUserId: "publication-editor", kind: "workflow-publication-updated" });
      await writePlatformAuditEvent(db, { ...localEvent, id: "other-platform", kind: "schema-promotion", affectedOrganizationIds: [] });
      expect((await listAuditEvents(db, { organizationId: "audit-home" })).items.map((item) => item.id)).toEqual(["own-event"]);

      const fetchHistory = async (auth: AuthContext, query = "") => {
        const router = createRouter();
        registerAuditRoutes(router, { db, getCurrentAuthContext: () => auth });
        return requestJson<ListAuditEventsResult>(createHttpServer(router), `/api/v1/audit-events${query}`);
      };
      const administrator = makeTestAuthContext({ roleId: "admin", userId: "home-admin", organizationId: "audit-home" });
      for (const auth of [
        administrator,
        { ...administrator, roles: [{ roleId: "platform-admin" as const, projectId: "project" }] },
        { ...administrator, user: { ...administrator.user, isActive: false }, roles: [{ roleId: "platform-admin" as const, projectId: null }] }
      ]) {
        expect((await fetchHistory(auth, "?includePlatformWorkflowPublication=true&organizationId=audit-other")).status).toBe(403);
        const result = await fetchHistory(auth, "?includePlatformWorkflowPublication=true");
        expect(result.status).toBe(200);
        expect(result.body.items.map((item) => item.id)).toEqual(["own-event"]);
        expect((await fetchHistory(auth, "?kind=workflow-publication-updated&includePlatformWorkflowPublication=true")).body.items).toEqual([]);
      }

      const superadmin = { ...administrator, roles: [{ roleId: "platform-admin" as const, projectId: null }] };
      const visible = await fetchHistory(superadmin);
      expect(visible.status).toBe(200);
      expect(visible.body.items).toHaveLength(2);
      expect(visible.body.items.find((item) => item.organizationId === null)).toMatchObject({
        kind: "workflow-publication-updated", actorName: "Publication editor", actorUserId: "publication-editor", traceId: "publication-change"
      });
      expect(visible.body.items.map((item) => item.id)).not.toEqual(expect.arrayContaining(["other-platform", "other-tenant"]));
      const filtered = await fetchHistory(superadmin, "?kind=workflow-publication-updated");
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].organizationId).toBeNull();
      for (const query of ["?eventId=other-platform", "?eventId=other-tenant", "?kind=schema-promotion"])
        expect((await fetchHistory(superadmin, query)).body.items).toEqual([]);
      const first = await fetchHistory(superadmin, "?limit=1");
      expect(first.body.items).toHaveLength(1);
      const second = await fetchHistory(superadmin, `?limit=1&cursor=${first.body.nextCursor}`);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
      expect(second.body.nextCursor).toBeNull();
    });
  });
});
