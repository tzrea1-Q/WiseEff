import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createInMemoryTestDatabase } from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import type { OrganizationWorkspaceSummary } from "../contracts/dtoSchemas/organizationWorkspace";

describe("organization workspace summary through HTTP and PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof createInMemoryTestDatabase>>;
  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, { organization: { id: "summary-home", name: "Home" }, users: [{ id: "summary-platform" }], projects: [{ id: "summary-home-project" }] });
    await seedCoreGraph(db, { organization: { id: "summary-target", name: "Target" }, users: [{ id: "summary-admin" }, { id: "summary-member" }], projects: [{ id: "summary-project-1" }, { id: "summary-project-2" }] });
    await seedBaselineAuthCatalog(db);
    await db.query(`insert into user_role_bindings(id,user_id,organization_id,role_id) values
      ('summary-platform-role','summary-platform','summary-home','platform-admin'),('summary-admin-role','summary-admin','summary-target','admin'),('summary-member-role','summary-member','summary-target','hardware-user')`);
    await db.query("insert into organization_teams(id,organization_id,name) values('summary-team','summary-target','Team')");
    await db.query("update user_oidc_identities set issuer='https://summary.example',subject='member',transfer_pending_since=now() where user_id='summary-member'");
    await db.query(`insert into organization_invitations(id,organization_id,label,role_ids,token_hash,expires_at) values
      ('summary-valid','summary-target','Valid','{hardware-user}','summary-valid',now()+interval '1 day'),
      ('summary-expired','summary-target','Expired','{hardware-user}','summary-expired',now()-interval '1 day'),
      ('summary-foreign','summary-home','Foreign','{hardware-user}','summary-foreign',now()+interval '1 day')`);
    await db.query("update projects set initialization_status='initialization_draft' where id='summary-project-1'");
    await db.query(`insert into project_parameter_initialization_drafts(id,organization_id,project_id,project_name,project_code,owner_user_id,created_by_user_id)
      values('summary-handover','summary-target','summary-project-1','Retained draft','SUMMARY',null,'summary-admin')`);
  });
  afterEach(async () => { await db?.rollback(); });
  function request<T>(path: string, user = "summary-platform") {
    return requestJson<T>(createWiseEffServer({ db, env: { AUTH_PROVIDER: "local" } }), path, { headers: { "x-wiseeff-user": user } });
  }
  const path = "/api/v1/organization/workspace-summary";
  it("counts only the explicit target and preserves the real actor home", async () => {
    const result = await request<{ item: OrganizationWorkspaceSummary }>(`${path}?organizationId=summary-target`);
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item).toMatchObject({ organization: { id: "summary-target", name: "Target", status: "active" }, counts: { members: 2, teams: 1, projects: 2 }, administration: { pendingInvitations: 1, pendingHandovers: 1, pendingIdentitySync: 1 } });
    expect((await request<{ item: OrganizationWorkspaceSummary }>(path, "summary-admin")).body.item).toEqual(result.body.item);
    expect((await request<{ organization: { id: string } }>("/api/v1/me")).body.organization.id).toBe("summary-home");
    expect((await request(`${path}?organizationId=summary-home`, "summary-admin")).status).toBe(403);
    expect((await request(`${path}?organizationId=missing`)).status).toBe(404);
  });
  it("gives ordinary members safe real counts without administrative pending work or a new management grant", async () => {
    const result = await request<{ item: OrganizationWorkspaceSummary }>(path, "summary-member");
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body.item.counts).toEqual({ members: 2, teams: 1, projects: 2 });
    expect(result.body.item.administration).toBeNull();
    expect((await request("/api/v1/users", "summary-member")).status).toBe(403);
    expect((await request("/api/v1/organization/invitations", "summary-member")).status).toBe(403);
    expect((await request(`${path}?organizationId=summary-home`, "summary-member")).status).toBe(403);
  });
  it("keeps zero counts honest and remains readable for a suspended organization", async () => {
    await db.query("insert into organizations(id,name) values('summary-empty','Empty')");
    const empty = await request<{ item: OrganizationWorkspaceSummary }>(`${path}?organizationId=summary-empty`);
    expect(empty.body.item.counts).toEqual({ members: 0, teams: 0, projects: 0 });
    await db.query("update organizations set status='suspended' where id='summary-target'");
    const suspended = await request<{ item: OrganizationWorkspaceSummary }>(path, "summary-member");
    expect(suspended.status, suspended.bodyText).toBe(200);
    expect(suspended.body.item.organization.status).toBe("suspended");
    expect(suspended.body.item.counts.projects).toBe(2);
  });
});
