import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { randomBytes } from "node:crypto";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { lockAdministratorMutation } from "./administratorContinuity";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";

describe("Durable empty Organization erasure through HTTP and PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("empty_erasure"); db = createPostgresDatabase(database.url);
    await seedCoreGraph(db, { organization: { id: "erasure-home" }, users: [{ id: "erasure-platform" }] });
    await seedCoreGraph(db, { organization: { id: "erasure-target", name: "Business name must disappear" }, users: [{ id: "erasure-member" }, { id: "erasure-inactive", isActive: false }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('erasure-platform-role','erasure-platform','erasure-home','platform-admin'),('erasure-member-role','erasure-member','erasure-target','admin'),('erasure-inactive-role','erasure-inactive','erasure-target','platform-admin')");
    await db.query("insert into organization_teams(id,organization_id,name) values('erasure-team','erasure-target','Secret team')");
    await db.query("insert into organization_team_members(organization_id,team_id,user_id) values('erasure-target','erasure-team','erasure-member')");
    await db.query("insert into organization_invitations(id,organization_id,label,role_ids,token_hash,expires_at,created_by_user_id) values('erasure-invitation','erasure-target','Secret invitation',array['guest'],'hash',now()+interval '1 day','erasure-member')");
    await db.query("insert into audit_events(id,organization_id,actor_user_id,actor_type,app,kind,action,severity,target_type,target_id,trace_id,metadata) values('erasure-create-audit','erasure-target','erasure-member','user','user-governance','organization-create','create','High','organization','erasure-target','trace','{\"name\":\"Secret audit payload\"}')");
  });
  afterEach(async () => { await db?.close(); await database?.drop(); });
  const target = "/api/v1/platform/organizations/erasure-target";
  async function request<T>(path: string, method = "GET", body?: unknown, user = "erasure-platform") {
    return requestJson<T>(createWiseEffServer({ db }), path, { method, headers: { "x-wiseeff-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function start() {
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    return request<{ item: { id: string; status: string; actorUserId: string; targetOrganizationId: string } }>(`${target}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "erasure-target" });
  }
  it("really erases management records and inactive platform accounts, retaining only an independent minimal receipt", async () => {
    await db.query("insert into knowledge_entries(id,organization_id,title,content_form,created_by_user_id) values('00000000-0000-4000-8000-000000000095','erasure-home','Foreign knowledge must remain','markdown','erasure-inactive')");
    const foreignHistory = (await db.query("select historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000095'")).rows;
    const result = await start(); expect(result.status, result.bodyText).toBe(202);
    expect(result.body.item).toMatchObject({ status: "deleted", actorUserId: "erasure-platform", targetOrganizationId: "erasure-target" });
    for (const table of ["organizations", "users", "organization_teams", "organization_invitations", "user_role_bindings", "audit_events"]) {
      const column = table === "organizations" ? "id" : "organization_id";
      expect((await db.query(`select count(*)::int n from ${table} where ${column}='erasure-target'`)).rows).toEqual([{ n: 0 }]);
    }
    expect((await db.query("select count(*)::int n from users where id='erasure-platform'")).rows).toEqual([{ n: 1 }]);
    expect((await db.query("select title,created_by_user_id from knowledge_entries where id='00000000-0000-4000-8000-000000000095'")).rows).toEqual([{ title: "Foreign knowledge must remain", created_by_user_id: null }]);
    expect((await db.query("select historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000095'")).rows).toEqual(foreignHistory);
    const receipt = await request<{ item: unknown }>(`/api/v1/platform/organization-deletions/${result.body.item.id}`);
    expect(receipt.status).toBe(200); expect(receipt.body.item).toEqual(result.body.item);
    expect(JSON.stringify(receipt.body)).not.toMatch(/Business name|Secret|token|password|hash/);
  });
  it("retains a failed intent and refuses writes, maintenance, completion and restore until an authorized retry finishes", async () => {
    await db.query("update users set is_active=true where id='erasure-inactive'");
    await db.query(`create function fail_erasure_management() returns trigger language plpgsql as $$ begin raise exception 'temporary management storage failure'; end $$;
      create trigger test_erasure_failure before delete on organization_teams for each row execute function fail_erasure_management()`);
    const started = await start(); expect(started.status, started.bodyText).toBe(202);
    expect(started.body.item.status).toBe("failed");
    expect((await db.query("select status from organizations where id='erasure-target'")).rows).toEqual([{ status: "deleting" }]);
    expect((await db.query<{ is_active: boolean }>("select is_active from users where organization_id='erasure-target'")).rows.every(row => row.is_active === false)).toBe(true);
    expect((await request("/api/v1/platform/organizations/erasure-home/administrators/erasure-platform/emergency-disable", "POST", { reason: "A target platform account cannot be a surviving login" })).status).toBe(409);
    expect((await request("/api/v1/platform/organization-deletions", "GET", undefined, "erasure-inactive")).status).toBe(403);
    await expect(db.query("update users set name='new name' where id='erasure-member'")).rejects.toMatchObject({ code: "55000" });
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('wiseeff.lifecycle_maintenance_org','erasure-target',true)");
      await tx.query("insert into organization_teams(id,organization_id,name) values('late-team','erasure-target','Late')");
    })).rejects.toMatchObject({ code: "55000" });
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('wiseeff.lifecycle_completion',$1,true)", [JSON.stringify({ organizationId: "erasure-target", kind: "knowledge-index", entryId: "late" })]);
      await tx.query("insert into knowledge_entries(id,organization_id,title,content_form) values('00000000-0000-4000-8000-000000000094','erasure-target','Late','markdown')");
    })).rejects.toMatchObject({ code: "55000" });
    expect((await request(`${target}/lifecycle`, "PATCH", { expectedStatus: "deleting", status: "active" })).status).toBe(400);
    await expect(db.query("update organizations set status='active' where id='erasure-target'")).rejects.toMatchObject({ code: "55000" });
    await db.query("drop trigger test_erasure_failure on organization_teams");
    const retried = await request<{ item: { status: string; attempts: number } }>(`/api/v1/platform/organization-deletions/${started.body.item.id}/retry`, "POST");
    expect(retried.status, retried.bodyText).toBe(200); expect(retried.body.item).toMatchObject({ status: "deleted", attempts: 2 });
    await expect(db.query("insert into organizations(id,name) values('erasure-target','Resurrect')")).rejects.toMatchObject({ code: "55000" });
    await expect(db.query("insert into users(id,organization_id,name,title) values('unknown-owner','missing-owner','Unknown','Member')")).rejects.toMatchObject({ code: "23503" });
  });
  it("resumes after server restart when the Organization and all target accounts have already vanished", async () => {
    await db.query(`create function fail_erasure_receipt() returns trigger language plpgsql as $$ begin
      if new.status='deleted' then raise exception 'temporary receipt persistence failure'; end if; return new; end $$;
      create trigger test_receipt_failure before update on organization_erasures for each row execute function fail_erasure_receipt()`);
    const result = await start(); expect(result.body.item.status).toBe("failed");
    expect((await db.query("select count(*)::int n from organizations where id='erasure-target'")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select count(*)::int n from users where organization_id='erasure-target'")).rows).toEqual([{ n: 0 }]);
    // Persist the interrupted-worker state a process crash leaves behind.
    await db.query("update organization_erasures set status='running',lease_owner='stopped-process',lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [result.body.item.id]);
    await db.close(); db = createPostgresDatabase(database.url);
    const receiptPath = `/api/v1/platform/organization-deletions/${result.body.item.id}`;
    expect((await request(receiptPath)).status).toBe(200);
    await db.query("delete from user_role_bindings where user_id='erasure-platform'");
    expect((await request(`${receiptPath}/retry`, "POST")).status).toBe(403);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('fresh-platform-role','erasure-platform','erasure-home','platform-admin')");
    await db.query("drop trigger test_receipt_failure on organization_erasures");
    const retried = await request<{ item: { status: string } }>(`${receiptPath}/retry`, "POST");
    expect(retried.status, retried.bodyText).toBe(200); expect(retried.body.item.status).toBe("deleted");
    expect((await request<{ item: unknown }>(`${receiptPath}/retry`, "POST")).body).toEqual(retried.body);
  });
  it("rejects nonempty and unknown ownership before intent, account revocation or destruction", async () => {
    await db.query("insert into projects(id,organization_id,name,code) values('nonempty','erasure-target','Keep project','KEEP')");
    expect((await start()).status).toBe(409);
    expect((await db.query("select count(*)::int n from organization_erasures")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select is_active from users where id='erasure-member'")).rows).toEqual([{ is_active: true }]);
    await db.query("delete from projects where id='nonempty'");
    await db.query("create table unknown_erasure_owner(id text,organization_id text)");
    expect((await start()).status).toBe(409);
    expect((await db.query("select status from organizations where id='erasure-target'")).rows).toEqual([{ status: "active" }]);
  });
  it("refuses unsupported global erasure provenance before intent even when its operator Home is foreign", async () => {
    await db.query("insert into audit_events(id,organization_id,actor_user_id,actor_type,app,kind,action,severity,target_type,target_id,trace_id,metadata) values('global-erasure-proof',null,'erasure-platform','user','parameter-admin','parameter-definition','delete','High','organization','erasure-target','global-trace','{\"operatingOrganizationId\":\"erasure-target\",\"proof\":\"Retain global fact\"}')");
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id) values('global-definition-identity','erasure-home','erasure-platform','global-erasure-proof')");
    const result = await start(); expect(result.status, result.bodyText).toBe(409);
    expect((await db.query("select count(*)::int n from organization_erasures")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select is_active from users where id='erasure-member'")).rows).toEqual([{ is_active: true }]);
    expect((await db.query("select metadata->>'proof' proof from audit_events where id='global-erasure-proof'")).rows).toEqual([{ proof: "Retain global fact" }]);
    expect((await db.query("select audit_event_id from parameter_catalog.definition_erasures where definition_id='global-definition-identity'")).rows).toEqual([{ audit_event_id: "global-erasure-proof" }]);
  });
  it("refuses a target audit retained as a foreign-Home global Definition erasure proof before intent", async () => {
    await db.query("insert into parameter_catalog.definition_erasures(definition_id,organization_id,erased_by,audit_event_id) values('foreign-global-definition','erasure-home','erasure-platform','erasure-create-audit')");
    const result = await start(); expect(result.status, result.bodyText).toBe(409);
    expect((await db.query("select count(*)::int n from organization_erasures")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select metadata->>'name' name from audit_events where id='erasure-create-audit'")).rows).toEqual([{ name: "Secret audit payload" }]);
  });
  it("accepts a suspended management-only Organization without treating suspension exceptions as erasure authority", async () => {
    await db.query("update organizations set status='suspended' where id='erasure-target'");
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
  });
  it("keeps suspended foreign business content and frozen authorship when a target account is removed", async () => {
    await db.query("insert into knowledge_entries(id,organization_id,title,content_form,created_by_user_id) values('00000000-0000-4000-8000-000000000096','erasure-home','Suspended foreign knowledge','markdown','erasure-inactive')");
    const history = (await db.query("select historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000096'")).rows;
    await db.query("update organizations set status='suspended' where id='erasure-home'");
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
    expect((await db.query("select title,created_by_user_id from knowledge_entries where id='00000000-0000-4000-8000-000000000096'")).rows).toEqual([{ title: "Suspended foreign knowledge", created_by_user_id: null }]);
    expect((await db.query("select historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000096'")).rows).toEqual(history);
  });
  it("retains a suspended foreign project draft and its original execution when its current account is deleted", async () => {
    await db.query("insert into projects(id,organization_id,name,code) values('foreign-project','erasure-home','Foreign project','FOREIGN')");
    await db.query("insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk) values('foreign-definition','erasure-home','Foreign parameter','','','dts','Module','','','Low')");
    await db.query("insert into project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value) values('foreign-value','erasure-home','foreign-project','foreign-definition','0','1')");
    await db.query("insert into parameter_drafts(id,organization_id,project_id,project_parameter_value_id,user_id,target_value,reason) values('foreign-draft','erasure-home','foreign-project','foreign-value','erasure-inactive','1','Foreign draft content')");
    const history = (await db.query("select target_value,reason,updated_at,historical_attribution from parameter_drafts where id='foreign-draft'")).rows;
    await db.query("update organizations set status='suspended' where id='erasure-home'");
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
    expect((await db.query("select user_id,initiator_type from parameter_drafts where id='foreign-draft'")).rows).toEqual([{ user_id: null, initiator_type: "legacy" }]);
    expect((await db.query("select target_value,reason,updated_at,historical_attribution from parameter_drafts where id='foreign-draft'")).rows).toEqual(history);
  });
  it.each(["user", "agent"])("retains a suspended foreign DTS revision's %s execution using its existing deleted-principal projection", async initiator => {
    await db.query("insert into projects(id,organization_id,name,code) values('foreign-dts-project','erasure-home','Foreign DTS','DTS')");
    await db.query("insert into dts_config_set(id,organization_id,project_id,name) values('foreign-dts-set','erasure-home','foreign-dts-project','Retain configuration')");
    await db.query("insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status,created_by_user_id,initiator_type,initiator_session_id,initiator_tool_call_id,initiator_approval_id) values('foreign-dts-revision','erasure-home','foreign-dts-project','foreign-dts-set',1,'draft','erasure-inactive',$1,$2,$3,$4)", [initiator, initiator === "agent" ? "retained-session" : null, initiator === "agent" ? "retained-tool" : null, initiator === "agent" ? "retained-approval" : null]);
    const history = (await db.query("select status,created_at,manifest_state,historical_attribution from dts_config_revisions where id='foreign-dts-revision'")).rows;
    await db.query("update organizations set status='suspended' where id='erasure-home'");
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
    expect((await db.query("select created_by_user_id,initiator_type,initiator_principal_deleted,initiator_session_id from dts_config_revisions where id='foreign-dts-revision'")).rows).toEqual([{ created_by_user_id: null, initiator_type: initiator === "agent" ? "agent" : "legacy", initiator_principal_deleted: initiator === "agent", initiator_session_id: initiator === "agent" ? "retained-session" : null }]);
    expect((await db.query("select status,created_at,manifest_state,historical_attribution from dts_config_revisions where id='foreign-dts-revision'")).rows).toEqual(history);
  });
  it("refuses a foreign FK detachment that would rewrite business timestamps or content", async () => {
    await db.query("insert into knowledge_entries(id,organization_id,title,content_form,created_by_user_id) values('00000000-0000-4000-8000-000000000097','erasure-home','Retained foreign content','markdown','erasure-inactive')");
    const before = (await db.query("select title,updated_at,historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000097'")).rows;
    await db.query("update organizations set status='suspended' where id='erasure-home'");
    await db.query(`create function change_foreign_before_detach() returns trigger language plpgsql as $$ begin
      if old.created_by_user_id is not null and new.created_by_user_id is null then new.updated_at:=clock_timestamp(); new.title:='Wrong title'; end if; return new; end $$;
      create trigger ab_change_foreign before update on knowledge_entries for each row execute function change_foreign_before_detach()`);
    const result = await start(); expect(result.body.item.status).toBe("failed");
    expect((await db.query("select title,updated_at,historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000097'")).rows).toEqual(before);
    expect((await db.query("select count(*)::int n from users where organization_id='erasure-target'")).rows).toEqual([{ n: 2 }]);
    await db.query("drop trigger ab_change_foreign on knowledge_entries");
    const lease = "ordinary-update-must-not-use-erasure";
    await expect(db.transaction(async tx => {
      await tx.query("update organization_erasures set status='running',lease_owner=$2,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1", [result.body.item.id, lease]);
      await tx.query("select set_config('wiseeff.organization_erasure_id',$1,true),set_config('wiseeff.organization_erasure_lease',$2,true),set_config('wiseeff.organization_erasure_users',$3,true)", [result.body.item.id, lease, JSON.stringify(["erasure-inactive"])]);
      await tx.query("update knowledge_entries set created_by_user_id=null where id='00000000-0000-4000-8000-000000000097'");
    })).rejects.toMatchObject({ code: "55000" });
    const retry = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${result.body.item.id}/retry`, "POST");
    expect(retry.body.item.status).toBe("deleted");
    expect((await db.query("select title,updated_at,historical_attribution from knowledge_entries where id='00000000-0000-4000-8000-000000000097'")).rows).toEqual(before);
  });
  it("does not use a management cleanup lease to update a deleting foreign Organization", async () => {
    await db.query("insert into organizations(id,name) values('erasure-other-deleting','Other deleting owner')");
    await db.query("insert into knowledge_entries(id,organization_id,title,content_form,created_by_user_id) values('00000000-0000-4000-8000-000000000098','erasure-other-deleting','Keep deleting foreign content','markdown','erasure-inactive')");
    await db.query("update organizations set status='deleting' where id='erasure-other-deleting'");
    const result = await start(); expect(result.body.item.status).toBe("failed");
    expect((await db.query("select title,created_by_user_id from knowledge_entries where id='00000000-0000-4000-8000-000000000098'")).rows).toEqual([{ title: "Keep deleting foreign content", created_by_user_id: "erasure-inactive" }]);
    expect((await db.query("select count(*)::int n from users where organization_id='erasure-target'")).rows).toEqual([{ n: 2 }]);
  });
  it("requires real platform authority, matching confirmation and a surviving usable platform entry", async () => {
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    const input = { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "erasure-target" };
    expect((await request(`${target}/deletions`, "POST", input, "erasure-member")).status).toBe(403);
    expect((await request(`${target}/deletions`, "POST", { ...input, confirmationOrganizationId: "wrong" })).status).toBe(400);
    expect((await request("/api/v1/platform/organization-deletions", "GET", undefined, "erasure-member")).status).toBe(403);
    const homePreview = await request<{ item: { stateDigest: string } }>("/api/v1/platform/organizations/erasure-home/deletion-preview");
    expect((await request("/api/v1/platform/organizations/erasure-home/deletions", "POST", { stateDigest: homePreview.body.item.stateDigest, confirmationOrganizationId: "erasure-home" })).status).toBe(409);
    expect((await db.query("select count(*)::int n from organization_erasures")).rows).toEqual([{ n: 0 }]);
  });
  it("serializes admission with administrator changes", async () => {
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { entered = resolve; });
    const mutation = db.transaction(async tx => {
      await lockAdministratorMutation(tx);
      await tx.query("delete from user_role_bindings where user_id='erasure-platform'"); entered(); await held;
    });
    await locked;
    const admission = request(`${target}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "erasure-target" });
    release(); await mutation;
    expect((await admission).status).toBe(403);
    expect((await db.query("select count(*)::int n from organization_erasures")).rows).toEqual([{ n: 0 }]);
  });
  it("fences a concurrent late business writer before any management rows are removed", async () => {
    await db.query(`create function pause_erasure_management() returns trigger language plpgsql as $$ begin
      perform pg_advisory_xact_lock(hashtextextended('test-erasure-writer',0)); return old; end $$;
      create trigger test_pause_erasure before delete on organization_teams for each row execute function pause_erasure_management()`);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { entered = resolve; });
    const blocker = db.transaction(async tx => { await tx.query("select pg_advisory_xact_lock(hashtextextended('test-erasure-writer',0))"); entered(); await held; });
    await locked;
    const deletion = start();
    try {
      await expect.poll(async () => (await db.query<{ status: string }>("select status from organizations where id='erasure-target'")).rows[0]?.status).toBe("deleting");
      await expect(db.query("insert into projects(id,organization_id,name,code) values('late-project','erasure-target','Late','LATE')")).rejects.toMatchObject({ code: "55000" });
      expect((await db.query("select count(*)::int n from users where organization_id='erasure-target'")).rows).toEqual([{ n: 2 }]);
    } finally { release(); await blocker; }
    expect((await deletion).body.item.status).toBe("deleted");
  });
  it("runs through a non-superuser API LOGIN while private Catalog and worker receipt writes remain denied", async () => {
    const token = `empty${randomBytes(5).toString("hex")}`, runtime = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    const api = createPostgresDatabase(runtime.apiUrl), worker = createPostgresDatabase(runtime.workerUrl);
    try {
      expect((await api.query("select rolsuper from pg_roles where rolname=current_user")).rows).toEqual([{ rolsuper: false }]);
      const preview = await requestJson<{ item: { stateDigest: string } }>(createWiseEffServer({ db: api }), `${target}/deletion-preview`, { headers: { "x-wiseeff-user": "erasure-platform" } });
      expect(preview.status, preview.bodyText).toBe(200);
      const erased = await requestJson<{ item: { status: string } }>(createWiseEffServer({ db: api }), `${target}/deletions`, { method: "POST", headers: { "x-wiseeff-user": "erasure-platform" }, body: JSON.stringify({ stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "erasure-target" }) });
      expect(erased.status, erased.bodyText).toBe(202); expect(erased.body.item.status).toBe("deleted");
      await expect(api.query("update parameter_catalog.parameter_definitions set id=id where false")).rejects.toMatchObject({ code: "42501" });
      await expect(worker.query("delete from organization_erasures")).rejects.toMatchObject({ code: "42501" });
      await expect(worker.query("select lease_owner from organization_erasures")).rejects.toMatchObject({ code: "42501" });
    } finally { await api.close(); await worker.close(); await dropLabRuntimeLogins(database.url, token); }
  });
  it("upgrades an existing API LOGIN and populated management records without rerunning provisioning", async () => {
    await withTempDatabase({ prefix: "erasureupgrade", migrate: false }, async ({ db: upgrading, connectionString }) => {
      await applyMigrations(upgrading, migrationsDir, { through: "0276_organization_deletion_preview.sql" });
      await seedCoreGraph(upgrading, { organization: { id: "erasure-home" }, users: [{ id: "erasure-platform" }] });
      await seedCoreGraph(upgrading, { organization: { id: "erasure-target", name: "Existing target" }, users: [{ id: "erasure-member" }] });
      await seedBaselineAuthCatalog(upgrading);
      await upgrading.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('upgrade-platform-role','erasure-platform','erasure-home','platform-admin')");
      const token = `upgrade${randomBytes(4).toString("hex")}`, runtime = await provisionPublicationRuntimeLogins(connectionString, { mode: "lab", runToken: token });
      const api = createPostgresDatabase(runtime.apiUrl);
      try {
        await applyMigrations(upgrading, migrationsDir);
        expect((await api.query("select name,status from organizations where id='erasure-target'")).rows).toEqual([{ name: "Existing target", status: "active" }]);
        const server = createWiseEffServer({ db: api });
        const preview = await requestJson<{ item: { stateDigest: string } }>(server, `${target}/deletion-preview`, { headers: { "x-wiseeff-user": "erasure-platform" } });
        expect(preview.status, preview.bodyText).toBe(200);
        const result = await requestJson<{ item: { status: string } }>(server, `${target}/deletions`, { method: "POST", headers: { "x-wiseeff-user": "erasure-platform" }, body: JSON.stringify({ stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "erasure-target" }) });
        expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
      } finally { await api.close(); await dropLabRuntimeLogins(connectionString, token); }
    });
  }, 120_000);
});
