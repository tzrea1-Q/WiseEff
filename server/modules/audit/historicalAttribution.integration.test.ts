import { describe, expect, it } from "vitest";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { seedCoreGraph } from "../../testing/fixtures";
import { withTempDatabase } from "../../testing/tempDatabase";
import { registerAuditRoutes } from "./routes";

describe("historical attribution through the audit API", () => {
  it("retains the actor and occurrence organization after rename, transfer and account deletion", async () => {
    await withTempDatabase({ prefix: "history_attribution" }, async ({ db }) => {
      await seedCoreGraph(db, { organization: { id: "history-home", name: "Original organization" },
        users: [{ id: "history-actor", name: "Original author" }, { id: "history-admin", name: "Administrator" }] });
      await seedCoreGraph(db, { organization: { id: "history-destination", name: "Destination" } });
      const actor = makeTestAuthContext({ roleId: "admin", organizationId: "history-home", userId: "history-actor" });
      const admin = makeTestAuthContext({ roleId: "admin", organizationId: "history-home", userId: "history-admin" });
      const route = (auth = admin) => {
        const router = createRouter();
        registerAuditRoutes(router, { db, getCurrentAuthContext: () => auth });
        return createHttpServer(router);
      };
      const created = await requestJson<{ id: string }>(route(actor), "/api/v1/audit-events", {
        method: "POST", body: JSON.stringify({ app: "parameters", kind: "parameter-review", action: "approve", severity: "Low" })
      });
      expect(created.status).toBe(201);
      await db.query("delete from user_oidc_identities where user_id='history-actor'");
      await db.query("update users set name='Renamed author', organization_id='history-destination' where id='history-actor'");
      await db.query("update organizations set name='Renamed organization' where id='history-home'");
      const read = () => requestJson<{ items: Array<Record<string, unknown>> }>(route(), `/api/v1/audit-events?eventId=${created.body.id}`);
      const expected = { actorName: "Original author", organizationId: "history-home", historicalAttribution: {
        organization: { id: "history-home", name: "Original organization", source: "recorded" },
        actors: { actor_user_id: { id: "history-actor", name: "Original author", source: "recorded" } }
      } };
      expect((await read()).body.items).toMatchObject([expected]);
      await db.query("delete from users where id='history-actor'");
      expect((await read()).body.items).toMatchObject([{ ...expected, actorUserId: null }]);
      const byActor = await requestJson<{ items: unknown[] }>(route(), "/api/v1/audit-events?actorUserId=history-actor");
      expect(byActor.body.items).toHaveLength(1);
      const searched = await requestJson<{ items: unknown[] }>(route(), "/api/v1/audit-events?q=Original%20author");
      expect(searched.body.items).toHaveLength(1);
    });
  });

  it("records a platform administrator's actual name when operating in a different organization", async () => {
    await withTempDatabase({ prefix: "platform_history" }, async ({ db }) => {
      await seedCoreGraph(db, { organization: { id: "platform-home", name: "Platform home" },
        users: [{ id: "platform-actor", name: "Platform administrator" }] });
      await seedCoreGraph(db, { organization: { id: "operating-org", name: "Managed organization" },
        users: [{ id: "operating-admin", name: "Organization administrator" }] });
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('platform-history-role','platform-actor','platform-home','platform-admin')");
      const actor = makeTestAuthContext({ roleId: "platform-admin", organizationId: "platform-home", userId: "platform-actor" });
      const target = { ...actor, organization: { id: "operating-org", name: "Managed organization" } };
      const reader = makeTestAuthContext({ roleId: "admin", organizationId: "operating-org", userId: "operating-admin" });
      const router = createRouter();
      let current = target;
      registerAuditRoutes(router, { db, getCurrentAuthContext: () => current });
      const server = createHttpServer(router);
      const created = await requestJson<{ id: string }>(server, "/api/v1/audit-events", { method: "POST",
        body: JSON.stringify({ app: "parameters", kind: "parameter-review", action: "approve", severity: "Low" }) });
      expect(created.status).toBe(201);
      await db.query("update users set name='Renamed platform administrator' where id='platform-actor'");
      await db.query("delete from user_role_bindings where user_id='platform-actor'");
      current = reader;
      expect((await requestJson<{ items: Array<Record<string, unknown>> }>(server,
        `/api/v1/audit-events?eventId=${created.body.id}`)).body.items).toMatchObject([{ actorName: "Platform administrator" }]);
      await db.query("delete from users where id='platform-actor'");
      const result = await requestJson<{ items: Array<Record<string, unknown>> }>(server, `/api/v1/audit-events?eventId=${created.body.id}`);
      expect(result.body.items).toMatchObject([{ actorName: "Platform administrator", actorUserId: null,
        historicalAttribution: { organization: { id: "operating-org", name: "Managed organization" },
          actors: { actor_user_id: { id: "platform-actor", name: "Platform administrator", source: "recorded" } } } }]);
    });
  });
});
