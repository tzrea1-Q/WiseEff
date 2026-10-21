import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "./baselineCatalog";
import { createOidcVerifier } from "./oidcVerifier";
import type { AuthContext } from "./types";
import type { UserGovernanceDto } from "../users/types";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import type { Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { fileURLToPath } from "node:url";

const available = await isTestDatabaseAvailable();
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 }), issuer = "https://controlled-id.example/members", organizationId = "members-org";
function token(subject: string, overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "members-key" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: issuer, aud: "members-test", sub: subject, organization_id: organizationId,
    exp: Math.floor(Date.now() / 1000) + 3600, email_verified: true, ...overrides })).toString("base64url");
  return `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), pair.privateKey).toString("base64url")}`;
}
function serverFor(db: Database) {
  return createWiseEffServer({ db, env: { AUTH_PROVIDER: "oidc", AUTH_OIDC_ISSUER: `${issuer}/` }, auth: { mode: "production", verifier: createOidcVerifier({ issuer, audience: "members-test",
    jwks: { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "members-key", alg: "RS256", use: "sig" }] } }) } });
}
async function fixture() {
  const ephemeral = await createEphemeralTestDatabase("oidc_members"), db = createPostgresDatabase(ephemeral.url);
  await seedCoreGraph(db, { organization: { id: organizationId, name: "Members organization" }, users: [{ id: "members-admin" }] });
  await seedBaselineAuthCatalog(db);
  await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('members-admin-role','members-admin',$1,'platform-admin')", [organizationId]);
  await db.query("update public.user_oidc_identities set issuer=$1,subject='members-admin' where user_id='members-admin'", [issuer]);
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = token("members-admin")) => requestJson<T>(serverFor(db), path, { method, headers: { Authorization: `Bearer ${bearer}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { db, request, url: ephemeral.url, close: async () => { await db.close(); await ephemeral.drop(); } };
}
describe.skipIf(!available)("explicit OIDC member provisioning through signed authentication and real HTTP/PostgreSQL", () => {
  it("provisions a member without local credentials and resolves its configured subject to the stable internal user ID", async () => {
    const h = await fixture();
    try {
      const created = await h.request<{ item: UserGovernanceDto }>("/api/v1/users", "POST", {
        authentication: "oidc", issuer, subject: "external-member-001", email: "member@example.test", name: "Provisioned member", title: "Engineer",
        roles: [{ projectId: null, roleId: "hardware-user" }]
      });
      expect(created.status).toBe(201);
      const userId = created.body.item.id;
      expect(userId).not.toBe("external-member-001");
      expect(created.body.item).toMatchObject({ name: "Provisioned member", username: null, oidcIdentity: { issuer, subject: "external-member-001" } });
      expect((await h.db.query("select user_id from user_password_credentials where user_id=$1", [userId])).rows).toHaveLength(0);
      const me = await h.request<AuthContext>("/api/v1/me", "GET", undefined, token("external-member-001", { email: "member@example.test", wiseeff_roles: [{ roleId: "platform-admin", projectId: null }] }));
      expect(me.status).toBe(200); expect(me.body.user).toMatchObject({ id: userId, name: "Provisioned member", organizationId });
      expect(me.body.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
      expect((await h.request("/api/v1/me", "GET", undefined, token("different-subject", { email: "member@example.test" }))).status).toBe(401);
      expect((await h.request("/api/v1/me", "GET", undefined, token(userId, { email: "member@example.test" }))).status).toBe(401);
    } finally { await h.close(); }
  }, 120_000);
  it("uses the actual API NOINHERIT login for provisioning and refuses identity DML through worker and manager logins", async () => {
    const h = await fixture(), runToken = `oidc${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const opened: Array<ReturnType<typeof createPostgresDatabase>> = [];
    try {
      const logins = await provisionPublicationRuntimeLogins(h.url, { mode: "lab",runToken });
      const api = createPostgresDatabase(logins.apiUrl); opened.push(api);
      for (const url of [logins.workerUrl,logins.managerUrl]) {
        const denied = createPostgresDatabase(url); opened.push(denied);
        expect((await denied.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false,rolinherit: false });
        for (const sql of ["update public.user_oidc_identities set subject=subject where false", "delete from public.user_oidc_identities where false", "insert into public.user_oidc_identities select * from public.user_oidc_identities where false"]) {
          await expect(denied.query(sql)).rejects.toMatchObject({ code: "42501" });
        }
      }
      expect((await api.query<{ rolsuper: boolean; rolinherit: boolean }>("select rolsuper,rolinherit from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false,rolinherit: false });
      const created = await requestJson<{ item: UserGovernanceDto }>(serverFor(api), "/api/v1/users", { method: "POST",headers: { Authorization: `Bearer ${token("members-admin")}` },body: JSON.stringify({ authentication: "oidc",issuer,subject: "runtime-member",name: "Runtime member",roles: [{ roleId: "hardware-user" }] }) });
      expect(created.status).toBe(201);
      const me = await requestJson<AuthContext>(serverFor(api), "/api/v1/me", { headers: { Authorization: `Bearer ${token("runtime-member")}` } });
      expect(me.status).toBe(200); expect(me.body.user.id).toBe(created.body.item.id);
    } finally {
      for (const db of opened) await db.close();
      expect((await dropLabRuntimeLogins(h.url,runToken)).failed).toEqual([]); await h.close();
    }
  },120_000);
  it("rejects duplicate and stale concurrent bindings, wrong issuers, cross-organization targets and non-administrators", async () => {
    const h = await fixture();
    try {
      const payload = { authentication: "oidc",issuer,subject: "concurrent-subject",name: "Concurrent member",roles: [{ roleId: "hardware-user" }] };
      const pair = await Promise.all([h.request<{ item: UserGovernanceDto }>("/api/v1/users","POST",payload),h.request<{ item: UserGovernanceDto }>("/api/v1/users","POST",payload)]);
      expect(pair.map((result) => result.status).sort()).toEqual([201,409]);
      const member = pair.find((result) => result.status === 201)!.body.item;
      const path = `/api/v1/users/${member.id}/oidc-identity`, expectedIdentity = { issuer,subject: payload.subject };
      const updates = await Promise.all([h.request(path,"PUT",{ issuer,subject: "next-subject-a",expectedIdentity }),h.request(path,"PUT",{ issuer,subject: "next-subject-b",expectedIdentity })]);
      expect(updates.map((result) => result.status).sort()).toEqual([200,409]);
      const read = await h.request<{ items: UserGovernanceDto[] }>("/api/v1/users");
      const current = read.body.items.find((item) => item.id === member.id)!;
      expect(current.oidcIdentity!.subject).toMatch(/^next-subject-[ab]$/);
      expect((await h.request("/api/v1/me","GET",undefined,token(payload.subject))).status).toBe(401);
      expect((await h.request<AuthContext>("/api/v1/me","GET",undefined,token(current.oidcIdentity!.subject))).body.user.id).toBe(member.id);
      expect((await h.request(path,"PUT",{ issuer: "https://wrong.example",subject: "wrong",expectedIdentity: current.oidcIdentity })).status).toBe(400);
      expect((await h.request(path,"PUT",{ issuer,subject: "escalation",expectedIdentity: current.oidcIdentity },token(current.oidcIdentity!.subject))).status).toBe(403);
      expect((await h.request(path,"PUT",{ issuer,subject: "foreign",expectedIdentity: current.oidcIdentity },token("members-admin",{ organization_id: "foreign-org" }))).status).toBe(401);
      await seedCoreGraph(h.db,{ organization: { id: "foreign-org",name: "Foreign" },users: [{ id: "foreign-member" }] });
      expect((await h.request("/api/v1/users/foreign-member/oidc-identity","PUT",{ issuer,subject: "foreign",expectedIdentity: null })).status).toBe(404);
      await h.request(`/api/v1/users/${member.id}/activation`,"PATCH",{ isActive: false });
      expect((await h.request("/api/v1/me","GET",undefined,token(current.oidcIdentity!.subject))).status).toBe(403);
      expect((await h.db.query("select id from users where organization_id=$1 and name='Concurrent member'",[organizationId])).rows).toHaveLength(1);
      expect((await h.db.query("select id from audit_events where target_id=$1 and metadata ? 'identity'",[member.id])).rows).toHaveLength(2);
    } finally { await h.close(); }
  },120_000);
  it("rolls back provisioning and binding changes when their audit cannot commit", async () => {
    const h = await fixture();
    try {
      await h.db.query("create function reject_oidc_audit() returns trigger language plpgsql as $$ begin if new.metadata ? 'identity' then raise exception 'audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_oidc_audit before insert on audit_events for each row execute function reject_oidc_audit()");
      const before = (await h.db.query<{ count: string }>("select count(*) from users")).rows[0].count;
      expect((await h.request("/api/v1/users","POST",{ authentication: "oidc",issuer,subject: "not-committed",name: "Not committed",roles: [{ roleId: "hardware-user" }] })).status).toBe(500);
      expect((await h.db.query<{ count: string }>("select count(*) from users")).rows[0].count).toBe(before);
      expect((await h.request("/api/v1/users/members-admin/oidc-identity","PUT",{ issuer,subject: "changed-admin",expectedIdentity: { issuer,subject: "members-admin" } })).status).toBe(500);
      expect((await h.request("/api/v1/me")).status).toBe(200);
      expect((await h.request("/api/v1/me","GET",undefined,token("changed-admin"))).status).toBe(401);
      expect((await h.db.query("select id from audit_events where metadata ? 'identity'")).rows).toHaveLength(0);
    } finally { await h.close(); }
  },120_000);
  it("does not let an organization administrator redirect a platform administrator identity or grant that role through provisioning", async () => {
    const h = await fixture();
    try {
      expect((await h.request("/api/v1/users","POST",{ authentication: "oidc",issuer,subject: "org-administrator",name: "Organization administrator",roles: [{ roleId: "admin" }] })).status).toBe(201);
      const ordinary = await h.request<{ item: UserGovernanceDto }>("/api/v1/users","POST",{ authentication: "oidc",issuer,subject: "ordinary-member",name: "Ordinary member",roles: [{ roleId: "hardware-user" }] });
      expect((await h.request("/api/v1/users/members-admin/oidc-identity","PUT",{ issuer,subject: "redirected-platform-admin",expectedIdentity: { issuer,subject: "members-admin" } },token("org-administrator"))).status).toBe(403);
      expect((await h.request("/api/v1/users","POST",{ authentication: "oidc",issuer,subject: "new-platform-admin",name: "Forbidden grant",roles: [{ roleId: "platform-admin" }] },token("org-administrator"))).status).toBe(403);
      expect((await h.request(`/api/v1/users/${ordinary.body.item.id}/oidc-identity`,"PUT",{ issuer,subject: "ordinary-updated",expectedIdentity: { issuer,subject: "ordinary-member" } },token("org-administrator"))).status).toBe(200);
      expect((await h.request("/api/v1/me")).status).toBe(200);
      expect((await h.request("/api/v1/me","GET",undefined,token("redirected-platform-admin"))).status).toBe(401);
    } finally { await h.close(); }
  },120_000);
  it("upgrades existing subject/email migration identity while new members and later profile email edits acquire no fallback authority", async () => {
    const h = await fixture();
    try {
      await expect(h.db.transaction(async (tx) => {
        await tx.query("drop trigger capture_initial_oidc_identity on public.users; drop table public.user_oidc_identities; drop function public.capture_initial_oidc_identity(),public.preserve_initial_oidc_identity(); alter table public.users drop constraint users_id_organization_identity_unique");
        await tx.query("delete from schema_migrations where name='0238_oidc_member_identities.sql'");
        await tx.query("insert into users(id,organization_id,name,email,title) values('legacy-member',$1,'Legacy','legacy@example.test','Engineer'),('legacy-other',$1,'Other','other@example.test','Engineer')",[organizationId]);
        await tx.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('legacy-role','legacy-member',$1,'hardware-user'),('legacy-other-role','legacy-other',$1,'hardware-user')",[organizationId]);
        expect(await applyMigrations(tx,fileURLToPath(new URL("../../migrations",import.meta.url)),{ through: "0238_oidc_member_identities.sql" })).toEqual(["0238_oidc_member_identities.sql"]);
        const server = serverFor(tx);
        const request = <T,>(path: string,method = "GET",body?: unknown,bearer = token("members-admin")) => requestJson<T>(server,path,{ method,headers: { Authorization: `Bearer ${bearer}` },...(body ? { body: JSON.stringify(body) } : {}) });
        expect((await request<AuthContext>("/api/v1/me","GET",undefined,token("legacy-member"))).body.user.id).toBe("legacy-member");
        expect((await request<AuthContext>("/api/v1/me","GET",undefined,token("external-legacy",{ email: "legacy@example.test" }))).body.user.id).toBe("legacy-member");
        expect((await request("/api/v1/me","GET",undefined,token("external-legacy",{ email: "legacy@example.test",email_verified: false }))).status).toBe(401);
        expect((await request("/api/v1/me","GET",undefined,token("legacy-member",{ email: "other@example.test" }))).status).toBe(401);
        expect((await request("/api/v1/users/legacy-member","PATCH",{ email: "edited@example.test" })).status).toBe(200);
        expect((await request("/api/v1/me","GET",undefined,token("edited-claim",{ email: "edited@example.test" }))).status).toBe(401);
        expect((await request<AuthContext>("/api/v1/me","GET",undefined,token("original-claim",{ email: "legacy@example.test" }))).body.user.id).toBe("legacy-member");
        await tx.query("insert into users(id,organization_id,name,email,title) values('future-member',$1,'Future','future@example.test','Engineer')",[organizationId]);
        await tx.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('future-role','future-member',$1,'hardware-user')",[organizationId]);
        for (const subject of ["future-member","unknown-future-subject"]) expect((await request("/api/v1/me","GET",undefined,token(subject,{ email: "future@example.test" }))).status).toBe(401);
        const path = "/api/v1/users/future-member/oidc-identity";
        expect((await request(path,"PUT",{ issuer,subject: "legacy-other",expectedIdentity: null })).status).toBe(409);
        expect((await request(path,"PUT",{ issuer,subject: "external-future",email: "legacy@example.test",expectedIdentity: null })).status).toBe(409);
        expect((await request(path,"PUT",{ issuer,subject: "external-future",email: "future@example.test",expectedIdentity: null })).status).toBe(200);
        expect((await request<AuthContext>("/api/v1/me","GET",undefined,token("external-future"))).body.user.id).toBe("future-member");
        expect((await request("/api/v1/users/legacy-member/oidc-identity","PUT",{ issuer,subject: "bound-legacy",expectedIdentity: null })).status).toBe(200);
        expect((await request("/api/v1/me","GET",undefined,token("original-claim",{ email: "legacy@example.test" }))).status).toBe(401);
        expect((await request("/api/v1/me","GET",undefined,token("bound-legacy"))).status).toBe(200);
        throw new Error("rollback-upgrade-probe");
      })).rejects.toThrow("rollback-upgrade-probe");
    } finally { await h.close(); }
  },120_000);
});
