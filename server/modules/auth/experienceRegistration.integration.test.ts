import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "./baselineCatalog";
import { hashLocalAccountPassword } from "./localAccountCredentials";
import type { AuthContext } from "./types";
import { createLocalAuthService } from "./localAuth";
import { getAuthContext } from "./repository";

const path = "/api/v1/platform/experience-registration";
const account = { name: "Experience member", username: "experience.member", password: "Experience-test-2026" };
type Settings = { enabled: boolean; organizationId: string | null; organizationName: string | null; source: string; available: boolean };

describe("public experience admission through HTTP and PostgreSQL", () => {
  let db: InMemoryTestDatabase, token: string;
  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "experience-home", name: "Home" }, users: [{ id: "experience-platform" }, { id: "experience-admin" }] });
    await seedCoreGraph(db, { organization: { id: "experience-target", name: "Experience" } });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('experience-platform-role','experience-platform','experience-home','platform-admin'),('experience-admin-role','experience-admin','experience-home','admin')");
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values('experience-platform','experience-platform',$1),('experience-admin','experience-admin',$1)", [await hashLocalAccountPassword(account.password)]);
    token = (await request<{ token: string }>("/api/v1/auth/login", "POST", { username: "experience-platform", password: account.password })).body.token;
  });
  afterEach(async () => { await db?.rollback(); });
  function request<T>(url: string, method = "GET", body?: unknown, bearer = token, env: { AUTH_PROVIDER: "local" | "oidc"; AUTH_LOCAL_SELF_REGISTER?: boolean; AUTH_LOCAL_REGISTRATION_ORGANIZATION_ID?: string } = { AUTH_PROVIDER: "local" }) {
    return requestJson<T>(createWiseEffServer({ db, env, auth: { mode: "production" } }), url, { method, headers: { Authorization: `Bearer ${bearer ?? ""}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  it("requires an explicit experience entry, fixes admission to its target, and retains existing members and pending requests when disabled", async () => {
    expect((await request<{ selfRegisterEnabled: boolean }>("/api/v1/auth/local-config")).body.selfRegisterEnabled).toBe(false);
    expect((await request("/api/v1/auth/register", "POST", account)).status).toBe(403);
    const saved = await request<{ item: Settings }>(path, "PATCH", { enabled: true, organizationId: "experience-target" });
    expect(saved.status).toBe(200);
    expect(saved.body.item).toMatchObject({ enabled: true, organizationId: "experience-target", organizationName: "Experience", source: "platform", available: true });
    expect((await request("/api/v1/auth/register", "POST", { ...account, roleId: "platform-admin" })).status).toBe(400);
    const joined = await request<{ auth: AuthContext }>("/api/v1/auth/register", "POST", { ...account, organization: "experience-home", roleId: "software-user" });
    expect(joined.status).toBe(201); expect(joined.body.auth.organization.id).toBe("experience-target");
    const pending = await request<{ user: { id: string }; status: string }>("/api/v1/auth/register", "POST", { ...account, username: "experience.pending", roleId: "software-committer" });
    expect(pending.status).toBe(202);
    expect((await request(path, "PATCH", { enabled: false, organizationId: "experience-target" })).status).toBe(200);
    expect((await request("/api/v1/auth/register", "POST", { ...account, username: "experience.closed" })).status).toBe(403);
    expect((await request("/api/v1/auth/login", "POST", { username: account.username, password: account.password })).status).toBe(200);
    const requests = await request<{ items: Array<{ userId: string; status: string }> }>("/api/v1/users/registration-role-requests?organizationId=experience-target");
    expect(requests.status).toBe(200); expect(requests.body.items).toEqual([expect.objectContaining({ userId: pending.body.user.id, status: "pending" })]);
    const audits = await db.query("select actor_user_id, organization_id, metadata from audit_events where kind='experience-registration'");
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows).toEqual(expect.arrayContaining([expect.objectContaining({ actor_user_id: "experience-platform", organization_id: null, metadata: expect.objectContaining({ organizationId: "experience-target", enabled: false }) })]));
  });

  it("limits configuration to platform administrators, rejects unavailable targets, and leaves configuration unchanged on audit failure", async () => {
    const admin = (await request<{ token: string }>("/api/v1/auth/login", "POST", { username: "experience-admin", password: account.password })).body.token;
    for (const method of ["GET", "PATCH"]) expect((await request(path, method, method === "PATCH" ? { enabled: true, organizationId: "experience-target" } : undefined, admin)).status).toBe(403);
    await seedCoreGraph(db, { organization: { id: "org-hardware-department", name: "硬件部" } });
    for (const organizationId of [null, "missing-organization", "org-hardware-department"]) {
      expect((await request(path, "PATCH", { enabled: true, organizationId })).status).toBe(403);
    }
    expect((await request(path, "PATCH", { enabled: true, organizationId: "experience-target", roleId: "platform-admin" })).status).toBe(400);
    await db.query(`create function public.reject_experience_audit() returns trigger language plpgsql as $$ begin
      if new.kind='experience-registration' then raise exception 'Test audit failure'; end if; return new; end; $$;
      create trigger reject_experience_audit before insert on audit_events for each row execute function public.reject_experience_audit()`);
    expect((await request(path, "PATCH", { enabled: true, organizationId: "experience-target" })).status).toBe(500);
    expect((await request<{ item: Settings }>(path)).body.item).toMatchObject({ enabled: false, source: "default" });
  });

  it("keeps explicit legacy experience registration on ChargeLab only and allows platform settings to override the environment", async () => {
    const env = { AUTH_PROVIDER: "local" as const, AUTH_LOCAL_SELF_REGISTER: true };
    expect((await request<{ item: Settings }>(path, "GET", undefined, token, env)).body.item).toMatchObject({ enabled: true, organizationId: "org-chargelab", available: false, source: "environment" });
    expect((await request("/api/v1/auth/register", "POST", account, token, env)).status).toBe(403);
    await seedCoreGraph(db, { organization: { id: "org-chargelab", name: "ChargeLab" } });
    expect((await request<{ auth: AuthContext }>("/api/v1/auth/register", "POST", account, token, env)).body.auth.organization.id).toBe("org-chargelab");
    expect((await request(path, "PATCH", { enabled: false, organizationId: "experience-target" })).status).toBe(200);
    expect((await request<{ selfRegisterEnabled: boolean }>("/api/v1/auth/local-config", "GET", undefined, token, env)).body.selfRegisterEnabled).toBe(false);
    expect((await request("/api/v1/auth/register", "POST", { ...account, username: "legacy.closed" }, token, env)).status).toBe(403);
  });

  it("fails closed when the chosen organization disappears and never enables local signup under another provider", async () => {
    expect((await request(path, "PATCH", { enabled: true, organizationId: "experience-target" })).status).toBe(200);
    await db.query("delete from organizations where id='experience-target'");
    expect((await request<{ selfRegisterEnabled: boolean }>("/api/v1/auth/local-config")).body.selfRegisterEnabled).toBe(false);
    expect((await request("/api/v1/auth/register", "POST", account)).status).toBe(403);
    const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: "oidc" }, localAuthService: createLocalAuthService(db, { selfRegisterEnabled: true, registrationOrganizationId: "experience-home" }),
      auth: { mode: "production", verifier: { verify: async () => getAuthContext(db, "experience-platform") } } });
    const config = await requestJson<{ provider: string; selfRegisterEnabled: boolean }>(server, "/api/v1/auth/local-config");
    expect(config.body).toMatchObject({ provider: "oidc", selfRegisterEnabled: false });
    expect((await requestJson(server, path, { method: "PATCH", headers: { Authorization: "Bearer controlled-external-identity" }, body: JSON.stringify({ enabled: true, organizationId: "experience-home" }) })).status).toBe(403);
    expect((await requestJson(server, "/api/v1/auth/register", { method: "POST", body: JSON.stringify(account) })).status).toBe(404);
  });

  it("checks the current switch after waiting for a concurrent administrator update", async () => {
    const ephemeral = await createEphemeralTestDatabase("experience-admission"), concurrentDb = createPostgresDatabase(ephemeral.url);
    try {
      await seedCoreGraph(concurrentDb, { organization: { id: "experience-concurrent", name: "Concurrent target" } }); await seedBaselineAuthCatalog(concurrentDb);
      await concurrentDb.query("update public_experience_registration set enabled=true,organization_id='experience-concurrent' where singleton=true");
      let acquired!: () => void, release!: () => void;
      const locked = new Promise<void>((resolve) => { acquired = resolve; }), released = new Promise<void>((resolve) => { release = resolve; });
      const disabling = concurrentDb.transaction(async (tx) => {
        await tx.query("update public_experience_registration set enabled=false where singleton=true"); acquired(); await released;
      });
      await locked;
      const registration = requestJson(createWiseEffServer({ db: concurrentDb, env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: true }, auth: { mode: "production" } }), "/api/v1/auth/register", { method: "POST", body: JSON.stringify(account) });
      try {
        await vi.waitFor(async () => { expect((await concurrentDb.query("select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).rowCount).toBeGreaterThan(0); });
      } finally { release(); await disabling; }
      expect((await registration).status).toBe(403);
      expect((await concurrentDb.query("select id from users where organization_id='experience-concurrent'")).rowCount).toBe(0);
    } finally { await concurrentDb.close(); await ephemeral.drop(); }
  });
});
