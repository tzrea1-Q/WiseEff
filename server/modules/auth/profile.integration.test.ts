import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "./baselineCatalog";
import { createOidcVerifier } from "./oidcVerifier";
import type { AuthContext } from "./types";

const available = await isTestDatabaseAvailable(), pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const issuer = "https://controlled-id.example/profile", audience = "wiseeff-profile-test", organizationId = "profile-org", subject = "existing-oidc-subject";
function token(overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "profile-key" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: issuer, aud: audience, sub: subject, exp: Math.floor(Date.now()/1000)+3600,
    organization_id: organizationId, email: "existing@example.test", email_verified: true, name: "Provider display", wiseeff_roles: [{ roleId: "platform-admin", projectId: null }], ...overrides })).toString("base64url");
  return `${header}.${claims}.${sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), pair.privateKey).toString("base64url")}`;
}
async function fixture(provider: "oidc" | "local" = "oidc") {
  const ephemeral = await createEphemeralTestDatabase("profile"), db = createPostgresDatabase(ephemeral.url);
  await seedCoreGraph(db, { organization: { id: organizationId, name: "Profile organization" }, users: [{ id: subject, name: "Existing display", title: "Existing title", email: "existing@example.test" }, { id: "profile-admin" }] });
  await seedBaselineAuthCatalog(db);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,project_id,role_id) values('profile-owner-role',$1,$2,null,'hardware-user'),('profile-admin-role','profile-admin',$2,null,'admin')`, [subject,organizationId]);
  // The fixture represents an existing authenticated OIDC member, not a new email-only account.
  if (provider === "oidc") await db.query("update public.user_oidc_identities set issuer=$1,subject=$2 where user_id=$2", [issuer,subject]);
  const server = createWiseEffServer({ db, env: { AUTH_PROVIDER: provider }, auth: { mode: "production", ...(provider === "oidc" ? { verifier: createOidcVerifier({ issuer, audience,
    jwks: { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "profile-key", alg: "RS256", use: "sig" }] } }) } : {}) } });
  const request = <T,>(path: string, method = "GET", body?: unknown, accessToken = token()) => requestJson<T>(server,path,{ method, headers: { Authorization: `Bearer ${accessToken}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { db, request, close: async () => { await db.close(); await ephemeral.drop(); } };
}

describe.skipIf(!available)("authentication-aware application profiles over real HTTP and PostgreSQL", () => {
  it("updates an already authenticated OIDC user's display fields without a local service, identity binding changes or claim-based role grants", async () => {
    const h = await fixture();
    try {
      const before = await h.request<AuthContext>("/api/v1/me"); expect(before.status).toBe(200);
      const config = await h.request<{ provider: string }>("/api/v1/auth/local-config"); expect(config.body.provider).toBe("oidc");
      const roleRows = (await h.db.query("select * from user_role_bindings where user_id=$1", [subject])).rows;
      const changed = await h.request<AuthContext>("/api/v1/me/profile","PATCH",{ name: " Updated application name ",title: " Application title " });
      expect(changed.status).toBe(200); expect(changed.body.user).toMatchObject({ id: subject,organizationId,name: "Updated application name",title: "Application title",email: "existing@example.test" });
      expect(changed.body.roles).toEqual(before.body.roles); expect(changed.body.permissions).toEqual(before.body.permissions);
      expect((await h.request<AuthContext>("/api/v1/me")).body).toEqual(changed.body);
      expect((await h.db.query("select * from user_role_bindings where user_id=$1", [subject])).rows).toEqual(roleRows);
      expect((await h.db.query("select user_id from user_password_credentials where user_id=$1", [subject])).rows).toHaveLength(0);
      expect((await h.request("/api/v1/me/password","POST",{ currentPassword: "old-password",newPassword: "new-password" })).status).toBe(404);
      const audit = await h.db.query<{ actor_user_id: string; organization_id: string; metadata: unknown }>("select actor_user_id,organization_id,metadata from audit_events where action='update-profile'");
      expect(audit.rows).toEqual([{ actor_user_id: subject,organization_id: organizationId,metadata: { fields: ["name","title"], initiator: "user" } }]);
    } finally { await h.close(); }
  },120_000);
  it("rejects identity/role fields, blank display data, unauthorized organizations, unknown subjects and inactive users", async () => {
    const h = await fixture();
    try {
      for (const body of [{ name: "   " },{ title: " " },{ name: "Changed",email: "untrusted@example.test" },{ subject: "other",roles: ["admin"] }]) {
        expect((await h.request("/api/v1/me/profile","PATCH",body)).status).toBe(400);
      }
      expect((await h.request("/api/v1/me/profile","PATCH",{ name: "Foreign" },token({ organization_id: "other-org" }))).status).toBe(401);
      expect((await h.request("/api/v1/me/profile","PATCH",{ name: "Unknown" },token({ sub: "unknown-subject",email: "unknown@example.test" }))).status).toBe(401);
      await h.db.query("update users set is_active=false where id=$1",[subject]);
      expect((await h.request("/api/v1/me/profile","PATCH",{ name: "Inactive" })).status).toBe(403);
      expect((await h.db.query<{ name: string }>("select name from users where id=$1",[subject])).rows[0].name).toBe("Existing display");
      expect((await h.db.query("select id from audit_events where action='update-profile'")).rows).toHaveLength(0);
    } finally { await h.close(); }
  },120_000);
  it("commits the profile and its audit together, preserving the original values when audit persistence fails", async () => {
    const h = await fixture();
    try {
      await h.db.query("create function reject_profile_audit() returns trigger language plpgsql as $$ begin if new.action='update-profile' then raise exception 'audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_profile_audit before insert on audit_events for each row execute function reject_profile_audit()");
      expect((await h.request("/api/v1/me/profile","PATCH",{ name: "Not committed",title: "Not committed" })).status).toBe(500);
      expect((await h.request<AuthContext>("/api/v1/me")).body.user).toMatchObject({ name: "Existing display",title: "Existing title" });
      expect((await h.db.query("select id from audit_events where action='update-profile'")).rows).toHaveLength(0);
    } finally { await h.close(); }
  },120_000);
  it("keeps local account creation, profile editing, password errors and session revocation working", async () => {
    const h = await fixture("local");
    try {
      const created = await h.request<{ token: string; auth: AuthContext }>("/api/v1/auth/register","POST",{ name: "Local profile",username: "local.profile",title: "Local title",password: "strong-password",roleId: "hardware-user" });
      expect(created.status).toBe(201);
      const first = created.body.token, input = { username: "local.profile",password: "strong-password" };
      const other = await h.request<{ token: string }>("/api/v1/auth/login","POST",input);
      const changed = await h.request<AuthContext>("/api/v1/me/profile","PATCH",{ name: "Local updated",title: "Local updated title" },first);
      expect(changed.status).toBe(200); expect(changed.body.user).toMatchObject({ id: created.body.auth.user.id,username: "local.profile",name: "Local updated" });
      expect((await h.request("/api/v1/me/password","POST",{ currentPassword: "wrong-password",newPassword: "new-password" },first)).status).toBe(401);
      expect((await h.request("/api/v1/me/password","POST",{ currentPassword: "strong-password",newPassword: "new-password" },first)).status).toBe(200);
      expect((await h.request("/api/v1/me","GET",undefined,first)).status).toBe(200);
      expect((await h.request("/api/v1/me","GET",undefined,other.body.token)).status).toBe(401);
      expect((await h.request("/api/v1/auth/login","POST",input)).status).toBe(401);
      const login = await h.request<{ auth: AuthContext }>("/api/v1/auth/login","POST",{ username: "local.profile",password: "new-password" });
      expect(login.status).toBe(200); expect(login.body.auth.user).toMatchObject({ username: "local.profile",name: "Local updated",title: "Local updated title" });
    } finally { await h.close(); }
  },120_000);
});
