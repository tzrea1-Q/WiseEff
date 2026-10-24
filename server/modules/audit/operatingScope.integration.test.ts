import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { requestJson } from "../../test/testClient";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createLocalAuthService } from "../auth/localAuth";
import { hashLocalAccountPassword } from "../auth/localAccountCredentials";
import { insertNotification } from "../notifications/repository";
import type { AuthContext } from "../auth/types";
import type { ListAuditEventsResult } from "./listTypes";

const password = "Scope-check-password-2026";
describe("organization audit, feedback and personal account scope over real HTTP and PostgreSQL", () => {
  let db: RootDatabase, ephemeral: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let server: ReturnType<typeof createWiseEffServer>;
  const tokens: Record<string, string> = {};
  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("audit_operating_scope"); db = createPostgresDatabase(ephemeral.url);
    await seedCoreGraph(db, { organization: { id: "scope-home", name: "Home" }, projects: [{ id: "scope-home-project", name: "Same project" }], users: [{ id: "scope-platform" }, { id: "scope-home-admin" }] });
    await seedCoreGraph(db, { organization: { id: "scope-target", name: "Target" }, projects: [{ id: "scope-target-project", name: "Same project" }], users: [{ id: "scope-target-admin" }] });
    await seedBaselineAuthCatalog(db);
    const hash = await hashLocalAccountPassword(password);
    for (const [id, org, role] of [["platform", "home", "platform-admin"], ["home-admin", "home", "admin"], ["target-admin", "target", "admin"]]) {
      await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values($1,$2,$3,$4)", [`scope-role-${id}`, `scope-${id}`, `scope-${org}`, role]);
      await db.query("insert into user_password_credentials(user_id,username,password_hash) values($1,$1,$2)", [`scope-${id}`, hash]);
    }
    const local = createLocalAuthService(db);
    server = createWiseEffServer({ db, objectStore: createMemoryObjectStore(), env: { AUTH_PROVIDER: "local" }, auth: { mode: "production" }, localAuthService: local });
    for (const id of ["platform", "home-admin", "target-admin"]) tokens[id] = (await local.login({ username: `scope-${id}`, password }, { requestId: "fixture" })).session.token;
  });
  afterEach(async () => { await db?.close(); await ephemeral?.drop(); });
  function request<T = unknown>(path: string, method = "GET", body?: unknown, actor = "platform", token = tokens[actor]) {
    return requestJson<T>(server, `/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const auditBody = { app: "organization", kind: "scope-review", action: "inspect", severity: "Low", targetType: "project", targetId: "scope-target-project", projectId: "scope-target-project", metadata: { actorHomeOrganizationId: "spoof", operatingOrganizationId: "spoof", initiator: "agent" } };
  it("writes and reads the explicit target under the real platform actor while rejecting foreign project references and ordinary administrators", async () => {
    const before = await request<AuthContext>("me");
    const created = await request<{ id: string }>("audit-events?organizationId=scope-target", "POST", auditBody);
    expect(created.status, created.bodyText).toBe(201);
    const target = await request<ListAuditEventsResult>("audit-events?organizationId=scope-target&kind=scope-review");
    expect(target.status).toBe(200);
    expect(target.body.items).toEqual([expect.objectContaining({ id: created.body.id, organizationId: "scope-target", actorUserId: "scope-platform", projectId: "scope-target-project", projectName: "Same project", metadata: { actorHomeOrganizationId: "scope-home", operatingOrganizationId: "scope-target", initiator: "user" } })]);
    expect((await request<ListAuditEventsResult>("audit-events?kind=scope-review")).body.items).toEqual([]);
    expect((await request("me?organizationId=scope-target")).body).toEqual(before.body);
    expect((await request("audit-events?organizationId=scope-target", "POST", auditBody, "home-admin")).status).toBe(403);
    expect((await request("audit-events?organizationId=scope-target", "GET", undefined, "home-admin")).status).toBe(403);
    expect((await request("audit-events?organizationId=scope-home", "POST", auditBody)).status).toBe(404);
    expect((await request("audit-events?organizationId=missing", "POST", auditBody)).status).toBe(404);
    expect((await request("audit-events?organizationId=scope-target&organizationId=scope-home", "POST", auditBody)).status).toBe(400);
  });
  it("keeps feedback queries and writes in the target without replacing its real author", async () => {
    const input = { description: "Same named feedback", pageTitle: "Same page", pagePath: "/knowledge", feedbackType: "experience" };
    const home = await request<{ item: { id: string } }>("product-feedback", "POST", input);
    const target = await request<{ item: { id: string; organizationId: string; submitterUserId: string } }>("product-feedback?organizationId=scope-target", "POST", input);
    expect(target.status, target.bodyText).toBe(201);
    expect(target.body.item).toMatchObject({ organizationId: "scope-target", submitterUserId: "scope-platform" });
    const list = await request<{ items: Array<{ id: string }> }>("product-feedback?organizationId=scope-target");
    expect(list.body.items.map(item => item.id)).toEqual([target.body.item.id]);
    expect((await request(`product-feedback/${home.body.item.id}?organizationId=scope-target`)).status).toBe(404);
    expect((await request("product-feedback?organizationId=scope-target", "GET", undefined, "home-admin")).status).toBe(403);
    const changed = await request<{ item: { description: string; priority: string } }>(`product-feedback/${target.body.item.id}?organizationId=scope-target`, "PATCH", { priority: "high" });
    expect(changed.status).toBe(200); expect(changed.body.item.priority).toBe("high");
    expect((await request(`product-feedback/${target.body.item.id}/progress?organizationId=scope-target`, "POST", { publicMessage: "Target administrator replied" }, "target-admin")).status).toBe(200);
    const notices = await request<{ items: Array<{ actionUrl: string }> }>("notifications?organizationId=scope-target");
    expect(notices.body.items).toContainEqual(expect.objectContaining({ actionUrl: `/feedback?id=${target.body.item.id}&organizationId=scope-target` }));
    const events = await request<ListAuditEventsResult>(`audit-events?organizationId=scope-target&targetId=${target.body.item.id}`);
    expect(events.body.items.length).toBeGreaterThan(0);
    expect(events.body.items.every(item => item.organizationId === "scope-target")).toBe(true);
    expect(events.body.items).toContainEqual(expect.objectContaining({ kind: "product-feedback-progress", actorUserId: "scope-target-admin" }));
    expect(events.body.items).toContainEqual(expect.objectContaining({ kind: "product-feedback-create", actorUserId: "scope-platform" }));
  });
  it("keeps personal notifications, password changes and session revocation with the actual account even with a target query", async () => {
    const homeNotice = "13770000-0000-4000-8000-000000000001", foreignNotice = "13770000-0000-4000-8000-000000000002";
    for (const [id, org, recipient] of [[homeNotice, "home", "platform"], [foreignNotice, "target", "target-admin"]]) {
      await insertNotification(db, { id, organizationId: `scope-${org}`, recipientUserId: `scope-${recipient}`, recipientUserIds: [`scope-${recipient}`], category: "organization", title: "Same notification", body: "Personal message" });
    }
    const notices = await request<{ items: Array<{ id: string; readAt: string | null }> }>("notifications?organizationId=scope-target");
    expect(notices.body.items.map(item => item.id)).toEqual([homeNotice]);
    expect((await request(`notifications/${foreignNotice}/read?organizationId=scope-target`, "POST")).status).toBe(404);
    expect((await request<{ count: number }>("notifications/unread-count?organizationId=scope-target")).body).toEqual({ count: 1 });
    expect((await request("notifications/mark-all-read?organizationId=scope-target", "POST")).status).toBe(200);
    expect((await request<{ items: Array<{ readAt: string | null }> }>("notifications", "GET", undefined, "target-admin")).body.items[0].readAt).toBeNull();
    const local = createLocalAuthService(db), other = (await local.login({ username: "scope-platform", password }, { requestId: "second-session" })).session.token;
    expect((await request("me/password?organizationId=scope-target", "POST", { currentPassword: password, newPassword: "Changed-scope-password-2026" })).status).toBe(200);
    expect((await request("me", "GET", undefined, "platform", other)).status).toBe(401);
    expect((await request<AuthContext>("me?organizationId=scope-target")).body.user.id).toBe("scope-platform");
    expect((await request<AuthContext>("me", "GET", undefined, "target-admin")).body.user.id).toBe("scope-target-admin");
    expect((await request("auth/login", "POST", { username: "scope-target-admin", password })).status).toBe(200);
    expect((await request("auth/logout?organizationId=scope-target", "POST")).status).toBe(200);
    expect((await request("me")).status).toBe(401);
    expect((await request("me", "GET", undefined, "target-admin")).status).toBe(200);
  });
});
