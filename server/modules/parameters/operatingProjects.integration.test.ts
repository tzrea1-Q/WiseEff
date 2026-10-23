import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createTokenVerifier } from "../auth/tokenVerifier";
import type { AuthContext } from "../auth/types";

const available = await isTestDatabaseAvailable();
const home = "project-scope-home", target = "project-scope-target", secret = "project-scope-test-only";
function token(userId: string, organizationId = home) {
  const payload = Buffer.from(JSON.stringify({ iss: "project-scope", sub: userId, org: organizationId, exp: 9_999_999_999 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

async function fixture() {
  const db = await createInMemoryTestDatabase();
  await seedCoreGraph(db, { organization: { id: home, name: "Home" }, users: [{ id: "scope-platform" }, { id: "scope-admin" }], projects: [{ id: "home-project" }] });
  await seedCoreGraph(db, { organization: { id: target, name: "Target" }, users: [{ id: "target-admin" }], projects: [{ id: "target-project" }] });
  await seedBaselineAuthCatalog(db);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
    ('platform-role','scope-platform',$1,'platform-admin'),('admin-role','scope-admin',$1,'admin'),('target-role','target-admin',$2,'admin')`, [home, target]);
  const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: createTokenVerifier({ issuer: "project-scope", secret }) } });
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = token("scope-platform")) => requestJson<T>(server, path, {
    method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { db, request, close: () => db.rollback() };
}

describe.skipIf(!available)("Operating Organization projects over real HTTP and PostgreSQL", () => {
  it("creates the project and default configuration in the target and audits the real Home actor", async () => {
    const h = await fixture();
    try {
      const response = await h.request<{ item: { id: string } }>(`/api/v1/parameters/admin/projects?organizationId=${target}`, "POST", { id: "scoped-project", name: "Scoped project", code: "SCOPE" });
      expect(response.status).toBe(201);
      const projects = await h.request<{ items: Array<{ id: string }> }>(`/api/v1/projects?organizationId=${target}`);
      expect(projects.status).toBe(200);
      expect(projects.body.items.map((item) => item.id)).toEqual(expect.arrayContaining(["scoped-project", "target-project"]));
      expect(projects.body.items.map((item) => item.id)).not.toContain("home-project");
      const config = await h.request<{ items: Array<{ name: string }> }>(`/api/v1/projects/scoped-project/config-sets?organizationId=${target}`);
      expect(config.status).toBe(200);
      expect(config.body.items).toEqual([expect.objectContaining({ name: "default" })]);
      expect((await h.db.query("select organization_id from projects where id='scoped-project'")).rows).toEqual([{ organization_id: target }]);
      const audits = await h.request<{ items: Array<{ actorUserId: string; organizationId: string; targetId: string; metadata: Record<string, unknown> }> }>("/api/v1/audit-events?kind=project-created", "GET", undefined, token("target-admin", target));
      expect(audits.body.items).toContainEqual(expect.objectContaining({ actorUserId: "scope-platform", organizationId: target, targetId: "scoped-project", metadata: expect.objectContaining({ actorHomeOrganizationId: home, operatingOrganizationId: target }) }));
      expect((await h.request<AuthContext>("/api/v1/me")).body.user.organizationId).toBe(home);
    } finally { await h.close(); }
  });
  it("creates target configuration sets without granting an ordinary administrator cross-Organization access", async () => {
    const h = await fixture();
    try {
      const route = `/api/v1/projects/target-project/config-sets?organizationId=${target}`;
      expect((await h.request(route, "POST", { name: "Foreign attempt" }, token("scope-admin"))).status).toBe(403);
      const created = await h.request<{ item: { id: string; name: string } }>(route, "POST", { name: "Release" });
      expect(created.status).toBe(201);
      expect((await h.request<{ items: Array<{ name: string }> }>(route)).body.items).toContainEqual(expect.objectContaining({ name: "Release" }));
      expect((await h.db.query("select organization_id from dts_config_set where id=$1", [created.body.item.id])).rows).toEqual([{ organization_id: target }]);
    } finally { await h.close(); }
  });
});
