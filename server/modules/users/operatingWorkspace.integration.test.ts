import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createInMemoryTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import type { AuthContext } from "../auth/types";
import type { UserGovernanceDto } from "./types";

const home = { id: "workspace-home", name: "Home organization" };
const target = { id: "workspace-target", name: "Target organization" };
const actor = (platform = true): AuthContext => ({ user: { id: platform ? "workspace-platform" : "workspace-admin", organizationId: home.id, name: "Real operator", title: "Administrator", isActive: true },
  organization: home, roles: [{ projectId: null, roleId: platform ? "platform-admin" : "admin" }], permissions: ["users:manage", "admin:access", ...(platform ? ["platform:access" as const] : [])] });

describe("fixed-target organization workspace through HTTP and PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createInMemoryTestDatabase>>;
  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: home, users: [{ id: "workspace-platform" }, { id: "workspace-admin" }], projects: [{ id: "workspace-home-project", name: "Home project" }] });
    await seedCoreGraph(db, { organization: target, users: [{ id: "workspace-target-admin" }], projects: [{ id: "workspace-target-project", name: "Target project" }] });
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('workspace-platform-role','workspace-platform',$1,'platform-admin'),('workspace-admin-role','workspace-admin',$1,'admin'),
      ('workspace-target-admin-role','workspace-target-admin',$2,'admin')`, [home.id, target.id]);
  });
  afterEach(async () => { await db?.rollback(); });
  function request<T>(path: string, method = "GET", body?: unknown, platform: boolean | AuthContext = true, oidc = false) {
    return requestJson<T>(createWiseEffServer({ db, env: oidc ? { AUTH_PROVIDER: "oidc", AUTH_OIDC_ISSUER: "https://workspace-identity.example" } : { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: { verify: async () => typeof platform === "boolean" ? actor(platform) : platform } } }), path,
      { method, headers: { Authorization: "Bearer fixture" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const scoped = (path: string) => `${path}?organizationId=${target.id}`;

  it("lists only the explicit target while keeping the authenticated actor's home unchanged", async () => {
    const result = await request<{ items: UserGovernanceDto[] }>(scoped("/api/v1/users"));
    expect(result.status).toBe(200);
    expect(result.body.items.map((user) => user.id)).toEqual(["workspace-target-admin"]);
    expect((await request<AuthContext>("/api/v1/me")).body.organization).toEqual(home);
    expect((await request(scoped("/api/v1/users"), "GET", undefined, false)).status).toBe(403);
  });

  it("reuses account, role, activation, password, deletion and organization settings operations inside one fixed target", async () => {
    const created = await request<{ item: UserGovernanceDto }>(scoped("/api/v1/users"), "POST", {
      name: "Target member", title: "Engineer", username: "workspace-member", password: "workspace-password", roles: [{ roleId: "software-user" }]
    });
    expect(created.status).toBe(201);
    expect(created.body.item.organizationId).toBe(target.id);
    const id = created.body.item.id, userPath = `/api/v1/users/${id}`;
    expect((await request<{ item: UserGovernanceDto }>(scoped(userPath), "PATCH", { name: "Renamed member", title: "" })).body.item).toMatchObject({ name: "Renamed member", title: "" });
    expect((await request(scoped(`${userPath}/organization-roles`), "PUT", { roles: ["hardware-user", "software-user"], expectedRoles: ["software-user"] })).status).toBe(200);
    expect((await request(scoped(`${userPath}/roles`), "PUT", { roles: [{ roleId: "software-user" }] })).status).toBe(200);
    expect((await request(scoped(`${userPath}/password`), "POST", { password: "replacement-password" })).status).toBe(200);
    expect((await request(scoped(`${userPath}/activation`), "PATCH", { isActive: false })).status).toBe(200);
    expect((await request(scoped(`${userPath}/activation`), "PATCH", { isActive: true })).status).toBe(200);
    expect((await request(`${userPath}?organizationId=${home.id}`, "PATCH", { name: "Wrong target" })).status).toBe(404);
    expect((await request(scoped("/api/v1/organization"), "PATCH", { name: "Renamed target" })).status).toBe(200);
    expect((await request<{ organization: { id: string; name: string } }>(scoped("/api/v1/organization"))).body.organization).toMatchObject({ id: target.id, name: "Renamed target" });
    expect((await request<AuthContext>("/api/v1/me")).body.organization).toEqual(home);
    expect((await request(scoped(userPath), "DELETE")).status).toBe(204);
    expect((await request<{ items: UserGovernanceDto[] }>(scoped("/api/v1/users"))).body.items.map((user) => user.id)).toEqual(["workspace-target-admin"]);
    const audit = await request<{ items: Array<{ actorUserId: string; organizationId: string; metadata: Record<string, unknown> }> }>("/api/v1/audit-events", "GET", undefined,
      { ...actor(false), user: { ...actor(false).user, id: "workspace-target-admin", organizationId: target.id }, organization: target });
    expect(audit.body.items.length).toBeGreaterThanOrEqual(9);
    expect(audit.body.items.every((event) => event.actorUserId === "workspace-platform" && event.organizationId === target.id && event.metadata.actorHomeOrganizationId === home.id && event.metadata.operatingOrganizationId === target.id)).toBe(true);
  });

  it("lists target project candidates and changes review duties without borrowing the actor's home projects", async () => {
    const candidates = await request<{ items: Array<{ id: string; name: string }> }>(scoped("/api/v1/organization/project-candidates"));
    expect(candidates.status).toBe(200);
    expect(candidates.body.items).toEqual([{ id: "workspace-target-project", name: "Target project" }]);
    const path = "/api/v1/projects/workspace-target-project/workflow-role-bindings";
    expect((await request(scoped(`${path}/workspace-target-admin`), "PUT", { roles: ["software-committer"], expectedRoles: [] })).status).toBe(200);
    expect((await request<{ bindings: Array<{ userId: string; roles: string[] }> }>(scoped(path))).body.bindings).toEqual([expect.objectContaining({ userId: "workspace-target-admin", roles: ["software-committer"] })]);
    expect((await request(scoped("/api/v1/projects/workspace-home-project/workflow-role-bindings"))).status).toBe(404);
    expect((await request(scoped(`${path}/workspace-admin`), "PUT", { roles: ["software-committer"], expectedRoles: [] })).status).toBe(404);
  });

  it("keeps registration queues and every decision inside the selected target", async () => {
    await seedCoreGraph(db, { organization: home, users: [{ id: "workspace-home-applicant", isActive: false }] });
    await seedCoreGraph(db, { organization: target, users: [{ id: "workspace-target-applicant", isActive: false }] });
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('workspace-home-applicant-role','workspace-home-applicant',$1,'hardware-user'),
      ('workspace-target-applicant-role','workspace-target-applicant',$2,'hardware-user')`, [home.id, target.id]);
    await db.query(`insert into local_registration_role_requests(id,organization_id,user_id,current_role_id,requested_role_id,status) values
      ('workspace-home-request',$1,'workspace-home-applicant','hardware-user','hardware-committer','pending'),
      ('workspace-target-request',$2,'workspace-target-applicant','hardware-user','hardware-committer','pending')`, [home.id, target.id]);
    const queue = await request<{ items: Array<{ id: string }> }>(scoped("/api/v1/users/registration-role-requests"));
    expect(queue.body.items.map((item) => item.id)).toEqual(["workspace-target-request"]);
    for (const decision of ["approve", "enable-basic", "reject"]) {
      expect((await request(scoped(`/api/v1/users/registration-role-requests/workspace-home-request/${decision}`), "POST", {})).status).toBe(404);
    }
    expect((await request(scoped("/api/v1/users/registration-role-requests/workspace-target-request/approve"), "POST", {})).status).toBe(200);
    expect((await request<{ items: UserGovernanceDto[] }>(scoped("/api/v1/users"))).body.items.find((user) => user.id === "workspace-target-applicant")).toMatchObject({ isActive: true, roles: [{ projectId: null, roleId: "hardware-committer" }] });
    expect((await request<{ items: Array<{ id: string }> }>("/api/v1/users/registration-role-requests")).body.items.map((item) => item.id)).toEqual(["workspace-home-request"]);
  });

  it("binds and changes an OIDC member inside the target with stale and foreign resource checks", async () => {
    const issuer = "https://workspace-identity.example";
    const created = await request<{ item: UserGovernanceDto }>(scoped("/api/v1/users"), "POST", { authentication: "oidc", issuer, subject: "target-subject", name: "OIDC target", roles: [{ roleId: "software-user" }] }, true, true);
    expect(created.status).toBe(201);
    const id = created.body.item.id, path = scoped(`/api/v1/users/${id}/oidc-identity`);
    expect(created.body.item).toMatchObject({ organizationId: target.id, oidcIdentity: { issuer, subject: "target-subject" } });
    const changed = await request<{ item: UserGovernanceDto }>(path, "PUT", { issuer, subject: "changed-target-subject", expectedIdentity: { issuer, subject: "target-subject" } }, true, true);
    expect(changed.status).toBe(200);
    expect(changed.body.item.oidcIdentity?.subject).toBe("changed-target-subject");
    expect((await request(path, "PUT", { issuer, subject: "stale", expectedIdentity: { issuer, subject: "target-subject" } }, true, true)).status).toBe(409);
    expect((await request(scoped("/api/v1/users/workspace-admin/oidc-identity"), "PUT", { issuer, subject: "foreign", expectedIdentity: null }, true, true)).status).toBe(404);
  });

  it("rejects an ordinary administrator at every cross-organization governance entry and validates target identifiers", async () => {
    const operations: Array<[string, string, unknown?]> = [
      ["/api/v1/organization", "GET"], ["/api/v1/organization", "PATCH", { name: "Forbidden name" }], ["/api/v1/organization/project-candidates", "GET"],
      ["/api/v1/users", "GET"], ["/api/v1/users", "POST", { name: "Forbidden member", username: "forbidden-member", password: "forbidden-password", roles: [{ roleId: "software-user" }] }],
      ["/api/v1/users/workspace-target-admin", "PATCH", { name: "Forbidden rename" }], ["/api/v1/users/workspace-target-admin", "DELETE"],
      ["/api/v1/users/workspace-target-admin/activation", "PATCH", { isActive: false }], ["/api/v1/users/workspace-target-admin/password", "POST", { password: "forbidden-password" }],
      ["/api/v1/users/workspace-target-admin/roles", "PUT", { roles: [{ roleId: "software-user" }] }], ["/api/v1/users/workspace-target-admin/organization-roles", "PUT", { roles: [], expectedRoles: ["admin"] }],
      ["/api/v1/users/workspace-target-admin/oidc-identity", "PUT", { issuer: "https://workspace-identity.example", subject: "forbidden", expectedIdentity: null }],
      ["/api/v1/users/registration-role-requests", "GET"], ...["approve", "enable-basic", "reject"].map((decision): [string, string, unknown] => [`/api/v1/users/registration-role-requests/unknown/${decision}`, "POST", {}]),
      ["/api/v1/projects/workspace-target-project/workflow-role-bindings", "GET"], ["/api/v1/projects/workspace-target-project/workflow-role-bindings/workspace-target-admin", "PUT", { roles: [], expectedRoles: [] }]
    ];
    for (const [path, method, body] of operations) expect((await request(scoped(path), method, body, false)).status, `${method} ${path}`).toBe(403);
    expect((await request("/api/v1/users?organizationId=missing")).status).toBe(404);
    expect((await request(`/api/v1/users?organizationId=${target.id}&organizationId=${home.id}`)).status).toBe(400);
    expect((await request("/api/v1/users?organizationId=%20")).status).toBe(400);
    await db.query("update user_role_bindings set role_id='admin' where user_id='workspace-platform'");
    expect((await request(scoped("/api/v1/users"))).status).toBe(403);
  });
});
