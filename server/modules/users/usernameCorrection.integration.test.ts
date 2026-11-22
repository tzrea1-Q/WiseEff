import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { seedCoreGraph } from "../../testing/fixtures";
import { dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../../testing/labRuntimeLogins";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import type { AuthContext } from "../auth/types";
import type { AuditEventDto } from "../audit/types";
import type { UserGovernanceDto } from "./types";

const home = "correction-home", target = "correction-target", project = "correction-project";
const platform = "correction-platform", admin = "correction-admin", member = "correction-member", external = "correction-external";
const password = "Correction-fixture-password";
const oidcIdentity = { issuer: "https://identity.example", subject: "external-member" };
const runtimeToken = `fix${randomBytes(5).toString("hex")}`;
let ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
let db: ReturnType<typeof createPostgresDatabase>, api: ReturnType<typeof createPostgresDatabase>;

beforeAll(async () => {
  ephemeral = await createEphemeralTestDatabase("username-correction");
  db = createPostgresDatabase(ephemeral.url);
  await seedCoreGraph(db, { organization: { id: home }, users: [{ id: platform }] });
  await seedCoreGraph(db, { organization: { id: target }, users: [{ id: admin }, { id: member }, { id: external }], projects: [{ id: project }] });
  const hash = await hashLocalAccountPassword(password);
  for (const [id, org, role] of [[platform, home, "platform-admin"], [admin, target, "admin"], [member, target, "software-user"], [external, target, "guest"]]) {
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$1,$2,$3)", [id, org, role]);
    if (id !== external) await db.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [id, hash]);
  }
  await db.query("update user_oidc_identities set issuer=$2,subject=$3 where user_id=$1", [external, oidcIdentity.issuer, oidcIdentity.subject]);
  await db.query("insert into project_members(organization_id,project_id,user_id,roles) values($1,$2,$3,array['software-user'])", [target, project, member]);
  api = createPostgresDatabase((await provisionPublicationRuntimeLogins(ephemeral.url, { mode: "lab", runToken: runtimeToken })).apiUrl);
});

afterAll(async () => {
  await api?.close();
  try { if (api) await dropLabRuntimeLogins(ephemeral.url, runtimeToken); }
  finally { await db?.close(); await ephemeral?.drop(); }
});

function request<T = unknown>(path: string, method = "GET", token?: string, body?: unknown) {
  return requestJson<T>(createWiseEffServer({ db: api, env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" } }), `/api/v1/${path}`, {
    method, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

const login = (username: string) => request<{ token: string; auth: AuthContext }>("auth/login", "POST", undefined, { username, password });

it("corrects a local login name in the selected organization without changing identity or existing access", async () => {
  const actor = await login(platform), ordinaryAdmin = await login(admin), original = await login(member);
  expect([actor.status, ordinaryAdmin.status, original.status]).toEqual([200, 200, 200]);
  expect(actor.body.auth.roles).toEqual([{ projectId: null, roleId: "platform-admin" }]);
  const scope = `?organizationId=${target}`, path = `users/${member}/username`, token = actor.body.token;
  const rename = (username: string, auth = token, suffix = scope) => request<{ item: UserGovernanceDto }>(`${path}${suffix}`, "PATCH", auth, { username });
  const projectMembership = () => request<{ projectId: string; members: Array<{ userId: string; username: string; roles: string[] }> }>(`projects/${project}/members${scope}`, "GET", token);
  const before = await projectMembership();
  expect(before.status, before.bodyText).toBe(200);
  expect(before.body.members).toEqual([expect.objectContaining({ userId: member, username: member, roles: ["software-user"] })]);
  const loginHistory = () => request<{ items: AuditEventDto[] }>(`audit-events${scope}&app=auth&kind=auth-event&actorUserId=${member}`, "GET", token);
  const originalHistory = (await loginHistory()).body.items;
  expect(originalHistory).toEqual([expect.objectContaining({ actorUserId: member, organizationId: target, action: "login", targetId: member })]);

  expect((await rename("correction-new", ordinaryAdmin.body.token)).status).toBe(403);
  expect((await rename("correction-new", original.body.token)).status).toBe(403);
  expect((await rename("correction-new", token, `?organizationId=${home}`)).status).toBe(404);
  expect((await rename("invalid name")).status).toBe(400);
  expect((await rename("CORRECTION-PLATFORM")).status).toBe(409);
  expect((await request(`users/${external}/username${scope}`, "PATCH", token, { username: "correction-new" })).status).toBe(404);

  const updated = await rename("CORRECTION-New");
  expect(updated.status, updated.bodyText).toBe(200);
  expect(updated.body.item).toMatchObject({ id: member, username: "correction-new", roles: original.body.auth.roles });
  const { body: directory } = await request<{ items: UserGovernanceDto[] }>(`users${scope}`, "GET", token);
  expect(directory.items).toContainEqual(updated.body.item);
  expect((await projectMembership()).body).toEqual({ ...before.body, members: [{ ...before.body.members[0], username: "correction-new" }] });
  expect((await request<AuthContext>("me", "GET", original.body.token)).body.user.id).toBe(member);
  expect((await login(member)).status).toBe(401);
  const relogin = await login("CORRECTION-NEW");
  expect(relogin.status, relogin.bodyText).toBe(200);
  expect(relogin.body.auth).toMatchObject({ user: { id: member }, roles: original.body.auth.roles });
  expect((await loginHistory()).body.items).toContainEqual(originalHistory[0]);

  const audit = await request<{ items: AuditEventDto[] }>(`audit-events${scope}&app=user-governance&targetType=user&targetId=${member}`, "GET", token);
  expect(audit.body.items).toEqual([expect.objectContaining({ kind: "user-username-correction", actorUserId: platform, organizationId: target, targetId: member,
    metadata: { previousUsername: member, username: "correction-new", actorHomeOrganizationId: home, operatingOrganizationId: target, initiator: "user" } })]);
  expect(audit.bodyText).not.toMatch(/password|scrypt\$|token/i);
});

it("uses the existing organization admin profile authority and preserves the member's OIDC identity", async () => {
  const actor = await login(admin);
  expect(actor.status).toBe(200);
  const token = actor.body.token, path = `users/${external}`;
  expect((await request(path, "PATCH", token, { email: "invalid-email" })).status).toBe(400);
  expect((await request(`${path}?organizationId=${home}`, "PATCH", token, { email: "valid@example.com" })).status).toBe(403);
  const correction = await request<{ item: UserGovernanceDto }>(path, "PATCH", token, { email: "Valid@Example.com" });
  expect(correction.status, correction.bodyText).toBe(200);
  expect(correction.body.item).toMatchObject({ id: external, email: "valid@example.com", username: null, oidcIdentity });
  const directory = await request<{ items: UserGovernanceDto[] }>("users", "GET", token);
  expect(directory.body.items).toContainEqual(correction.body.item);
});
