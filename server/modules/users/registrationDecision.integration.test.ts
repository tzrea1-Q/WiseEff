import { afterAll, beforeAll, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createDatabase, createPostgresDatabase } from "../../shared/database/client";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "../../shared/database/migrations";
import { deactivateUser, listRegistrationRoleRequests } from "./service";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { requestJson } from "../../test/testClient";
import type { AuthContext } from "../auth/types";
import type { RegistrationRoleRequestDto, UserGovernanceDto } from "./types";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";

let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: ReturnType<typeof createPostgresDatabase>;
let adminToken: string, adminId: string;
const password = "registration-test-password";
const server = () => createWiseEffServer({ db, env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: true }, auth: { mode: "production" } });
const request = <T = unknown>(path: string, method = "GET", body?: unknown, token = adminToken) => requestJson<T>(server(), path, {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
beforeAll(async () => {
  database = await createEphemeralTestDatabase("registration-decision"); db = createPostgresDatabase(database.url);
  await seedCoreGraph(db, { organization: { id: "org-chargelab", name: "Registration organization" } });
  await seedBaselineAuthCatalog(db);
  const created = await request<{ token: string; auth: AuthContext }>("/api/v1/auth/register", "POST", { username: "registration.admin", name: "Registration admin", password, roleId: "software-user" }, "");
  expect(created.status, created.bodyText).toBe(201); adminToken = created.body.token; adminId = created.body.auth.user.id;
  await db.query("update user_role_bindings set role_id='admin' where user_id=$1 and project_id is null", [adminId]);
});
afterAll(async () => { await db?.close(); await database?.drop(); });
async function register(name: string, requestedRoleId = "software-committer") {
  const username = `registration.${name}`;
  const response = await request("/api/v1/auth/register", "POST", { username, name, password, roleId: requestedRoleId }, ""); expect(response.status, response.bodyText).toBe(202);
  const pending = await request<{ items: RegistrationRoleRequestDto[] }>("/api/v1/users/registration-role-requests"); expect(pending.status).toBe(200);
  const item = pending.body.items.find(item => item.username === username)!; expect(item).toBeDefined();
  return { item, username, path: `/api/v1/users/registration-role-requests/${item.id}` };
}
const login = (username: string) => request<{ token: string; auth: AuthContext }>("/api/v1/auth/login", "POST", { username, password }, "");
async function member(userId: string) {
  const result = await request<{ items: UserGovernanceDto[] }>("/api/v1/users"); expect(result.status).toBe(200);
  return result.body.items.find(item => item.id === userId)!;
}
async function history(id: string) {
  const result = await request<{ items: RegistrationRoleRequestDto[] }>("/api/v1/users/registration-role-requests?status=decided"); expect(result.status).toBe(200);
  return result.body.items.find(item => item.id === id)!;
}

it("rejects the requested promotion while admitting the applicant with its corresponding ordinary role and real login", async () => {
  const h = await register("basic-software"); expect(h.item.currentRoleId).toBe("software-user");
  expect((await login(h.username)).status).toBe(403);
  const decided = await request<{ item: RegistrationRoleRequestDto }>(`${h.path}/enable-basic`, "POST", {});
  expect(decided.status, decided.bodyText).toBe(200);
  expect(decided.body.item).toMatchObject({ id: h.item.id, status: "rejected", decisionOutcome: "basic-enabled", decisionCanLogin: true, decisionRoleIds: ["software-user"] });
  const signedIn = await login(h.username); expect(signedIn.status, signedIn.bodyText).toBe(200);
  expect(signedIn.body.auth.roles).toEqual([{ projectId: null, roleId: "software-user" }]);
  expect(signedIn.body.auth.permissions).not.toContain("users:manage");
  const me = await request<AuthContext>("/api/v1/me", "GET", undefined, signedIn.body.token); expect(me.status).toBe(200); expect(me.body.user.isActive).toBe(true); expect(me.body.roles).toEqual(signedIn.body.auth.roles);
  const notifications = await request<{ items: Array<{ body: string; metadata: { requestId?: string } }> }>("/api/v1/notifications", "GET", undefined, signedIn.body.token);
  expect(notifications.status).toBe(200); expect(notifications.body.items.find(item => item.metadata.requestId === h.item.id)?.body).toMatch(/软件开发.*可登录/);
  const audits = await db.query<{ actor_user_id: string; action: string }>("select actor_user_id,action from audit_events where kind='registration-role-request' and metadata->>'requestId'=$1", [h.item.id]);
  expect(audits.rows).toEqual([{ actor_user_id: adminId, action: "enable-basic" }]);
});

it("records all three outcomes with the actual role, notification and ability to sign in", async () => {
  for (const [name, requested, action, outcome, role, active] of [
    ["basic-hardware", "hardware-committer", "enable-basic", "basic-enabled", "hardware-user", true],
    ["approved-hardware", "hardware-committer", "approve", "requested-role-enabled", "hardware-committer", true],
    ["rejected-software", "software-committer", "reject", "rejected-disabled", "software-user", false]
  ] as const) {
    const h = await register(name, requested);
    const result = await request<{ item: RegistrationRoleRequestDto }>(`${h.path}/${action}`, "POST", {}); expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item).toMatchObject({ status: action === "approve" ? "approved" : "rejected", decisionOutcome: outcome, decisionCanLogin: active, decisionRoleIds: [role] });
    const actual = await member(h.item.userId); expect(actual.isActive).toBe(active); expect(actual.roles).toEqual([{ projectId: null, roleId: role }]);
    const signedIn = await login(h.username); expect(signedIn.status, signedIn.bodyText).toBe(active ? 200 : 403);
    if (active) { expect(signedIn.body.auth.roles).toEqual(actual.roles); expect(signedIn.body.auth.permissions.includes("parameter:review")).toBe(action === "approve"); }
    const notices = await request<{ items: Array<{ metadata: unknown; body: string }> }>("/api/v1/notifications");
    const notice = notices.body.items.find(item => (item.metadata as { requestId?: string }).requestId === h.item.id)!;
    expect(notice.metadata).toMatchObject({ outcome, canLogin: active, roles: [role] }); expect(notice.body).toContain(active ? "可登录" : "不可登录");
    expect(await history(h.item.id)).toEqual(result.body.item);
  }
});

it("keeps the original permission, organization and disabled-self-registration boundaries", async () => {
  const h = await register("scope-target");
  const ordinary = await request<{ token: string }>("/api/v1/auth/register", "POST", { username: "registration.ordinary", name: "Ordinary", password, roleId: "hardware-user" }, ""); expect(ordinary.status).toBe(201);
  for (const action of ["approve", "enable-basic", "reject"]) expect((await request(`${h.path}/${action}`, "POST", {}, ordinary.body.token)).status).toBe(403);
  await seedCoreGraph(db, { organization: { id: "registration-other", name: "Other organization" }, users: [{ id: "registration-other-admin" }] });
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values('registration-other-role','registration-other-admin','registration-other',null,'admin')");
  await db.query("insert into user_password_credentials(user_id,username,password_hash) select 'registration-other-admin','registration.other.admin',password_hash from user_password_credentials where user_id=$1", [adminId]);
  const foreign = await login("registration.other.admin"); expect(foreign.status).toBe(200);
  for (const action of ["approve", "enable-basic", "reject"]) expect((await request(`${h.path}/${action}`, "POST", {}, foreign.body.token)).status).toBe(404);
  expect((await member(h.item.userId)).isActive).toBe(false);
  const closed = createWiseEffServer({ db, env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: false }, auth: { mode: "production" } });
  const disabled = await requestJson(closed, "/api/v1/auth/register", { method: "POST", body: JSON.stringify({ username: "registration.disabled", name: "Disabled", password, roleId: "software-user" }) }); expect(disabled.status).toBe(403);
  expect((await db.query("select user_id from user_password_credentials where username='registration.disabled'")).rows).toHaveLength(0);
});

it("refuses stale enabling decisions and can close an obsolete request while preserving newer account settings", async () => {
  const disabled = await register("stale-disabled");
  expect((await request(`/api/v1/users/${disabled.item.userId}/activation`, "PATCH", { isActive: false })).status).toBe(200);
  for (const action of ["approve", "enable-basic"]) {
    const blocked = await request<{ error: { details: { code: string } } }>(`${disabled.path}/${action}`, "POST", {}); expect(blocked.status).toBe(409); expect(blocked.body.error.details.code).toBe("registration-account-changed");
  }
  const closed = await request<{ item: RegistrationRoleRequestDto }>(`${disabled.path}/reject`, "POST", {}); expect(closed.status).toBe(200);
  expect(closed.body.item).toMatchObject({ decisionOutcome: "rejected-preserved", decisionCanLogin: false, decisionRoleIds: ["software-user"] });
  const changed = await register("stale-role");
  expect((await request(`/api/v1/users/${changed.item.userId}/organization-roles`, "PUT", { roles: ["hardware-user"], expectedRoles: ["software-user"] })).status).toBe(200);
  expect((await request(`/api/v1/users/${changed.item.userId}/activation`, "PATCH", { isActive: true })).status).toBe(200);
  expect((await request(`${changed.path}/enable-basic`, "POST", {})).status).toBe(409);
  const preserved = await request<{ item: RegistrationRoleRequestDto }>(`${changed.path}/reject`, "POST", {}); expect(preserved.status).toBe(200);
  expect(preserved.body.item).toMatchObject({ decisionOutcome: "rejected-preserved", decisionCanLogin: true, decisionRoleIds: ["hardware-user"] });
  expect((await login(changed.username)).body.auth.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
  expect((await request(`/api/v1/users/${changed.item.userId}/activation`, "PATCH", { isActive: false })).status).toBe(200);
  expect((await request(`/api/v1/users/${changed.item.userId}/organization-roles`, "PUT", { roles: ["software-user"], expectedRoles: ["hardware-user"] })).status).toBe(200);
  expect(await history(changed.item.id)).toEqual(preserved.body.item);
});

it("leaves profile changes, login timestamps and project duties independent from the pending decision", async () => {
  const h = await register("independent-fields");
  expect((await request(`/api/v1/users/${h.item.userId}`, "PATCH", { name: "Updated applicant", title: "Updated title" })).status).toBe(200);
  await db.query("update users set last_active_at=now() where id=$1", [h.item.userId]);
  await db.query("insert into projects(id,organization_id,name,code,status) values('registration-project','org-chargelab','Project duties','REG','active')");
  await db.query("insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values('registration-project-role',$1,'org-chargelab','registration-project','hardware-committer')", [h.item.userId]);
  expect((await request(`${h.path}/enable-basic`, "POST", {})).status).toBe(200);
  expect((await member(h.item.userId)).roles).toEqual([{ projectId: null, roleId: "software-user" }, { projectId: "registration-project", roleId: "hardware-committer" }]);
});

it("accepts exactly one competing decision and rejects duplicate decisions without duplicate audit or notification", async () => {
  const h = await register("competing");
  const actions = ["approve", "enable-basic", "reject"] as const;
  const results = await Promise.all(actions.map(action => request<{ item: RegistrationRoleRequestDto }>(`${h.path}/${action}`, "POST", {})));
  const successes = results.filter(result => result.status === 200); expect(successes).toHaveLength(1);
  expect(results.every(result => [200, 404, 409].includes(result.status))).toBe(true);
  const decided = successes[0].body.item;
  for (const action of actions) expect([404, 409]).toContain((await request(`${h.path}/${action}`, "POST", {})).status);
  expect(await history(h.item.id)).toEqual(decided);
  expect((await member(h.item.userId)).isActive).toBe(decided.decisionCanLogin);
  expect((await member(h.item.userId)).roles).toEqual(decided.decisionRoleIds!.map(roleId => ({ projectId: null, roleId })));
  expect((await db.query("select id from audit_events where kind='registration-role-request' and metadata->>'requestId'=$1", [h.item.id])).rows).toHaveLength(1);
  expect((await db.query("select id from user_notifications where recipient_user_id=$1 and metadata->>'requestId'=$2", [h.item.userId, h.item.id])).rows).toHaveLength(1);
});

it("rolls account activation, role, request closure and notification back when audit or notification persistence fails", async () => {
  for (const relation of ["audit_events", "user_notifications"] as const) {
    const h = await register(`rollback-${relation}`);
    await db.query(`create function reject_registration_decision_write() returns trigger language plpgsql as $$ begin
      if to_jsonb(new)->>'kind'='registration-role-request' or to_jsonb(new)->>'source_kind'='registration-role-request' then raise exception 'registration persistence unavailable'; end if; return new; end $$`);
    await db.query(`create trigger reject_registration_decision_write before insert on ${relation} for each row execute function reject_registration_decision_write()`);
    try { expect((await request(`${h.path}/enable-basic`, "POST", {})).status).toBe(500); }
    finally { await db.query(`drop trigger reject_registration_decision_write on ${relation}`); await db.query("drop function reject_registration_decision_write()"); }
    expect((await member(h.item.userId))).toMatchObject({ isActive: false, roles: [{ projectId: null, roleId: "software-user" }] });
    const pending = await request<{ items: RegistrationRoleRequestDto[] }>("/api/v1/users/registration-role-requests"); expect(pending.body.items.find(item => item.id === h.item.id)).toMatchObject({ status: "pending", accountChanged: false, decisionOutcome: null });
    expect((await db.query("select id from audit_events where kind='registration-role-request' and metadata->>'requestId'=$1", [h.item.id])).rows).toHaveLength(0);
    expect((await request(`${h.path}/enable-basic`, "POST", {})).status).toBe(200);
  }
});

it("does not overwrite a manual role change committed after the request was first read", async () => {
  const h = await register("manual-race");
  const client = new pg.Client({ connectionString: database.url }); await client.connect();
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), read = new Promise<void>(resolve => { observed = resolve; });
  let gated = false;
  const gatedDb = createDatabase({ query: async (text, values = []) => {
    const result = await client.query(text, values);
    if (!gated && text.includes("from local_registration_role_requests")) { gated = true; observed(); await gate; }
    return { rows: result.rows, rowCount: result.rowCount };
  } });
  const targetServer = createWiseEffServer({ db: gatedDb, env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: true }, auth: { mode: "production" } });
  const decision = requestJson(targetServer, `${h.path}/enable-basic`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: "{}" });
  try {
    await read;
    expect((await request(`/api/v1/users/${h.item.userId}/organization-roles`, "PUT", { roles: ["hardware-user"], expectedRoles: ["software-user"] })).status).toBe(200);
    release(); expect((await decision).status).toBe(409);
    expect((await member(h.item.userId))).toMatchObject({ isActive: false, roles: [{ projectId: null, roleId: "hardware-user" }] });
  } finally { release(); await decision; await client.end(); }
});

it("lets a later manual deactivation win after a decision and leaves the original decision snapshot intact", async () => {
  const h = await register("later-deactivation");
  const client = new pg.Client({ connectionString: database.url }); await client.connect();
  let release!: () => void, observed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { observed = resolve; });
  let gated = false;
  const gatedDb = createDatabase({ query: async (text, values = []) => {
    const result = await client.query(text, values);
    if (!gated && text.includes("from users") && text.includes("for no key update")) { gated = true; observed(); await gate; }
    return { rows: result.rows, rowCount: result.rowCount };
  } });
  const targetServer = createWiseEffServer({ db: gatedDb, env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: true }, auth: { mode: "production" } });
  const decision = requestJson<{ item: RegistrationRoleRequestDto }>(targetServer, `${h.path}/enable-basic`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: "{}" });
  let deactivation: ReturnType<typeof request> | undefined;
  try {
    await locked;
    deactivation = request(`/api/v1/users/${h.item.userId}/activation`, "PATCH", { isActive: false });
    // Observe the real lock wait rather than guessing at request scheduling.
    await expect.poll(async () => (await db.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%update users%') as waiting")).rows[0].waiting).toBe(true);
    release(); const decided = await decision; expect(decided.status).toBe(200); expect((await deactivation).status).toBe(200);
    expect((await member(h.item.userId)).isActive).toBe(false); expect((await login(h.username)).status).toBe(403);
    expect(await history(h.item.id)).toEqual(decided.body.item); expect(decided.body.item).toMatchObject({ decisionCanLogin: true, decisionRoleIds: ["software-user"] });
  } finally { release(); await Promise.allSettled([decision, ...(deactivation ? [deactivation] : [])]); await client.end(); }
});

it("upgrades populated requests without inferring historical access and marks known later management as stale", async () => {
  const historical = await register("legacy-outcome"), pending = await register("legacy-pending");
  expect((await request(`${historical.path}/enable-basic`, "POST", {})).status).toBe(200);
  const auth = (await request<AuthContext>("/api/v1/me")).body;
  await expect(db.transaction(async tx => {
    await tx.query("drop trigger registration_activation_changed on users; drop trigger registration_organization_roles_changed on user_role_bindings; drop function mark_pending_registration_account_change()");
    await tx.query("alter table local_registration_role_requests drop column account_changed_at, drop column decision_outcome, drop column decision_can_login, drop column decision_role_ids");
    await tx.query("delete from schema_migrations where name='0241_registration_decision_outcomes.sql'");
    await deactivateUser(tx, auth, pending.item.userId, { isActive: false });
    expect(await applyMigrations(tx, fileURLToPath(new URL("../../migrations", import.meta.url)), { through: "0241_registration_decision_outcomes.sql" })).toEqual(["0241_registration_decision_outcomes.sql"]);
    expect((await listRegistrationRoleRequests(tx, auth, "decided")).find(item => item.id === historical.item.id)).toMatchObject({ decisionOutcome: null, decisionCanLogin: null, decisionRoleIds: null });
    expect((await listRegistrationRoleRequests(tx, auth)).find(item => item.id === pending.item.id)).toMatchObject({ accountChanged: true });
    throw new Error("rollback-upgrade-probe");
  })).rejects.toThrow("rollback-upgrade-probe");
});

it("executes the decision through the actual NOINHERIT API LOGIN with the same authorization and no Catalog private-table grant", async () => {
  const h = await register("api-login"); const runToken = `reg${randomBytes(5).toString("hex")}`;
  let api: ReturnType<typeof createPostgresDatabase> | undefined;
  try {
    const runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken }); api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ current_user: string; session_user: string; rolinherit: boolean }>("select current_user,session_user,rolinherit from pg_roles where rolname=current_user")).rows).toEqual([{ current_user: runtime.apiRole, session_user: runtime.apiRole, rolinherit: false }]);
    const actual = createWiseEffServer({ db: api, env: { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: true }, auth: { mode: "production" } });
    const result = await requestJson<{ item: RegistrationRoleRequestDto }>(actual, `${h.path}/enable-basic`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` }, body: "{}" }); expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item).toMatchObject({ decisionOutcome: "basic-enabled", decisionRoleIds: ["software-user"], decisionCanLogin: true });
    expect((await api.query("select has_table_privilege(current_user,'parameter_catalog.parameter_definitions','INSERT,UPDATE,DELETE,TRUNCATE') as can_write")).rows).toEqual([{ can_write: false }]);
    await expect(api.query("delete from parameter_catalog.log_erasures where false")).rejects.toMatchObject({ code: "42501" });
    expect((await login(h.username)).body.auth.roles).toEqual([{ projectId: null, roleId: "software-user" }]);
  } finally { await api?.close(); await dropLabRuntimeLogins(database.url, runToken); }
});
