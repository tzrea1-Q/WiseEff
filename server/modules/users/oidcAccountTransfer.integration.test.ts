import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createOidcVerifier } from "../auth/oidcVerifier";
import type { AuthContext } from "../auth/types";
import type { UserGovernanceDto } from "./types";
import { getAuthContextForExternalIdentity } from "../auth/repository";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { randomUUID } from "node:crypto";

const issuer = "https://controlled-identity.example/transfer", audience = "organization-transfer";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
function token(subject: string, organizationId: string, overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "transfer-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: audience, sub: subject, organization_id: organizationId,
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), ...overrides })).toString("base64url");
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pair.privateKey).toString("base64url")}`;
}
describe("OIDC account transfer through verified signatures, HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("oidc_transfer"); db = createPostgresDatabase(ephemeral.url);
    for (const [org, users] of [["home", ["platform"]], ["source", ["admin", "member"]], ["target", ["target-admin"]]] as const) {
      await seedCoreGraph(db, { organization: { id: `oidc-${org}`, name: `OIDC ${org}` }, users: users.map(id => ({ id: `oidc-${id}` })) });
      for (const id of users) {
        await db.query("update user_oidc_identities set issuer=$1,subject=$2 where user_id=$3", [issuer, `external-${id}`, `oidc-${id}`]);
        await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`oidc-role-${id}`, `oidc-${id}`, `oidc-${org}`, id === "platform" ? "platform-admin" : id === "member" ? "software-user" : "admin"]);
      }
    }
  });
  afterEach(async () => { await db?.close(); await ephemeral?.drop(); });
  function api<T = unknown>(path: string, method = "GET", body?: unknown, bearer = token("external-platform", "oidc-home")) {
    return requestJson<T>(createWiseEffServer({ db, env: { AUTH_PROVIDER: "oidc", AUTH_OIDC_ISSUER: issuer }, auth: { mode: "production", verifier: createOidcVerifier({ issuer, audience,
      jwks: { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "transfer-key", alg: "RS256", use: "sig" }] } }) } }), `/api/v1/${path}`,
    { method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const path = (id = "member", source = "source") => `platform/organizations/oidc-${source}/members/oidc-${id}/transfer`;
  async function preview(id = "member", source = "source") {
    const response = await api<{ item: { supported: boolean; version: string } }>(`${path(id, source)}-preview`, "POST", { targetOrganizationId: "oidc-target" });
    expect(response.status, response.bodyText).toBe(200); return response.body.item;
  }
  it("waits for a fresh signed target claim and preserves the explicit subject without trusting token roles", async () => {
    const beforeTransfer = Math.floor(Date.now() / 1000), oldToken = token("external-member", "oidc-source", { iat: beforeTransfer }), item = await preview();
    expect(item.supported).toBe(true);
    expect((await api(path(), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["hardware-user"], expectedVersion: item.version })).status).toBe(200);
    const users = await api<{ items: UserGovernanceDto[] }>("users?organizationId=oidc-target");
    expect(users.body.items.find(user => user.id === "oidc-member")).toMatchObject({ organizationId: "oidc-target", oidcIdentity: { issuer, subject: "external-member" }, oidcTransfer: { targetOrganizationId: "oidc-target", status: "pending", verifiedAt: null } });
    expect((await api("me", "GET", undefined, oldToken)).status).toBe(401);
    expect((await api("me", "GET", undefined, token("external-member", "oidc-target", { iat: beforeTransfer }))).status).toBe(401);
    // The second boundary is the revocation rule shared by all external tokens.
    await db.query("update users set external_tokens_revoked_at=now()-interval '2 seconds' where id='oidc-member'");
    const fresh = await api<AuthContext>("me", "GET", undefined, token("external-member", "oidc-target", { wiseeff_roles: [{ roleId: "platform-admin" }] }));
    expect(fresh.status, fresh.bodyText).toBe(200);
    expect(fresh.body).toMatchObject({ user: { id: "oidc-member" }, organization: { id: "oidc-target" }, roles: [{ projectId: null, roleId: "hardware-user" }], projectMemberships: [] });
    const synced = await api<{ items: UserGovernanceDto[] }>("users?organizationId=oidc-target");
    expect(synced.body.items.find(user => user.id === "oidc-member")).toMatchObject({ oidcTransfer: { status: "verified", verifiedAt: expect.any(String) } });
  });
  it("rejects conflicting target subjects and stale previews without revoking source access", async () => {
    const item = await preview(), member = token("external-member", "oidc-source");
    await db.query("update user_oidc_identities set subject='external-member' where user_id='oidc-target-admin'");
    const input = { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: item.version };
    expect((await api(path(), "POST", input)).status).toBe(409);
    expect((await api("me", "GET", undefined, member)).status).toBe(200);
    await db.query("update user_oidc_identities set subject='external-target-admin' where user_id='oidc-target-admin'");
    await api("users/oidc-member/oidc-identity?organizationId=oidc-source", "PUT", { issuer, subject: "changed-member", expectedIdentity: { issuer, subject: "external-member" } });
    expect((await api(path(), "POST", input)).status).toBe(409);
    expect((await api<AuthContext>("me", "GET", undefined, token("changed-member", "oidc-source"))).body.organization.id).toBe("oidc-source");
  });
  it("rolls back transfer and revocation when its audit cannot commit", async () => {
    const item = await preview();
    await db.query("create function reject_oidc_transfer() returns trigger language plpgsql as $$ begin if new.kind='account-transfer' then raise exception 'audit unavailable'; end if; return new; end $$");
    await db.query("create trigger reject_oidc_transfer before insert on audit_events for each row execute function reject_oidc_transfer()");
    expect((await api(path(), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: item.version })).status).toBe(500);
    expect((await api<AuthContext>("me", "GET", undefined, token("external-member", "oidc-source"))).body.user.id).toBe("oidc-member");
    const users = await api<{ items: UserGovernanceDto[] }>("users?organizationId=oidc-source");
    expect(users.body.items.find(user => user.id === "oidc-member")?.oidcTransfer).toBeUndefined();
  });
  it("keeps one usable platform login under concurrent transfers and does not count an unsynchronized administrator", async () => {
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('member-platform','oidc-member','oidc-source','platform-admin')");
    const first = await preview(), second = await preview("platform", "home");
    const replies = await Promise.all([
      api(path(), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: first.version }),
      api(path("platform", "home"), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: second.version })
    ]);
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409]);
    const denied = replies.find(reply => reply.status === 409)!;
    expect(denied.body).toMatchObject({ error: { details: { code: "last-platform-administrator" } } });
    const remaining = replies[0].status === 200 ? { id: "platform", org: "home" } : { id: "member", org: "source" };
    const bearer = token(`external-${remaining.id}`, `oidc-${remaining.org}`);
    const disabled = await api(`users/oidc-${remaining.id}/activation?organizationId=oidc-${remaining.org}`, "PATCH", { isActive: false }, bearer);
    expect(disabled.status, disabled.bodyText).toBe(409);
    expect((await api("platform/organizations", "GET", undefined, bearer)).status).toBe(200);
  });
  it("does not treat a read-only identity lookup or an invalid claim as external synchronization", async () => {
    const item = await preview();
    expect((await api(path(), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: item.version })).status).toBe(200);
    await db.query("update users set external_tokens_revoked_at=now()-interval '2 seconds' where id='oidc-member'");
    const input = { issuer, subject: "external-member", organizationId: "oidc-target", issuedAt: Math.floor(Date.now() / 1000) };
    expect((await getAuthContextForExternalIdentity(db, input)).user.id).toBe("oidc-member");
    for (const overrides of [{ iss: `${issuer}-wrong` }, { aud: "wrong-audience" }, { sub: "unbound-member" }, { exp: 1 }]) {
      expect((await api("me", "GET", undefined, token("external-member", "oidc-target", overrides))).status).toBe(401);
    }
    const pending = await api<{ items: UserGovernanceDto[] }>("users?organizationId=oidc-target");
    expect(pending.body.items.find(user => user.id === "oidc-member")).toMatchObject({ oidcTransfer: { status: "pending", verifiedAt: null } });
    expect((await api(`${path()}-preview`, "POST", { targetOrganizationId: "oidc-target" }, token("external-admin", "oidc-source"))).status).toBe(403);
  });
  it("does not let rebinding the last verified transferred administrator remove the only usable login", async () => {
    const first = await preview("platform", "home");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('extra-platform','oidc-member','oidc-source','platform-admin')");
    expect((await api(path("platform", "home"), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: first.version })).status).toBe(200);
    await db.query("update users set external_tokens_revoked_at=now()-interval '2 seconds' where id='oidc-platform'");
    const moved = token("external-platform", "oidc-target");
    expect((await api("me", "GET", undefined, moved)).status).toBe(200);
    expect((await api("users/oidc-member/activation?organizationId=oidc-source", "PATCH", { isActive: false }, moved)).status).toBe(200);
    const binding = await api("users/oidc-platform/oidc-identity?organizationId=oidc-target", "PUT", { issuer, subject: "new-platform-subject", expectedIdentity: { issuer, subject: "external-platform" } }, moved);
    expect(binding.status, binding.bodyText).toBe(409);
    expect((await api("me", "GET", undefined, moved)).status).toBe(200);
  });
  it("records signed target authentication through the actual API NOINHERIT login and invalidates old subjects on rebind", async () => {
    const item = await preview();
    expect((await api(path(), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: item.version })).status).toBe(200);
    const rebind = await api("users/oidc-member/oidc-identity?organizationId=oidc-target", "PUT", { issuer, subject: "updated-transferred-member", expectedIdentity: { issuer, subject: "external-member" } });
    expect(rebind.status, rebind.bodyText).toBe(200);
    await db.query("update users set external_tokens_revoked_at=now()-interval '2 seconds' where id='oidc-member'");
    expect((await api("me", "GET", undefined, token("external-member", "oidc-target"))).status).toBe(401);
    const runToken = `sync${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    let apiDb: RootDatabase | undefined;
    try {
      const logins = await provisionPublicationRuntimeLogins(ephemeral.url, { mode: "lab", runToken }); apiDb = createPostgresDatabase(logins.apiUrl);
      const result = await requestJson<AuthContext>(createWiseEffServer({ db: apiDb, env: { AUTH_PROVIDER: "oidc", AUTH_OIDC_ISSUER: issuer }, auth: { mode: "production", verifier: createOidcVerifier({ issuer, audience,
        jwks: { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "transfer-key", alg: "RS256", use: "sig" }] } }) } }), "/api/v1/me", { headers: { Authorization: `Bearer ${token("updated-transferred-member", "oidc-target")}` } });
      expect(result.status, result.bodyText).toBe(200); expect(result.body.user.id).toBe("oidc-member");
      const users = await api<{ items: UserGovernanceDto[] }>("users?organizationId=oidc-target");
      expect(users.body.items.find(user => user.id === "oidc-member")).toMatchObject({ oidcTransfer: { status: "verified", verifiedAt: expect.any(String) } });
    } finally { await apiDb?.close(); expect((await dropLabRuntimeLogins(ephemeral.url, runToken)).failed).toEqual([]); }
  });
  it("serializes concurrent OIDC onboarding and transfer without reversing identity and administrator locks", async () => {
    const item = await preview();
    await db.query(`create function pause_oidc_onboarding() returns trigger language plpgsql as $$ begin
      if new.name='Concurrent OIDC member' then perform pg_advisory_xact_lock(13910001); end if; return new; end $$`);
    await db.query("create trigger zz_pause_oidc_onboarding after insert on users for each row execute function pause_oidc_onboarding()");
    let created!: ReturnType<typeof api>, transferred!: ReturnType<typeof api>;
    const waiting = async () => (await db.query<{ count: number }>(`select count(*)::int as count from pg_stat_activity
      where datname=current_database() and state='active' and wait_event='advisory'`)).rows[0].count;
    await db.transaction(async gate => {
      await gate.query("select pg_advisory_xact_lock(13910001)");
      created = api("users?organizationId=oidc-source", "POST", { authentication: "oidc", issuer, subject: "concurrent-new-subject", name: "Concurrent OIDC member", roles: [{ roleId: "guest" }] });
      await expect.poll(waiting).toBe(1);
      transferred = api(path(), "POST", { targetOrganizationId: "oidc-target", targetRoles: ["guest"], expectedVersion: item.version });
      await expect.poll(waiting).toBe(2);
    });
    const results = await Promise.all([created, transferred]);
    expect(results.map(result => result.status), results.map(result => result.bodyText).join("\n")).toEqual([201, 200]);
  });
});
