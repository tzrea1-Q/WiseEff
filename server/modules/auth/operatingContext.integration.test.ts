import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedBaselineAuthCatalog } from "./baselineCatalog";
import { createTokenVerifier } from "./tokenVerifier";
import type { AuthContext } from "./types";
import { operatingContextResponseSchema } from "../contracts/dtoSchemas/organizationScope";

const available = await isTestDatabaseAvailable();
const home = { id: "scope-home", name: "Home organization" };
const target = { id: "scope-target", name: "Target organization" };
const secret = "operating-scope-test-only";
type ScopeResponse = { actor: AuthContext; organization: typeof home };

function token(userId: string, organizationId = home.id) {
  const payload = Buffer.from(JSON.stringify({
    iss: "scope-test", sub: userId, org: organizationId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    roles: [{ roleId: "platform-admin", projectId: null }]
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function fixture() {
  const db = await createInMemoryTestDatabase();
  await seedCoreGraph(db, { organization: home, users: [{ id: "scope-platform" }, { id: "scope-member" }, { id: "scope-project-platform" }], projects: [{ id: "scope-project" }] });
  await seedCoreGraph(db, { organization: target, users: [{ id: "target-admin" }] });
  await seedBaselineAuthCatalog(db);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
    ('scope-platform-role','scope-platform',$1,'platform-admin'),
    ('scope-member-role','scope-member',$1,'admin'),
    ('scope-target-role','target-admin',$2,'admin')`, [home.id, target.id]);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values('project-platform-role','scope-project-platform',$1,'scope-project','platform-admin')", [home.id]);
  const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "hmac" }, auth: {
    mode: "production", verifier: createTokenVerifier({ issuer: "scope-test", secret })
  } });
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = token("scope-platform")) => requestJson<T>(server, path, {
    method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { db, request, close: () => db.rollback() };
}

describe.skipIf(!available)("server-authorized operating organizations over real HTTP and PostgreSQL", () => {
  it("defaults to the real actor's Home organization without changing existing personal or organization APIs", async () => {
    const h = await fixture();
    try {
      const me = await h.request<AuthContext>("/api/v1/me");
      expect(me.status).toBe(200);
      const scope = await h.request<ScopeResponse>("/api/v1/organization/operating-scope", "POST", {});
      expect(scope.status).toBe(200);
      expect(scope.body).toEqual({ actor: me.body, organization: home });
      expect(operatingContextResponseSchema.parse(scope.body)).toEqual(scope.body);
      expect((await h.request<AuthContext>("/api/v1/me")).body).toEqual(me.body);
      expect((await h.request<{ organization: typeof home }>("/api/v1/organization")).body.organization).toMatchObject(home);
    } finally { await h.close(); }
  });

  it("authorizes an explicit target under the platform administrator's real identity and audits that target without moving personal operations", async () => {
    const h = await fixture();
    try {
      const scope = await h.request<ScopeResponse>("/api/v1/organization/operating-scope", "POST", { organizationId: target.id });
      expect(scope.status).toBe(200);
      expect(scope.body).toMatchObject({ actor: { user: { id: "scope-platform", organizationId: home.id }, organization: home }, organization: target });
      const audit = await h.request<{ items: Array<Record<string, unknown>> }>("/api/v1/audit-events?kind=organization-operating-scope", "GET", undefined, token("target-admin", target.id));
      expect(audit.status).toBe(200);
      expect(audit.body.items).toHaveLength(1);
      expect(audit.body.items[0]).toMatchObject({
        actorUserId: "scope-platform", actorType: "user", organizationId: target.id,
        targetType: "organization", targetId: target.id,
        metadata: { initiator: "user", actorHomeOrganizationId: home.id, operatingOrganizationId: target.id }
      });
      const profile = await h.request<AuthContext>("/api/v1/me/profile", "PATCH", { name: "Real platform person" });
      expect(profile.status).toBe(200);
      expect(profile.body.user).toMatchObject({ id: "scope-platform", organizationId: home.id, name: "Real platform person" });
      expect((await h.request<{ organization: typeof home }>("/api/v1/organization")).body.organization).toMatchObject(home);
      const next = await h.request<ScopeResponse>("/api/v1/organization/operating-scope", "POST", {});
      expect(next.body.organization).toEqual(home);
      expect(next.body.actor.user.organizationId).toBe(home.id);
    } finally { await h.close(); }
  });

  it("rejects unauthorized, unknown and malformed targets using stored authority, even when signed claims assert platform administration", async () => {
    const h = await fixture();
    try {
      for (const userId of ["scope-member", "scope-project-platform"]) {
        const own = await h.request<ScopeResponse>("/api/v1/organization/operating-scope", "POST", {}, token(userId));
        expect(own.status).toBe(200);
        expect(own.body.organization).toEqual(home);
        for (const organizationId of [target.id, "unknown-organization"]) {
          expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId }, token(userId))).status).toBe(403);
        }
      }
      expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId: "unknown-organization" })).status).toBe(404);
      for (const body of [{ organizationId: " " }, { organizationId: [home.id, target.id] }, { organizationId: target.id, actor: { id: "target-admin" } }]) {
        expect((await h.request("/api/v1/organization/operating-scope", "POST", body)).status).toBe(400);
      }
      const issued = await h.request<{ token: string }>("/api/v1/log-integration-credentials", "POST", { name: "Scope boundary credential" });
      expect(issued.status).toBe(201);
      expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId: target.id }, issued.body.token)).status).toBe(403);
      expect((await h.request("/api/v1/organization/operating-scope", "POST", {}, "")).status).toBe(401);
      expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId: home.id }, token("scope-member", target.id))).status).toBe(401);
      await h.db.query("delete from user_role_bindings where user_id='scope-platform'");
      await h.db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('demoted-platform-role','scope-platform',$1,'admin')", [home.id]);
      expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId: target.id })).status).toBe(403);
      await h.db.query("update users set is_active=false where id='scope-platform'");
      expect((await h.request("/api/v1/organization/operating-scope", "POST", {})).status).toBe(403);
      const audit = await h.request<{ items: unknown[] }>("/api/v1/audit-events?kind=organization-operating-scope", "GET", undefined, token("target-admin", target.id));
      expect(audit.body.items).toEqual([]);
    } finally { await h.close(); }
  });

  it("does not report a successful scope entry when its target audit cannot be stored", async () => {
    const h = await fixture();
    try {
      await h.db.query("create function reject_scope_audit() returns trigger language plpgsql as $$ begin if new.kind='organization-operating-scope' then raise exception 'scope audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_scope_audit before insert on audit_events for each row execute function reject_scope_audit()");
      expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId: target.id })).status).toBe(500);
      expect((await h.request<AuthContext>("/api/v1/me")).body.user.organizationId).toBe(home.id);
      const before = await h.request<{ items: unknown[] }>("/api/v1/audit-events?kind=organization-operating-scope", "GET", undefined, token("target-admin", target.id));
      expect(before.body.items).toEqual([]);
      await h.db.query("drop trigger reject_scope_audit on audit_events");
      expect((await h.request("/api/v1/organization/operating-scope", "POST", { organizationId: target.id })).status).toBe(200);
    } finally { await h.close(); }
  });
});
