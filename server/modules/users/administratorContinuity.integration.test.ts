import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import type { AuthContext } from "../auth/types";
import type { UserGovernanceDto } from "./types";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";

const organization = { id: "succession-home", name: "Succession" };
const other = { id: "succession-other", name: "Other" };
const auth = (id: string, platform = false, home = organization): AuthContext => ({
  user: { id, organizationId: home.id, name: id, title: "Administrator", isActive: true }, organization: home,
  roles: [{ projectId: null, roleId: platform ? "platform-admin" : "admin" }], permissions: ["users:manage", "admin:access", ...(platform ? ["platform:access" as const] : [])]
});

describe("administrator succession through real HTTP and PostgreSQL", () => {
  let db: RootDatabase;
  let ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("succession"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization, users: [{ id: "successor-admin" }, { id: "successor-platform" }, { id: "successor-member" }] });
    await seedCoreGraph(db, { organization: other, users: [{ id: "other-platform" }, { id: "other-admin" }] });
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('successor-admin-role','successor-admin',$1,'admin'), ('successor-platform-role','successor-platform',$1,'platform-admin'),
      ('successor-member-role','successor-member',$1,'software-user'), ('other-platform-role','other-platform',$2,'platform-admin'),
      ('other-admin-role','other-admin',$2,'admin')`, [organization.id, other.id]);
  });
  afterEach(async () => { try { await db?.close(); } finally { await ephemeral?.drop(); } });
  function request<T = { error: { message: string; details: { code: string } }; item: UserGovernanceDto }>(path: string, method = "GET", body?: unknown, actor = auth("successor-platform", true)) {
    return requestJson<T>(createWiseEffServer({ db, env: { AUTH_PROVIDER: "hmac" }, auth: { mode: "production", verifier: { verify: async () => actor } } }), path,
      { method, headers: { Authorization: "Bearer fixture" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function users() { return (await request<{ items: UserGovernanceDto[] }>("/api/v1/users")).body.items; }

  it("protects the last organization administrator across role, activation and deletion entry points independently of platform authority", async () => {
    const outcomes = [
      await request("/api/v1/users/successor-admin/organization-roles", "PUT", { roles: ["software-user"], expectedRoles: ["admin"] }),
      await request("/api/v1/users/successor-admin/roles", "PUT", { roles: [{ roleId: "software-user" }] }),
      await request("/api/v1/users/successor-admin/activation", "PATCH", { isActive: false }),
      await request("/api/v1/users/successor-admin", "DELETE")
    ];
    expect(outcomes.map((result) => result.status)).toEqual([409, 409, 409, 409]);
    expect((await users()).find((user) => user.id === "successor-admin")).toMatchObject({ isActive: true, roles: [{ projectId: null, roleId: "admin" }] });
  });

  it("lets a platform administrator explicitly disable the last organization administrator and appoint a successor with accountable target-scoped audit", async () => {
    const platform = auth("other-platform", true, other), base = `/api/v1/platform/organizations/${organization.id}`;
    const disabled = await request(`${base}/administrators/successor-admin/emergency-disable`, "POST", { reason: "Departed without handover" }, platform);
    expect(disabled.status).toBe(200);
    expect((await users()).find((user) => user.id === "successor-admin")?.isActive).toBe(false);
    const recovery = await request(`${base}/administrator-recovery`, "POST", { userId: "successor-member" }, platform);
    expect(recovery.status).toBe(200);
    expect((await users()).find((user) => user.id === "successor-member")).toMatchObject({ isActive: true, roles: expect.arrayContaining([{ projectId: null, roleId: "admin" }, { projectId: null, roleId: "software-user" }]) });
    const audit = await request<{ items: Array<{ actorUserId: string; organizationId: string; kind: string; metadata: Record<string, unknown> }> }>("/api/v1/audit-events");
    expect(audit.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorUserId: platform.user.id, organizationId: organization.id, kind: "organization-administrator-emergency-disable", metadata: expect.objectContaining({ reason: "Departed without handover", actorHomeOrganizationId: other.id }) }),
      expect.objectContaining({ actorUserId: platform.user.id, organizationId: organization.id, kind: "organization-administrator-recovery" })
    ]));
    expect((await request(`${base}/administrator-recovery`, "POST", { userId: "other-admin" }, platform)).status).toBe(404);
    expect((await request(`${base}/administrator-recovery`, "POST", { userId: "successor-member" }, auth("successor-admin"))).status).toBe(403);
  });

  it("recovers an organization with no remaining members by creating a usable new administrator", async () => {
    await db.query("insert into organizations(id,name) values('succession-empty','Empty organization')");
    const result = await request<{ item: { administrators: Array<{ id: string; name: string }> } }>("/api/v1/platform/organizations/succession-empty/administrator-recovery", "POST", {
      administrator: { name: "Replacement administrator", username: "replacement-admin", password: "replacement-password" }
    });
    expect(result.status).toBe(200);
    expect(result.body.item.administrators).toEqual([expect.objectContaining({ name: "Replacement administrator" })]);
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" } });
    const login = await requestJson<{ auth: AuthContext }>(server, "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: "replacement-admin", password: "replacement-password" }) });
    expect(login.status).toBe(200);
    expect(login.body.auth.organization.id).toBe("succession-empty");
    expect(login.body.auth.roles).toEqual([{ projectId: null, roleId: "admin" }]);
  });

  it.each(["demote", "disable", "delete"])("retains one organization administrator when two administrators concurrently %s each other", async (operation) => {
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('second-admin-role','successor-member',$1,'admin')", [organization.id]);
    const mutate = (target: string, actor: string) => operation === "demote"
      ? request(`/api/v1/users/${target}/roles`, "PUT", { roles: [{ roleId: "software-user" }] }, auth(actor))
      : operation === "disable" ? request(`/api/v1/users/${target}/activation`, "PATCH", { isActive: false }, auth(actor))
        : request(`/api/v1/users/${target}`, "DELETE", undefined, auth(actor));
    const results = await Promise.all([mutate("successor-admin", "successor-member"), mutate("successor-member", "successor-admin")]);
    expect(results.map((result) => result.status).sort()).toEqual(operation === "delete" ? [204, 409] : [200, 409]);
    expect((await users()).filter((user) => user.isActive && user.roles.some((role) => role.projectId === null && role.roleId === "admin"))).toHaveLength(1);
  });

  it.each(["demote", "disable", "delete"])("separately preserves one global platform administrator across organizations during concurrent %s", async (operation) => {
    const mutate = (id: string, actor: AuthContext) => operation === "demote" ? request(`/api/v1/users/${id}/organization-roles`, "PUT", { roles: ["software-user"], expectedRoles: ["platform-admin"] }, actor)
      : operation === "disable" ? request(`/api/v1/users/${id}/activation`, "PATCH", { isActive: false }, actor) : request(`/api/v1/users/${id}`, "DELETE", undefined, actor);
    const results = await Promise.all([
      mutate("successor-platform", auth("successor-platform", true)), mutate("other-platform", auth("other-platform", true, other))
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(operation === "delete" ? [204, 409] : [200, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.details.code).toBe("last-platform-administrator");
  });

  it("permits normal self succession once another effective administrator exists and immediately stops authorizing the former administrator", async () => {
    expect((await request("/api/v1/users/successor-member/organization-roles", "PUT", { roles: ["admin"], expectedRoles: ["software-user"] }, auth("successor-admin"))).status).toBe(200);
    expect((await request("/api/v1/users/successor-admin/organization-roles", "PUT", { roles: ["software-user"], expectedRoles: ["admin"] }, auth("successor-admin"))).status).toBe(200);
    expect((await request("/api/v1/users/successor-member/activation", "PATCH", { isActive: false }, auth("successor-admin"))).status).toBe(403);
  });

  it("does not exempt emergency actions from the global platform invariant or from atomic audit storage", async () => {
    const base = `/api/v1/platform/organizations/${organization.id}`;
    expect((await request(`${base}/administrators/successor-admin/emergency-disable`, "POST", { reason: " " })).status).toBe(400);
    expect((await request(`${base}/administrators/successor-admin/emergency-disable`, "POST", { reason: "Departure" }, auth("successor-admin"))).status).toBe(403);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('platform-is-admin','successor-platform',$1,'admin')", [organization.id]);
    await db.query("update users set is_active=false where id='other-platform'");
    const refused = await request(`${base}/administrators/successor-platform/emergency-disable`, "POST", { reason: "Departure" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.code).toBe("last-platform-administrator");
    await db.query("create function reject_succession_audit() returns trigger language plpgsql as $$ begin if new.kind like 'organization-administrator-%' then raise exception 'audit unavailable'; end if; return new; end $$");
    await db.query("create trigger reject_succession_audit before insert on audit_events for each row execute function reject_succession_audit()");
    expect((await request(`${base}/administrators/successor-admin/emergency-disable`, "POST", { reason: "Departure" })).status).toBe(500);
    expect((await users()).find((user) => user.id === "successor-admin")?.isActive).toBe(true);
    expect((await request(`${base}/administrator-recovery`, "POST", { userId: "successor-member" })).status).toBe(500);
    expect((await users()).find((user) => user.id === "successor-member")?.roles).toEqual([{ projectId: null, roleId: "software-user" }]);
  });

  it("counts login-capable administrators for the configured local provider without treating unbound accounts as successors", async () => {
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('unusable-admin','successor-member',$1,'admin')", [organization.id]);
    const hash = await hashLocalAccountPassword("fixture-password");
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values('successor-admin','usable-admin',$1),('successor-platform','usable-platform',$1)", [hash]);
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" } });
    const token = (await requestJson<{ token: string }>(server, "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: "usable-platform", password: "fixture-password" }) })).body.token;
    const directory = await requestJson<{ item: { administrators: Array<{ id: string; canLogin: boolean }> } }>(server, `/api/v1/platform/organizations/${organization.id}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(directory.body.item.administrators).toEqual([
      expect.objectContaining({ id: "successor-admin", canLogin: true }), expect.objectContaining({ id: "successor-member", canLogin: false })
    ]);
    for (const userId of ["successor-admin", "successor-platform"]) {
      const result = await requestJson(server, `/api/v1/users/${userId}/activation`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ isActive: false }) });
      expect(result.status).toBe(409);
    }
  });

  it("preserves development authentication without requiring a local password for its existing administrative identity", async () => {
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" }, auth: { mode: "development" } });
    const call = (path: string, body: unknown, method = "PATCH") => requestJson(server, path, { method, headers: { "x-wiseeff-user": "successor-admin" }, body: JSON.stringify(body) });
    expect((await call("/api/v1/users/successor-admin/activation", { isActive: false })).status).toBe(409);
    expect((await call("/api/v1/users/successor-member/organization-roles", { roles: ["admin"], expectedRoles: ["software-user"] }, "PUT")).status).toBe(200);
    expect((await call("/api/v1/users/successor-admin/activation", { isActive: false })).status).toBe(200);
  });
});
