import { randomUUID } from "node:crypto";
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
  it("counts unowned knowledge and feedback work with the same eligibility and organization scope as the handover lists", async () => {
    await db.query("delete from project_parameter_initialization_drafts where id='summary-handover'");
    const knowledgeIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.query(`insert into knowledge_entries(id,organization_id,title,content_form,status,created_by_user_id,responsible_user_id) values
      ($1,'summary-target','Unowned draft','markdown','draft','summary-admin','summary-admin'),
      ($2,'summary-target','Assigned draft','markdown','draft','summary-member','summary-member'),
      ($3,'summary-target','Published entry','markdown','published','summary-admin','summary-admin'),
      ($4,'summary-home','Foreign draft','markdown','draft','summary-platform','summary-platform')`, knowledgeIds);
    await db.query("update knowledge_entries set responsible_user_id=null where id=any($1::uuid[])", [[knowledgeIds[0], knowledgeIds[2], knowledgeIds[3]]]);
    const feedbackIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.query(`insert into product_feedback(id,organization_id,submitter_user_id,page_path,page_title,feedback_type,description,status,submitted_at,assignee_user_id) values
      ($1,'summary-target','summary-admin','/organization','Unowned draft','experience','Draft','open',null,null),
      ($2,'summary-target','summary-admin','/organization','Unassigned work','experience','Work','open',now(),null),
      ($3,'summary-target','summary-member','/organization','Assigned draft','experience','Draft','open',null,null),
      ($4,'summary-target','summary-admin','/organization','Resolved work','experience','Work','resolved',now(),null),
      ($5,'summary-home','summary-platform','/organization','Foreign work','experience','Work','open',now(),null)`, feedbackIds);
    await db.query("update product_feedback set draft_owner_user_id=null where id=$1", [feedbackIds[0]]);
    const handoverPaths = ["/api/v1/organization/project-handovers", "/api/v1/knowledge/handovers", "/api/v1/product-feedback/handovers"];
    const pendingCount = async () => {
      const lists = await Promise.all(handoverPaths.map(route => request<{ items: Array<{ pending: boolean }> }>(`${route}?organizationId=summary-target`)));
      for (const list of lists) expect(list.status, list.bodyText).toBe(200);
      return lists.reduce((count, list) => count + list.body.items.filter(item => item.pending).length, 0);
    };
    const readSummary = async () => {
      const result = await request<{ item: OrganizationWorkspaceSummary }>(`${path}?organizationId=summary-target`);
      expect(result.status, result.bodyText).toBe(200);
      return result.body.item;
    };
    expect(await pendingCount()).toBe(3);
    expect((await readSummary()).administration?.pendingHandovers).toBe(3);
    await db.query("update users set is_active=false where id='summary-member'");
    expect(await pendingCount()).toBe(5);
    expect((await readSummary()).administration?.pendingHandovers).toBe(5);
    const administrator = await request<{ item: OrganizationWorkspaceSummary }>(path, "summary-admin");
    expect(administrator.body.item.administration?.pendingHandovers).toBe(5);
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
