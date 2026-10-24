import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createWiseEffServer } from "../../app";
import { createDatabase, createPostgresDatabase, type Database, type RootDatabase } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { hashLocalSessionToken } from "../auth/localAccountCredentials";
import type { AuthContext } from "../auth/types";

const password = "Transfer-fixture-password";
type Preview = { version: string; user: { id: string; username: string | null }; platformAdministrator: boolean; supported: boolean; personalAccess: { sessions: number; pairings: number; pairingCodes: number }; retainedWork: { project: number; knowledge: number; feedback: number }; teams: Array<{ id: string }>; projectMemberships: Array<{ projectId: string }>; roles: Array<{ roleId: string; projectId: string | null }> };
describe("local account transfer through real authentication, HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("account_transfer"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: { id: "transfer-home" }, users: [{ id: "transfer-platform" }] });
    await seedCoreGraph(db, { organization: { id: "transfer-source" }, users: [{ id: "transfer-admin" }, { id: "transfer-member" }] });
    await seedCoreGraph(db, { organization: { id: "transfer-target" }, users: [{ id: "transfer-target-admin" }] });
    const hash = await hashLocalAccountPassword(password);
    for (const [id, org, role] of [["platform", "home", "platform-admin"], ["admin", "source", "admin"], ["member", "source", "software-user"], ["target-admin", "target", "admin"]]) {
      await db.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [`transfer-${id}`, hash]);
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`transfer-role-${id}`, `transfer-${id}`, `transfer-${org}`, role]);
    }
  });
  afterEach(async () => { await db?.close(); await ephemeral?.drop(); });
  function api<T = { error: { details: { code: string } } }>(path: string, method = "GET", body?: unknown, token?: string, database: Database = db) {
    return requestJson<T>(createWiseEffServer({ db: database, objectStore: createMemoryObjectStore(), env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" } }), `/api/v1/${path}`, {
      method, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  async function login(id = "platform") { const result = await api<{ token: string; auth: AuthContext }>("auth/login", "POST", { username: `transfer-${id}`, password }); expect(result.status, result.bodyText).toBe(200); return result.body; }
  const path = (id = "member", source = "source") => `platform/organizations/transfer-${source}/members/transfer-${id}/transfer`;
  async function preview(token: string, id = "member", target = "target", source = "source") {
    const result = await api<{ item: Preview }>(`${path(id, source)}-preview`, "POST", { targetOrganizationId: `transfer-${target}` }, token);
    expect(result.status, result.bodyText).toBe(200); return result.body.item;
  }
  it("previews and moves a local identity without carrying old grants or sessions into the target", async () => {
    const platform = await login(), old = await login("member");
    await db.query("insert into organization_teams(id,organization_id,name) values('source-team','transfer-source','Source team')");
    await db.query("insert into organization_team_members(team_id,organization_id,user_id) values('source-team','transfer-source','transfer-member')");
    await db.query("insert into projects(id,organization_id,name,code) values('source-project','transfer-source','Source project','SRC')");
    await db.query("insert into project_members(organization_id,project_id,user_id,roles) values('transfer-source','source-project','transfer-member',array['software-user'])");
    const item = await preview(platform.token);
    expect(item).toMatchObject({ user: { id: "transfer-member", username: "transfer-member" }, supported: true, platformAdministrator: false, teams: [{ id: "source-team" }], projectMemberships: [{ projectId: "source-project" }] });
    const moved = await api(`${path()}`, "POST", { targetOrganizationId: "transfer-target", targetRoles: ["hardware-user"], expectedVersion: item.version }, platform.token);
    expect(moved.status, moved.bodyText).toBe(200);
    expect((await api("me", "GET", undefined, old.token)).status).toBe(401);
    const fresh = await login("member");
    expect(fresh.auth).toMatchObject({ user: { id: "transfer-member" }, organization: { id: "transfer-target" }, roles: [{ projectId: null, roleId: "hardware-user" }], projectMemberships: [] });
    expect((await api("users?organizationId=transfer-source", "GET", undefined, fresh.token)).status).toBe(403);
    const users = await api<{ items: Array<{ id: string }> }>("users?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(users.body.items.map(user => user.id)).not.toContain("transfer-member");
  });
  it("rejects a stale source-organization session even if issued after revocation", async () => {
    const platform = await login(), item = await preview(platform.token);
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: item.version }, platform.token)).status).toBe(200);
    await db.query("insert into auth_sessions(id,user_id,organization_id,token_hash,expires_at) values('stale-source','transfer-member','transfer-source',$1,now()+interval '1 day')", [hashLocalSessionToken("stale-source-token")]);
    expect((await api("me", "GET", undefined, "stale-source-token")).status).toBe(401);
  });
  it("rejects a source password reset overtaken by transfer without changing the target password or sessions", async () => {
    const platform = await login(), admin = await login("admin"), impact = await preview(platform.token);
    const client = new pg.Client({ connectionString: ephemeral.url }); await client.connect();
    let reached!: () => void, release!: () => void, paused = false;
    const read = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const resetDb = createDatabase({ async query(text, values = []) {
      const result = await client.query(text, values);
      if (!paused && text.includes("where users.organization_id = $1 and users.id = $2") && values[1] === "transfer-member") {
        paused = true; reached(); await gate;
      }
      return { rows: result.rows, rowCount: result.rowCount };
    } });
    const resetting = api("users/transfer-member/password", "POST", { password: "Stale-source-reset-password" }, admin.token, resetDb);
    try {
      await read;
      expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: impact.version }, platform.token)).status).toBe(200);
      const target = await login("member");
      release();
      expect((await resetting).status).toBe(404);
      expect((await api("me", "GET", undefined, target.token)).status).toBe(200);
      expect((await login("member")).auth).toMatchObject({ user: { id: "transfer-member", username: "transfer-member" }, organization: { id: "transfer-target" } });
      expect((await api("auth/login", "POST", { username: "transfer-member", password: "Stale-source-reset-password" })).status).toBe(401);
      const targetAdmin = await login("target-admin");
      expect((await api("users/transfer-member/password", "POST", { password: "Authorized-target-password" }, targetAdmin.token)).status).toBe(200);
      expect((await api("me", "GET", undefined, target.token)).status).toBe(401);
      const authorizedLogin = await api<{ auth: AuthContext }>("auth/login", "POST", { username: "transfer-member", password: "Authorized-target-password" });
      expect(authorizedLogin.status).toBe(200);
      expect(authorizedLogin.body.auth).toMatchObject({ user: { id: "transfer-member", username: "transfer-member" }, organization: { id: "transfer-target" } });
    } finally { release(); await resetting; await client.end(); }
  });
  it.each([false, true])("projects source feedback progress only to a still-authorized transferred submitter (platform=%s)", async platformRecipient => {
    if (platformRecipient) await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('feedback-platform','transfer-member','transfer-source','platform-admin')");
    const platform = await login(), member = await login("member"), admin = await login("admin");
    const created = await api<{ item: { id: string; historicalAttribution: unknown } }>("product-feedback", "POST", { pagePath: "/knowledge", pageTitle: "Source work", feedbackType: "experience", description: "Retained source feedback", attachments: [] }, member.token);
    expect(created.status, created.bodyText).toBe(201);
    expect(created.body.item.historicalAttribution).toBeDefined();
    const feedbackId = created.body.item.id;
    const progress = (message: string) => api(`product-feedback/${feedbackId}/progress`, "POST", { publicMessage: message }, admin.token);
    expect((await progress("Same-home progress")).status).toBe(200);
    const original = await api<{ items: Array<{ body: string }> }>("notifications", "GET", undefined, member.token);
    expect(original.body.items).toContainEqual(expect.objectContaining({ body: "Same-home progress" }));
    const impact = await preview(platform.token);
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: impact.version }, platform.token)).status).toBe(200);
    const moved = await login("member");
    expect((await progress("Private source progress after transfer")).status).toBe(200);
    const projected = await api<{ items: Array<{ body: string; actionUrl: string }> }>("notifications", "GET", undefined, moved.token);
    expect(projected.status).toBe(200);
    if (platformRecipient) expect(projected.body.items).toContainEqual(expect.objectContaining({ body: "Private source progress after transfer", actionUrl: `/feedback?id=${feedbackId}&organizationId=transfer-source` }));
    else expect(projected.body.items).toEqual([]);
    expect((await api(`product-feedback/${feedbackId}?organizationId=transfer-source`, "GET", undefined, moved.token)).status).toBe(platformRecipient ? 200 : 403);
    const retained = await api<{ item: { submitterUserId: string; historicalAttribution: unknown } }>(`product-feedback/${feedbackId}`, "GET", undefined, admin.token);
    expect(retained.status).toBe(200);
    expect(retained.body.item).toMatchObject({ submitterUserId: "transfer-member", historicalAttribution: created.body.item.historicalAttribution });
    expect((await db.query("select organization_id from product_feedback where id=$1", [feedbackId])).rows).toEqual([{ organization_id: "transfer-source" }]);
  });
  it("allows explicit platform handover from a suspended source, but refuses a suspended destination before changing access", async () => {
    const platform = await login(), member = await login("member");
    const pairing = await api<{ code: string }>("device-bridges/pairing-codes", "POST", {}, member.token);
    expect(pairing.status, pairing.bodyText).toBe(201);
    await db.query("insert into projects(id,organization_id,name,code) values('paused-project','transfer-source','Paused project','PAUSED')");
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('paused-definition','transfer-source','Paused parameter','','','dts','Module','','','Low')");
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('paused-value','transfer-source','paused-project','paused-definition','0','1')");
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason) values('paused-draft','transfer-source','paused-project','paused-value','transfer-member','1','Retain paused work')");
    for (const org of ["source", "target"]) {
      const stop = await api(`platform/organizations/transfer-${org}/lifecycle`, "PATCH", { status: "suspended", expectedStatus: "active" }, platform.token);
      expect(stop.status, stop.bodyText).toBe(200);
    }
    const rejected = await api(`${path()}-preview`, "POST", { targetOrganizationId: "transfer-target" }, platform.token);
    expect(rejected.status).toBe(403);
    expect((await api("me", "GET", undefined, member.token)).status).toBe(200);
    expect((await api("platform/organizations/transfer-target/lifecycle", "PATCH", { status: "active", expectedStatus: "suspended" }, platform.token)).status).toBe(200);
    const impact = await preview(platform.token);
    expect(impact.personalAccess.pairingCodes).toBe(1);
    const moved = await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: impact.version }, platform.token);
    expect(moved.status, moved.bodyText).toBe(200);
    expect((await api("me", "GET", undefined, member.token)).status).toBe(401);
    expect((await login("member")).auth.organization.id).toBe("transfer-target");
    expect((await db.query("select user_id from parameter_drafts where id='paused-draft'")).rows).toEqual([{ user_id: null }]);
    expect((await db.query("select count(*)::int as n from device_bridge_pairing_codes where user_id='transfer-member'")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select status from organizations where id='transfer-source'")).rows).toEqual([{ status: "suspended" }]);
  });
  it("retains source drafts and immutable history as pending handover even when the moved owner remains a platform administrator", async () => {
    const platform = await login(), member = await login("member");
    const entry = await api<{ item: { id: string; historicalAttribution: unknown } }>("knowledge/entries", "POST", { title: "Original source draft", contentForm: "markdown", tags: [], contentMarkdown: "Unfinished source work" }, member.token);
    expect(entry.status, entry.bodyText).toBe(201);
    const feedback = await api<{ item: { id: string } }>("product-feedback/drafts", "POST", { description: "Source feedback draft", pagePath: "/knowledge", pageTitle: "Original source feedback" }, member.token);
    expect(feedback.status).toBe(201);
    await db.query("insert into projects(id,organization_id,name,code) values('source-project','transfer-source','Source project','SRC')");
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('source-definition','transfer-source','Source parameter','','','dts','Module','','','Low')");
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('source-value','transfer-source','source-project','source-definition','0','1')");
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason) values('source-draft','transfer-source','source-project','source-value','transfer-member','1','Original source work')");
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('moved-platform-role','transfer-member','transfer-source','platform-admin')");
    const before = await api<{ items: Array<{ id: string; historicalAttribution: unknown }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    const historical = before.body.items.find(item => item.id === "source-draft")?.historicalAttribution;
    const impact = await preview(platform.token);
    expect(impact.retainedWork).toEqual({ project: 1, knowledge: 1, feedback: 1 });
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: impact.version }, platform.token)).status).toBe(200);
    const fresh = await login("member");
    expect(fresh.auth.roles).toHaveLength(2);
    expect(fresh.auth.roles).toEqual(expect.arrayContaining([{ projectId: null, roleId: "guest" }, { projectId: null, roleId: "platform-admin" }]));
    const projectWork = await api<{ items: Array<{ id: string; pending: boolean; historicalAttribution: unknown; version: string; responsibleUserId: string | null }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(projectWork.body.items).toContainEqual(expect.objectContaining({ id: "source-draft", responsibleUserId: null, pending: true, historicalAttribution: historical }));
    const pending = projectWork.body.items.find(item => item.id === "source-draft")!;
    const claim = await api("organization/project-handovers/parameter-draft/source-draft?organizationId=transfer-source", "PATCH", { responsibleUserId: "transfer-member", expectedVersion: pending.version }, fresh.token);
    expect(claim.status, claim.bodyText).toBe(200);
    const claimed = await api<{ items: Array<{ id: string; pending: boolean; version: string }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(claimed.body.items).toContainEqual(expect.objectContaining({ id: "source-draft", pending: false }));
    const continued = await api<{ item: { id: string } }>("parameter-drafts?organizationId=transfer-source", "POST", { projectId: "source-project", parameterId: "source-value", targetValue: "3", reason: "Explicit cross-organization takeover continued" }, fresh.token);
    expect(continued.status, continued.bodyText).toBe(201); expect(continued.body.item.id).toBe("source-draft");
    const latest = (await api<{ items: Array<{ id: string; version: string }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token)).body.items.find(item => item.id === "source-draft")!;
    expect((await api("organization/project-handovers/parameter-draft/source-draft?organizationId=transfer-source", "PATCH", { responsibleUserId: "transfer-platform", expectedVersion: latest.version }, platform.token)).status).toBe(200);
    const foreignClaim = await api<{ items: Array<{ id: string; pending: boolean; historicalAttribution: unknown }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(foreignClaim.body.items).toContainEqual(expect.objectContaining({ id: "source-draft", pending: false, historicalAttribution: historical }));
    const knowledge = await api<{ items: Array<{ id: string; pending: boolean }> }>("knowledge/handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(knowledge.body.items).toContainEqual(expect.objectContaining({ id: entry.body.item.id, pending: true }));
    const feedbackWork = await api<{ items: Array<{ id: string; pending: boolean }> }>("product-feedback/handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(feedbackWork.body.items).toContainEqual(expect.objectContaining({ id: feedback.body.item.id, pending: true }));
    const retained = await api<{ item: { organizationId: string; historicalAttribution: unknown } }>(`knowledge/entries/${entry.body.item.id}?organizationId=transfer-source`, "GET", undefined, platform.token);
    expect(retained.body.item).toMatchObject({ organizationId: "transfer-source", historicalAttribution: entry.body.item.historicalAttribution });
  });
  it("rejects a destination identity collision and stale preview before revoking any source access", async () => {
    const platform = await login(), member = await login("member"), item = await preview(platform.token);
    await db.query("update user_oidc_identities set issuer='https://identity.example.test',subject='transfer-member' where user_id='transfer-target-admin'");
    const collision = await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: item.version }, platform.token);
    expect(collision.status, collision.bodyText).toBe(409);
    expect((await api<{ organization: { id: string } }>("me", "GET", undefined, member.token)).body.organization.id).toBe("transfer-source");
    await db.query("update user_oidc_identities set subject='target-admin-subject' where user_id='transfer-target-admin'");
    expect((await api("users/transfer-member/organization-roles?organizationId=transfer-source", "PUT", { roles: ["hardware-user"], expectedRoles: ["software-user"] }, platform.token)).status).toBe(200);
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: item.version }, platform.token)).status).toBe(409);
    expect((await api("me", "GET", undefined, member.token)).status).toBe(200);
  });
  it("rolls back access revocation, identity and grants together when audit storage fails, while organization credentials remain valid", async () => {
    const platform = await login(), member = await login("member");
    await db.query("insert into projects(id,organization_id,name,code) values('rollback-project','transfer-source','Rollback source project','ROLLBACK')");
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('rollback-definition','transfer-source','Retained rollback parameter','','','dts','Module','','','Low')");
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('rollback-value','transfer-source','rollback-project','rollback-definition','0','1')");
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason) values('rollback-draft','transfer-source','rollback-project','rollback-value','transfer-member','1','Retained on failed transfer')");
    const machine = await api<{ token: string }>("log-integration-credentials?organizationId=transfer-source", "POST", { name: "Source pipeline", skillId: null }, platform.token);
    expect(machine.status).toBe(201);
    const code = await api<{ code: string }>("device-bridges/pairing-codes", "POST", {}, member.token);
    expect(code.status).toBe(201);
    const impact = await preview(platform.token);
    await db.query("create function reject_transfer_audit() returns trigger language plpgsql as $$ begin if new.kind='account-transfer' then raise exception 'audit unavailable'; end if; return new; end $$");
    await db.query("create trigger reject_transfer_audit before insert on audit_events for each row execute function reject_transfer_audit()");
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: impact.version }, platform.token)).status).toBe(500);
    expect((await api<{ organization: { id: string } }>("me", "GET", undefined, member.token)).body.organization.id).toBe("transfer-source");
    const retained = await api<{ items: Array<{ id: string; responsibleUserId: string | null }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(retained.body.items).toContainEqual(expect.objectContaining({ id: "rollback-draft", responsibleUserId: "transfer-member" }));
    await db.query("drop trigger reject_transfer_audit on audit_events");
    const retry = await preview(platform.token);
    expect(retry.personalAccess).toEqual({ sessions: 1, pairings: 0, pairingCodes: 1 });
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: retry.version }, platform.token)).status).toBe(200);
    expect((await api("device-bridges/pair", "POST", { code: code.body.code, machineLabel: "Old source PC", platform: "linux", arch: "amd64" })).status).toBe(400);
    expect((await api("log-files", "POST", { fileName: "source.log", contentType: "text/plain", contentBase64: Buffer.from("INFO retained machine\n").toString("base64") }, machine.body.token)).status).toBe(201);
    const audit = await api<{ items: Array<{ kind: string; actorUserId: string; organizationId: string; metadata: Record<string, unknown> }> }>("audit-events?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(audit.body.items).toContainEqual(expect.objectContaining({ kind: "account-transfer", actorUserId: "transfer-platform", organizationId: "transfer-source", metadata: expect.objectContaining({ sourceOrganizationId: "transfer-source", targetOrganizationId: "transfer-target", actorHomeOrganizationId: "transfer-home" }) }));
  });
  it("keeps a usable source organization administrator when concurrent transfers compete, and preserves the last global platform administrator on self transfer", async () => {
    const platform = await login();
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('second-source-admin','transfer-member','transfer-source','admin')");
    const first = await preview(platform.token, "admin"), second = await preview(platform.token);
    const outcomes = await Promise.all([
      api(path("admin"), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: first.version }, platform.token),
      api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: second.version }, platform.token)
    ]);
    expect(outcomes.map(result => result.status).sort()).toEqual([200, 409]);
    const denied = outcomes.find(result => result.status === 409)!;
    expect(denied.body.error.details.code).toBe("last-organization-administrator");
    const self = await preview(platform.token, "platform", "target", "home");
    expect((await api(path("platform", "home"), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: self.version }, platform.token)).status).toBe(200);
    const fresh = await login();
    expect(fresh.auth.organization.id).toBe("transfer-target");
    expect(fresh.auth.roles).toContainEqual({ projectId: null, roleId: "platform-admin" });
    expect((await api("platform/organizations", "GET", undefined, fresh.token)).status).toBe(200);
    expect((await api("me", "GET", undefined, platform.token)).status).toBe(401);
  });
  it("does not let ordinary administrators transfer accounts, forge platform grants or move an externally bound identity through the local workflow", async () => {
    const platform = await login(), admin = await login("admin"), item = await preview(platform.token);
    expect((await api(`${path()}-preview`, "POST", { targetOrganizationId: "transfer-target" }, admin.token)).status).toBe(403);
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: item.version }, admin.token)).status).toBe(403);
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["platform-admin"], expectedVersion: item.version }, platform.token)).status).toBe(400);
    await db.query("update user_oidc_identities set issuer='https://identity.example.test',subject='external-member' where user_id='transfer-member'");
    const external = await preview(platform.token);
    expect(external.supported).toBe(false);
    expect((await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: external.version }, platform.token)).status).toBe(409);
    expect((await login("member")).auth.organization.id).toBe("transfer-source");
  });
  it("releases all stages of one request without stale-version conflicts, preserving the submitter and recorded history", async () => {
    const platform = await login();
    await db.query("insert into projects(id,organization_id,name,code) values('staged-project','transfer-source','Staged source project','STAGED')");
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('staged-definition','transfer-source','Staged parameter','','','dts','Module','','','Low')");
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('staged-value','transfer-source','staged-project','staged-definition','0','1')");
    await db.query(`insert into parameter_change_requests(id,organization_id,project_id,project_parameter_value_id,parameter_definition_id,base_version,current_value,target_value,status,submitter_user_id,assigned_to_user_id,workflow_hardware_committer_user_id,workflow_software_committer_user_id,workflow_software_user_id)
      values('staged-request','transfer-source','staged-project','staged-value','staged-definition',1,'0','2','hardware_review','transfer-admin','transfer-member','transfer-member','transfer-member','transfer-member')`);
    const before = await api<{ items: Array<{ id: string; kind: string; historicalAttribution: unknown }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(before.body.items).toHaveLength(3);
    const impact = await preview(platform.token);
    const moved = await api(path(), "POST", { targetOrganizationId: "transfer-target", targetRoles: ["guest"], expectedVersion: impact.version }, platform.token);
    expect(moved.status, moved.bodyText).toBe(200);
    const after = await api<{ items: Array<{ id: string; kind: string; responsibleUserId: string | null; pending: boolean; submitterUserId: string | null; historicalAttribution: unknown }> }>("organization/project-handovers?organizationId=transfer-source", "GET", undefined, platform.token);
    expect(after.body.items).toHaveLength(3);
    expect(after.body.items.map(item => item.kind).sort()).toEqual(["hardware-review", "software-merge", "software-review"]);
    for (const item of after.body.items) expect(item).toMatchObject({ responsibleUserId: null, pending: true, submitterUserId: "transfer-admin", historicalAttribution: before.body.items.find(previous => previous.kind === item.kind)?.historicalAttribution });
  });
});
