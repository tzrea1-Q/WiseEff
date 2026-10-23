import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createLocalAuthService } from "../auth/localAuth";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import type { AuthContext } from "../auth/types";

type Invitation = { id: string; organizationId: string; roles: string[]; status: string; expiresAt: string; acceptedUserId: string | null };
type Created = { item: Invitation; token: string };
const home = { id: "invite-home", name: "Home" }, target = { id: "invite-target", name: "Target" };
const account = { name: "Invited engineer", username: "invited-engineer", password: "Invitation-test-2026" };

describe("one-time organization invitations through HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let platformToken: string, adminToken: string;
  const actor = (role = "platform-admin"): AuthContext => ({
    user: { id: role === "platform-admin" ? "invite-platform" : "invite-admin", organizationId: home.id, name: "Operator", title: "", isActive: true },
    organization: home, roles: [{ projectId: null, roleId: role as "admin" | "platform-admin" }], permissions: ["users:manage", "admin:access"]
  });
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("invitations"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: home, users: [{ id: "invite-platform" }, { id: "invite-admin" }] });
    await seedCoreGraph(db, { organization: target }); await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('invite-platform-role','invite-platform',$1,'platform-admin'),('invite-admin-role','invite-admin',$1,'admin')", [home.id]);
    const passwordHash = await hashLocalAccountPassword(account.password);
    await db.query("insert into user_password_credentials(user_id,username,password_hash) values('invite-platform','invite-platform',$1),('invite-admin','invite-admin',$1)", [passwordHash]);
    const local = createLocalAuthService(db);
    platformToken = (await local.login({ username: "invite-platform", password: account.password }, { requestId: "fixture" })).session.token;
    adminToken = (await local.login({ username: "invite-admin", password: account.password }, { requestId: "fixture" })).session.token;
  });
  afterEach(async () => { try { await db?.close(); } finally { await ephemeral?.drop(); } });
  function server(role = "platform-admin", local = true) {
    return createWiseEffServer({ db, env: { AUTH_PROVIDER: local ? "local" : "oidc" }, auth: { mode: "production", verifier: { verify: async () => actor(role) } }, ...(local ? { localAuthService: createLocalAuthService(db, { selfRegisterEnabled: false }) } : {}) });
  }
  function manage<T>(path = "", method = "GET", body?: unknown, role = "platform-admin", organizationId = target.id) {
    return requestJson<T>(server(role), `/api/v1/organization/invitations${path}?organizationId=${organizationId}`, { method, headers: { Authorization: `Bearer ${role === "platform-admin" ? platformToken : adminToken}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  function accept(token: string, input = account) {
    return requestJson<{ userId: string; organizationId: string }>(server(), "/api/v1/auth/invitations/accept", { method: "POST", body: JSON.stringify({ token, ...input }) });
  }

  it("lets an invited account join with its exact roles and immediately use existing local login without approval", async () => {
    const created = await manage<Created>("", "POST", { label: "Engineering", roles: ["software-committer"], expiresInDays: 7 });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ organizationId: target.id, status: "pending", roles: ["software-committer"] });
    const joined = await accept(created.body.token); expect(joined.status).toBe(201);
    const login = await requestJson<{ auth: AuthContext; token: string }>(server(), "/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username: account.username, password: account.password }) });
    expect(login.status).toBe(200);
    expect(login.body.auth.organization.id).toBe(target.id);
    expect(login.body.auth.roles).toEqual([{ projectId: null, roleId: "software-committer" }]);
    expect(login.body.auth.user.isActive).toBe(true);
    expect((await manage<{ items: Invitation[] }>()).body.items).toEqual([expect.objectContaining({ status: "accepted", acceptedUserId: joined.body.userId })]);
    expect(JSON.stringify((await manage()).body)).not.toContain(created.body.token);
    expect((await accept(created.body.token)).status).toBe(409);
    const audit = await db.query("select actor_user_id, organization_id from audit_events where kind='organization-invitation' and action='create'");
    expect(audit.rows).toEqual([{ actor_user_id: "invite-platform", organization_id: target.id }]);
  });

  it("invalidates expired, revoked and replaced links while keeping accepted invitations final", async () => {
    const created = (await manage<Created>("", "POST", { label: "Expiry", roles: ["software-user"], expiresInDays: 1 })).body;
    await db.query("update organization_invitations set expires_at=now()-interval '1 second' where id=$1", [created.item.id]);
    expect((await manage<{ items: Invitation[] }>()).body.items[0].status).toBe("expired");
    expect((await accept(created.token)).status).toBe(409);
    const regenerated = await manage<Created>(`/${created.item.id}/regenerate`, "POST", { label: "Updated", roles: ["hardware-user"], expiresInDays: 7 });
    expect(regenerated.status).toBe(200); expect(regenerated.body.token).not.toBe(created.token);
    expect((await accept(created.token)).status).toBe(404);
    expect((await manage(`/${created.item.id}/revoke`, "POST", {})).status).toBe(200);
    expect((await accept(regenerated.body.token)).status).toBe(409);
    const final = (await manage<Created>(`/${created.item.id}/regenerate`, "POST", { label: "Final", roles: ["hardware-user"], expiresInDays: 7 })).body;
    expect((await accept(final.token)).status).toBe(201);
    expect((await manage(`/${created.item.id}/revoke`, "POST", {})).status).toBe(409);
    expect((await manage(`/${created.item.id}/regenerate`, "POST", { label: "Cannot revive", roles: ["admin"], expiresInDays: 7 })).status).toBe(409);
  });

  it("serializes concurrent acceptance and rolls accounts and grants back when auditing fails", async () => {
    const created = (await manage<Created>("", "POST", { label: "Concurrency", roles: ["software-user"], expiresInDays: 7 })).body;
    const results = await Promise.all([accept(created.token), accept(created.token, { ...account, username: "other-invited" })]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect((await db.query("select id from users where organization_id=$1", [target.id])).rowCount).toBe(1);
    const failing = (await manage<Created>("", "POST", { label: "Rollback", roles: ["admin"], expiresInDays: 7 })).body;
    await db.query(`create function public.reject_test_invitation_audit() returns trigger language plpgsql as $$ begin
      if new.kind='organization-invitation' and new.action='accept' then raise exception 'Test audit failure'; end if; return new; end; $$;
      create trigger reject_test_invitation_audit before insert on audit_events for each row execute function public.reject_test_invitation_audit()`);
    expect((await accept(failing.token, { ...account, username: "rollback-invited" })).status).toBe(500);
    expect((await db.query("select * from user_password_credentials where username='rollback-invited'")).rowCount).toBe(0);
    expect((await manage<{ items: Invitation[] }>()).body.items.find((item) => item.id === failing.item.id)?.status).toBe("pending");
  });

  it("keeps existing accounts in their organization and does not silently change roles", async () => {
    const created = (await manage<Created>("", "POST", { label: "Existing", roles: ["software-user"], expiresInDays: 7 })).body;
    const foreign = await accept(created.token, { ...account, username: "invite-admin" });
    expect(foreign.status).toBe(409); expect(JSON.stringify(foreign.body)).toContain("调动");
    const same = (await manage<Created>("", "POST", { label: "Same", roles: ["software-user"], expiresInDays: 7 }, "admin", home.id)).body;
    const existing = await accept(same.token, { ...account, username: "invite-admin" });
    expect(existing.status).toBe(409); expect(JSON.stringify(existing.body)).toContain("成员设置");
    expect((await db.query("select organization_id,role_id from user_role_bindings where user_id='invite-admin'")).rows).toEqual([{ organization_id: home.id, role_id: "admin" }]);
  });

  it("does not accept a link that expires while the consumer waits for a concurrent administrator change", async () => {
    const invitation = (await manage<Created>("", "POST", { label: "Blocked expiry", roles: ["software-user"], expiresInDays: 7 })).body;
    await db.query("update organization_invitations set expires_at=clock_timestamp()+interval '1 second' where id=$1", [invitation.item.id]);
    let locked!: () => void, release!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; }), released = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.transaction(async (tx) => { await tx.query("select id from users where id='invite-platform' for update"); locked(); await released; });
    await acquired;
    const accepting = accept(invitation.token);
    try {
      await vi.waitFor(async () => { expect((await db.query("select pid from pg_stat_activity where datname=current_database() and wait_event_type='Lock'")).rowCount).toBeGreaterThan(0); });
      await db.query("select pg_sleep(greatest(0,extract(epoch from expires_at-clock_timestamp())+0.05)) from organization_invitations where id=$1", [invitation.item.id]);
    } finally { release(); await blocker; }
    expect((await accepting).status).toBe(409);
    expect((await db.query("select id from users where organization_id=$1", [target.id])).rowCount).toBe(0);
  });

  it("limits grants to current administrator authority and rejects foreign administration and non-local provider acceptance", async () => {
    const input = { label: "Admin grant", roles: ["platform-admin"], expiresInDays: 7 };
    expect((await manage("", "POST", input, "admin", home.id)).status).toBe(403);
    expect((await manage("", "POST", { ...input, roles: ["software-user"] }, "admin")).status).toBe(403);
    const created = (await manage<Created>("", "POST", input)).body;
    await db.query("update user_role_bindings set role_id='software-user' where user_id='invite-platform'");
    expect((await accept(created.token)).status).toBe(409);
    expect((await db.query("select id from users where organization_id=$1", [target.id])).rowCount).toBe(0);
    for (const path of ["/api/v1/auth/invitations/preview", "/api/v1/auth/invitations/accept"]) {
      expect((await requestJson(server("platform-admin", false), path, { method: "POST", body: JSON.stringify({ token: created.token, ...account }) })).status).toBe(403);
    }
    expect((await requestJson(server("platform-admin", false), "/api/v1/organization/invitations", { method: "POST", body: JSON.stringify(input) })).status).toBe(403);
  });
});
