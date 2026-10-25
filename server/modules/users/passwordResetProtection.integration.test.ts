import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createDatabase, createPostgresDatabase, type Database, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import type { AuthContext } from "../auth/types";

const organizationId = "password-protection-home";
const adminId = "password-org-admin", platformId = "password-platform-admin", targetId = "password-target";
const originalPassword = "Password-protection-original", nextPassword = "Password-protection-updated";

describe("password-reset authority through real local authentication and PostgreSQL", () => {
  let ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let api: RootDatabase | undefined, runtimeToken: string | undefined;
  beforeEach(async () => {
    api = undefined; runtimeToken = undefined;
    ephemeral = await createEphemeralTestDatabase("password_protection"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: adminId }, { id: platformId }, { id: targetId }] });
    await seedCoreGraph(db, { organization: { id: "password-foreign" }, users: [{ id: "password-foreign-user" }] });
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('password-admin-role',$1,$4,'admin'),('password-platform-role',$2,$4,'platform-admin'),
      ('password-backup-admin-role',$2,$4,'admin'),('password-target-role',$3,$4,'hardware-user')`, [adminId, platformId, targetId, organizationId]);
    const hash = await hashLocalAccountPassword(originalPassword);
    for (const id of [adminId, platformId, targetId, "password-foreign-user"]) {
      await db.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [id, hash]);
    }
  });
  afterEach(async () => {
    await api?.close();
    try { if (runtimeToken) await dropLabRuntimeLogins(ephemeral.url, runtimeToken); }
    finally { await db?.close(); await ephemeral?.drop(); }
  });
  function request<T = unknown>(path: string, method = "GET", body?: unknown, token?: string, database: Database = api ?? db) {
    return requestJson<T>(createWiseEffServer({ db: database, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" } }), `/api/v1/${path}`, {
      method, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  async function login(id: string, password = originalPassword) {
    const result = await request<{ token: string; auth: AuthContext }>("auth/login", "POST", { username: id, password });
    expect(result.status, result.bodyText).toBe(200); return result.body;
  }
  async function credential(id: string) {
    return (await db.query<{ password_hash: string }>("select password_hash from user_password_credentials where user_id=$1", [id])).rows[0].password_hash;
  }
  async function resetAudits(id: string) {
    return (await db.query("select actor_user_id,target_id from audit_events where kind='user-password-reset' and target_id=$1", [id])).rows;
  }

  it("denies an ordinary organization admin resetting a platform admin and preserves its credential and sessions through the actual API LOGIN", async () => {
    const runToken = `pwd${randomBytes(5).toString("hex")}`;
    const runtime = await provisionPublicationRuntimeLogins(ephemeral.url, { mode: "lab", runToken });
    runtimeToken = runToken; api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ rolinherit: boolean }>("select rolinherit from pg_roles where rolname=current_user")).rows[0].rolinherit).toBe(false);
    const actor = await login(adminId), protectedSession = await login(platformId), before = await credential(platformId);
    const result = await request(`users/${platformId}/password`, "POST", { password: nextPassword }, actor.token);
    expect(result.status, result.bodyText).toBe(403);
    expect(await credential(platformId) === before).toBe(true);
    expect((await request("me", "GET", undefined, protectedSession.token)).status).toBe(200);
    expect(await resetAudits(platformId)).toEqual([]);
    expect((await login(platformId)).auth.roles).toContainEqual({ projectId: null, roleId: "platform-admin" });
  });

  it("allows a platform admin to reset another platform admin, revokes old sessions and audits the real actor", async () => {
    await db.query("update user_role_bindings set role_id='platform-admin' where user_id=$1", [targetId]);
    const actor = await login(platformId), target = await login(targetId), before = await credential(targetId);
    const result = await request(`users/${targetId}/password`, "POST", { password: nextPassword }, actor.token);
    expect(result.status, result.bodyText).toBe(200);
    expect(await credential(targetId) === before).toBe(false);
    expect((await request("me", "GET", undefined, target.token)).status).toBe(401);
    expect((await request("auth/login", "POST", { username: targetId, password: originalPassword })).status).toBe(401);
    expect((await login(targetId, nextPassword)).auth.roles).toContainEqual({ projectId: null, roleId: "platform-admin" });
    expect(await resetAudits(targetId)).toEqual([{ actor_user_id: platformId, target_id: targetId }]);
    const audit = await db.query<{ metadata: unknown }>("select metadata from audit_events where kind='user-password-reset'");
    expect(JSON.stringify(audit.rows).includes(nextPassword)).toBe(false);
  });

  it("does not reveal or change a foreign account to an ordinary administrator", async () => {
    const actor = await login(adminId), before = await credential("password-foreign-user");
    const result = await request("users/password-foreign-user/password", "POST", { password: nextPassword }, actor.token);
    expect(result.status, result.bodyText).toBe(404);
    expect(await credential("password-foreign-user") === before).toBe(true);
    expect(await resetAudits("password-foreign-user")).toEqual([]);
  });

  it.each(["promoted-target", "demoted-actor"] as const)("rechecks authority after the initial lookup when another transaction changes the %s", async (change) => {
    const actor = await login(adminId), operator = await login(platformId), target = await login(targetId), before = await credential(targetId);
    const client = new pg.Client({ connectionString: ephemeral.url }); await client.connect();
    let release!: () => void, observed = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const gated = createDatabase({ query: async (text, values = []) => {
      const result = await client.query(text, values);
      if (!observed && text.includes("where users.organization_id = $1 and users.id = $2") && values[1] === targetId) {
        observed = true; await gate;
      }
      return { rows: result.rows, rowCount: result.rowCount };
    } });
    const resetting = request(`users/${targetId}/password`, "POST", { password: nextPassword }, actor.token, gated);
    try {
      await expect.poll(() => observed).toBe(true);
      const user = change === "promoted-target" ? targetId : adminId;
      const updated = await request(`users/${user}/organization-roles`, "PUT", {
        roles: [change === "promoted-target" ? "platform-admin" : "hardware-user"],
        expectedRoles: [change === "promoted-target" ? "hardware-user" : "admin"]
      }, operator.token);
      expect(updated.status, updated.bodyText).toBe(200);
      release();
      const result = await resetting; expect(result.status, result.bodyText).toBe(403);
      expect(await credential(targetId) === before).toBe(true);
      expect((await request("me", "GET", undefined, target.token)).status).toBe(200);
      expect(await resetAudits(targetId)).toEqual([]);
    } finally { release(); await resetting; await client.end(); }
  });
});
