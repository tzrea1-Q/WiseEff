import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase, createInMemoryTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createOidcVerifier } from "../auth/oidcVerifier";
import type { AuthContext } from "../auth/types";

const home = { id: "directory-home", name: "Platform home" };
const issuer = "https://directory-identity.example", pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
function oidcToken(subject: string, organizationId: string) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "directory-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: "directory", sub: subject, organization_id: organizationId, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pair.privateKey).toString("base64url")}`;
}
type Organization = { id: string; name: string; status: "active"; createdAt: string; administrators: Array<{ id: string; name: string; isActive: boolean }> };
const localInput = { name: "New collaboration space", initialAdministrator: { name: "Initial administrator", username: "new-admin", password: "new-admin-password" } };
async function fixture(options: { oidc?: boolean; concurrent?: boolean } = {}) {
  const ephemeral = options.concurrent ? await createEphemeralTestDatabase("directory") : null;
  const db = ephemeral ? createPostgresDatabase(ephemeral.url) : await createInMemoryTestDatabase();
  await seedCoreGraph(db, { organization: home, users: [{ id: "directory-platform" }, { id: "directory-org-admin" }] });
  await seedBaselineAuthCatalog(db);
  await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
    ('directory-platform-role','directory-platform',$1,'platform-admin'),('directory-admin-role','directory-org-admin',$1,'admin')`, [home.id]);
  const passwordHash = await hashLocalAccountPassword("fixture-password");
  await db.query("insert into user_password_credentials(user_id,username,password_hash) values('directory-platform','platform',$1),('directory-org-admin','org-admin',$1)", [passwordHash]);
  if (options.oidc) await db.query("update user_oidc_identities set issuer=$1,subject=user_id where organization_id=$2", [issuer, home.id]);
  let bearerToken = options.oidc ? oidcToken("directory-platform", home.id) : "";
  const request = <T,>(path: string, method = "GET", body?: unknown, bearer = bearerToken) => requestJson<T>(createWiseEffServer({ db,
    env: options.oidc ? { AUTH_PROVIDER: "oidc", AUTH_OIDC_ISSUER: `${issuer}/` } : { AUTH_PROVIDER: "local", AUTH_LOCAL_SELF_REGISTER: false },
    auth: { mode: "production", ...(options.oidc ? { verifier: createOidcVerifier({ issuer, audience: "directory", jwks: { keys: [{ ...pair.publicKey.export({ format: "jwk" }), kid: "directory-key", alg: "RS256", use: "sig" }] } }) } : {}) }
  }), path, { method, headers: { Authorization: `Bearer ${bearer}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!options.oidc) bearerToken = (await request<{ token: string }>("/api/v1/auth/login", "POST", { username: "platform", password: "fixture-password" })).body.token;
  return { db, request, close: async () => {
    if ("close" in db) { await db.close(); await ephemeral!.drop(); }
    else await db.rollback();
  } };
}

describe("platform Organization directory through real HTTP and PostgreSQL", () => {
  it("creates an Organization with a usable initial administrator and keeps the platform actor in their Home organization", async () => {
    const h = await fixture();
    try {
      const created = await h.request<{ item: Organization }>("/api/v1/platform/organizations", "POST", localInput);
      expect(created.status).toBe(201);
      expect(created.body.item).toMatchObject({ name: localInput.name, status: "active", administrators: [{ name: "Initial administrator", isActive: true }] });
      const login = await h.request<{ token: string; auth: AuthContext }>("/api/v1/auth/login", "POST", { username: "new-admin", password: "new-admin-password" });
      expect(login.status).toBe(200);
      expect(login.body.auth.organization.id).toBe(created.body.item.id);
      expect(login.body.auth.roles).toEqual([{ roleId: "admin", projectId: null }]);
      const profile = await h.request<{ organization: Organization }>("/api/v1/organization", "GET", undefined, login.body.token);
      expect(profile.body.organization).toMatchObject({ id: created.body.item.id, name: localInput.name });
      expect((await h.request<AuthContext>("/api/v1/me")).body.organization).toEqual(home);
      const directory = await h.request<{ items: Organization[] }>("/api/v1/platform/organizations?q=collaboration");
      expect(directory.body.items).toEqual([created.body.item]);
      expect((await h.request<{ item: Organization }>(`/api/v1/platform/organizations/${created.body.item.id}`)).body.item).toEqual(created.body.item);
      expect((await h.request<{ items: Organization[] }>(`/api/v1/platform/organizations?q=${created.body.item.id}`)).body.items).toEqual([created.body.item]);
      const audit = await h.request<{ items: Array<Record<string, unknown>> }>("/api/v1/audit-events?kind=organization-create", "GET", undefined, login.body.token);
      expect(audit.body.items).toEqual([expect.objectContaining({ actorUserId: "directory-platform", organizationId: created.body.item.id,
        metadata: expect.objectContaining({ actorHomeOrganizationId: home.id, operatingOrganizationId: created.body.item.id }) })]);
    } finally { await h.close(); }
  });

  it("rejects non-platform actors and malformed input without changing the directory", async () => {
    const h = await fixture();
    try {
      const before = (await h.request<{ items: Organization[] }>("/api/v1/platform/organizations")).body.items;
      const ordinary = (await h.request<{ token: string }>("/api/v1/auth/login", "POST", { username: "org-admin", password: "fixture-password" })).body.token;
      for (const [path, method, body] of [["/api/v1/platform/organizations", "GET"], ["/api/v1/platform/organizations/directory-home", "GET"], ["/api/v1/platform/organizations", "POST", localInput]] as const) {
        expect((await h.request(path, method, body, ordinary)).status).toBe(403);
      }
      for (const input of [{ ...localInput, name: " " }, { ...localInput, initialAdministrator: { ...localInput.initialAdministrator, username: "bad username" } },
        { ...localInput, initialAdministrator: { ...localInput.initialAdministrator, roles: [{ roleId: "platform-admin" }] } }]) {
        expect((await h.request("/api/v1/platform/organizations", "POST", input)).status).toBe(400);
      }
      expect((await h.request("/api/v1/platform/organizations?q=a&q=b")).status).toBe(400);
      expect((await h.request("/api/v1/platform/organizations/missing")).status).toBe(404);
      expect((await h.request<{ items: Organization[] }>("/api/v1/platform/organizations")).body.items).toEqual(before);
    } finally { await h.close(); }
  });

  it("rolls the entire Organization back on credential collision and on audit failure", async () => {
    const h = await fixture();
    try {
      const conflict = await h.request("/api/v1/platform/organizations", "POST", { ...localInput, initialAdministrator: { ...localInput.initialAdministrator, username: "PLATFORM" } });
      expect(conflict.status).toBe(409);
      expect((await h.request<{ items: Organization[] }>("/api/v1/platform/organizations?q=collaboration")).body.items).toEqual([]);
      await h.db.query("create function reject_directory_audit() returns trigger language plpgsql as $$ begin if new.kind='organization-create' then raise exception 'audit unavailable'; end if; return new; end $$");
      await h.db.query("create trigger reject_directory_audit before insert on audit_events for each row execute function reject_directory_audit()");
      expect((await h.request("/api/v1/platform/organizations", "POST", localInput)).status).toBe(500);
      expect((await h.request<{ items: Organization[] }>("/api/v1/platform/organizations?q=collaboration")).body.items).toEqual([]);
      expect((await h.request("/api/v1/auth/login", "POST", { username: "new-admin", password: "new-admin-password" })).status).toBe(401);
      await h.db.query("drop trigger reject_directory_audit on audit_events");
      expect((await h.request("/api/v1/platform/organizations", "POST", localInput)).status).toBe(201);
    } finally { await h.close(); }
  });

  it("creates only one complete Organization when two requests compete for the same local username", async () => {
    const h = await fixture({ concurrent: true });
    try {
      const responses = await Promise.all([h.request("/api/v1/platform/organizations", "POST", localInput), h.request("/api/v1/platform/organizations", "POST", localInput)]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const directory = await h.request<{ items: Organization[] }>("/api/v1/platform/organizations?q=collaboration");
      expect(directory.body.items).toHaveLength(1);
      expect(directory.body.items[0].administrators).toHaveLength(1);
      expect((await h.request("/api/v1/auth/login", "POST", { username: "new-admin", password: "new-admin-password" })).status).toBe(200);
    } finally { await h.close(); }
  });

  it("provisions an explicit OIDC initial administrator for the new Organization, with no local login or JIT", async () => {
    const h = await fixture({ oidc: true });
    try {
      expect((await h.request("/api/v1/platform/organizations", "POST", localInput)).status).toBe(400);
      const input = { name: "OIDC organization", initialAdministrator: { authentication: "oidc", issuer, subject: "external-initial-admin", name: "OIDC administrator" } };
      expect((await h.request("/api/v1/platform/organizations", "POST", { ...input, initialAdministrator: { ...input.initialAdministrator, issuer: "https://wrong.example" } })).status).toBe(400);
      expect((await h.request<{ items: Organization[] }>("/api/v1/platform/organizations?q=OIDC")).body.items).toEqual([]);
      const created = await h.request<{ item: Organization }>("/api/v1/platform/organizations", "POST", input);
      expect(created.status).toBe(201);
      const organizationId = created.body.item.id, bearer = oidcToken("external-initial-admin", organizationId);
      const me = await h.request<AuthContext>("/api/v1/me", "GET", undefined, bearer);
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ user: { id: created.body.item.administrators[0].id, organizationId }, roles: [{ projectId: null, roleId: "admin" }] });
      expect((await h.request<{ organization: Organization }>("/api/v1/organization", "GET", undefined, bearer)).body.organization.name).toBe("OIDC organization");
      expect((await h.request("/api/v1/me", "GET", undefined, oidcToken("unprovisioned", organizationId))).status).toBe(401);
      expect((await h.request("/api/v1/me", "GET", undefined, oidcToken("external-initial-admin", home.id))).status).toBe(401);
      expect((await h.request("/api/v1/platform/organizations", "GET", undefined, bearer)).status).toBe(403);
      expect((await h.request<AuthContext>("/api/v1/me")).body.user.organizationId).toBe(home.id);
    } finally { await h.close(); }
  });

  it("recovers a memberless Organization with an explicit OIDC administrator and retains the provider Organization claim boundary", async () => {
    const h = await fixture({ oidc: true });
    try {
      await h.db.query("insert into organizations(id,name) values('oidc-recovery-empty','OIDC recovery')");
      const response = await h.request<{ item: Organization }>("/api/v1/platform/organizations/oidc-recovery-empty/administrator-recovery", "POST", {
        administrator: { authentication: "oidc", issuer, subject: "external-replacement-admin", name: "OIDC replacement" }
      });
      expect(response.status).toBe(200);
      const me = await h.request<AuthContext>("/api/v1/me", "GET", undefined, oidcToken("external-replacement-admin", "oidc-recovery-empty"));
      expect(me.status).toBe(200);
      expect(me.body.roles).toEqual([{ projectId: null, roleId: "admin" }]);
      expect((await h.request("/api/v1/me", "GET", undefined, oidcToken("external-replacement-admin", home.id))).status).toBe(401);
    } finally { await h.close(); }
  });
});
