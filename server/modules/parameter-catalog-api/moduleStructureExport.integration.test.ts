import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { makeTestAuthContext } from "../../testing/authContext";
import { installPublishedCatalogMatchChain } from "../catalog-kernel/runtime/catalogChain.fixture";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../catalog-publication/runtime/provisionRuntimeLogins";
import { moduleStructureExportSchema } from "../contracts/dtoSchemas/moduleStructure";

describe("module structure export", () => {
  let fixture: ParameterCatalogDatabase;
  let db: ReturnType<typeof createPostgresDatabase>;
  let api: ReturnType<typeof createPostgresDatabase>;
  const org = "export-org";
  const user = "export-admin";

  beforeAll(async () => {
    fixture = await createDisposableParameterCatalogDatabase("structureexport");
    db = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(db)!;
    await installPublishedCatalogMatchChain(pool);
    await pool.query("insert into organizations(id,name) values ($1,'Export')", [org]);
    await pool.query("insert into users(id,organization_id,name,title,is_active) values ($1,$2,'Admin','Admin',true)", [user, org]);
    await pool.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values ('export-role',$1,$2,'admin')", [user, org]);
    await pool.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      values ('export-root',$1,'Root','export-root','business','curated')`, [org]);
    const runtime = await provisionPublicationRuntimeLogins(fixture.url, { mode: "lab", runToken: "moduleexport1495" });
    api = createPostgresDatabase(runtime.apiUrl);
    expect((await api.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
  }, 120_000);

  afterAll(async () => { await api?.close(); if (fixture) await dropLabRuntimeLogins(fixture.url, "moduleexport1495"); await db?.close(); await fixture?.close(); });

  it("exports the complete organization structure and retains a baseline", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const response = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(response.status, response.bodyText).toBe(200);
    expect(response.body).toMatchObject({ format: "wiseeff-module-structure", version: 1,
      source: { organizationId: org, exportId: expect.any(String) },
      modules: [expect.objectContaining({ sourceId: "export-root", name: "Root" })],
      counts: { modules: 1, subjects: 0 } });
    const exportId = (response.body as { source: { exportId: string } }).source.exportId;
    const baseline = await db.query("select document from parameter_catalog.module_structure_export_baselines where organization_id=$1 and export_id=$2", [org, exportId]);
    expect(baseline.rows).toEqual([{ document: response.body }]);
    expect((await db.query("select 1 from audit_events where organization_id=$1 and action='module-structure-export'", [org])).rowCount).toBe(1);
    await expect(api.query("update parameter_catalog.module_structure_export_baselines set document='{}' where export_id=$1", [exportId])).rejects.toMatchObject({ code: "42501" });
    await expect(api.query("delete from parameter_catalog.module_structure_export_baselines where export_id=$1", [exportId])).rejects.toMatchObject({ code: "42501" });
    const cross = await requestJson(app, "/api/v2/organizations/another-org/module-structure/exports", { method: "POST", body: "{}",
      headers: { "x-wiseeff-actor-id": user, "x-wiseeff-organization-id": org } });
    expect(cross.status).toBe(403);
  });

  it("includes all modules and retained recognition settings without a page limit", async () => {
    await db.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      select 'export-extra-'||n,$1,'Extra '||n,'export-extra-'||n,'business','curated' from generate_series(1,250) n`, [org]);
    await db.query("select parameter_catalog.claim_catalog_subject_owner('csub_acme_charger','csub_acme_power')");
    await db.transaction(async tx => {
      await tx.query("set constraints all deferred");
      await tx.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,registration_method,proof,current_placement_id,display_alias)
        values ('export-registration',$1,'csub_acme_power','retired','explicit','{}','export-placement','Power alias')`, [org]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('export-placement','export-registration',$1,'export-root','curated')`, [org]);
      await tx.query(`insert into registration_recognition_rules(organization_id,registration_id,canonical_subject_id,compatibles,driver_nature,instance_cardinality)
        values ($1,'export-registration','csub_acme_power',array['acme,override'],'physical-device','multiple')`, [org]);
      await tx.query(`insert into parameter_catalog.organization_subject_registrations
        (id,organization_id,subject_id,status,cascade_retired,registration_method,proof,current_placement_id)
        values ('export-child',$1,'csub_acme_charger','retired',true,'automatic','{}','export-child-placement')`, [org]);
      await tx.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
        values ('export-child-placement','export-child',$1,null,'curated')`, [org]);
    });
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports?limit=1`, { method: "POST", body: "{}" });
    expect(result.status, result.bodyText).toBe(200);
    expect(() => moduleStructureExportSchema.parse(result.body)).not.toThrow();
    expect(result.body).toMatchObject({ counts: { modules: 251, subjects: 2 },
      subjects: expect.arrayContaining([expect.objectContaining({ subjectId: "csub_acme_power", state: "retired", displayAlias: "Power alias",
        placement: { kind: "module", moduleRef: "export-root" }, recognition: expect.objectContaining({ mode: "override",
          override: expect.objectContaining({ compatibles: ["acme,override"] }), effective: expect.objectContaining({ compatibles: ["acme,override"] }) }) }),
        expect.objectContaining({ subjectId: "csub_acme_charger", ownerSubjectId: "csub_acme_power", state: "retired", cascadeRetired: true,
          placement: null, recognition: expect.objectContaining({ mode: "inherit", override: null }) })]) });
    expect((result.body as { modules: unknown[] }).modules).toHaveLength(251);
    await db.query("update parameter_catalog.organization_subject_registrations set status='active' where id='export-registration'");
    await db.query("update parameter_catalog.organization_subject_registrations set cascade_retired=false where id='export-child'");
    const active = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(active.status, active.bodyText).toBe(200);
    expect((active.body as { subjects: unknown[] }).subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: "csub_acme_power", state: "active" }),
      expect.objectContaining({ subjectId: "csub_acme_charger", state: "retired", cascadeRetired: false }),
    ]));
  });

  it("reads the release and module rows from one PostgreSQL snapshot", async () => {
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    let pending: ReturnType<typeof requestJson> | undefined;
    await db.transaction(async tx => {
      await tx.query("lock table public.parameter_modules in access exclusive mode");
      pending = requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        const activity = await db.query<{ blocked: boolean }>(`select exists (select 1 from pg_stat_activity
          where wait_event_type='Lock' and query like 'select id,parent_id,name,description,scope,sort_order,importance%') as blocked`);
        blocked = activity.rows[0]?.blocked === true;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(blocked).toBe(true);
      await tx.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
        values ('export-later',$1,'Later','export-later','business','curated')`, [org]);
    });
    const result = await pending!;
    expect(result.status, result.bodyText).toBe(200);
    expect(result.body).toMatchObject({ counts: { modules: 251, subjects: 2 } });
    const later = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(later.body).toMatchObject({ counts: { modules: 252, subjects: 2 } });
  });

  it("returns the supported entry maximum completely and rejects an excess before saving a baseline", async () => {
    await db.query(`insert into parameter_modules(id,organization_id,name,path,kind,origin)
      select 'export-scale-'||n,$1,'Scale '||n,'export-scale-'||n,'business','curated' from generate_series(1,9748) n`, [org]);
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const path = `/api/v2/organizations/${org}/module-structure/exports`;
    const maximum = await requestJson(app, path, { method: "POST", body: "{}" });
    expect(maximum.status, maximum.bodyText).toBe(200);
    expect((maximum.body as { modules: unknown[] }).modules).toHaveLength(10_000);
    const before = (await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0];
    await db.query("insert into parameter_modules(id,organization_id,name,path,kind,origin) values ('export-excess',$1,'Excess','export-excess','business','curated')", [org]);
    const excess = await requestJson(app, path, { method: "POST", body: "{}" });
    expect(excess.status).toBe(400);
    expect((await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0]).toEqual(before);
  }, 60_000);

  it("rolls back the baseline when audit insertion fails", async () => {
    await db.query("delete from parameter_modules where id='export-excess'");
    const before = (await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0];
    await db.query(`create function reject_structure_export_audit() returns trigger language plpgsql as $$
      begin if new.action='module-structure-export' then raise exception 'injected audit failure'; end if; return new; end $$`);
    await db.query("create trigger reject_structure_export_audit before insert on audit_events for each row execute function reject_structure_export_audit()");
    try {
      const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
        makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
      const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
      expect(result.status).toBe(500);
      expect((await db.query("select count(*)::int as count from parameter_catalog.module_structure_export_baselines where organization_id=$1", [org])).rows[0]).toEqual(before);
    } finally {
      await db.query("drop trigger reject_structure_export_audit on audit_events");
      await db.query("drop function reject_structure_export_audit()");
    }
  });

  it("rejects an over-byte-limit document before baseline or audit writes", async () => {
    await db.query("update parameter_modules set description=repeat('x', 4194304) where id='export-root'");
    const before = (await db.query(`select
      (select count(*) from parameter_catalog.module_structure_export_baselines where organization_id=$1) as baselines,
      (select count(*) from audit_events where organization_id=$1 and action='module-structure-export') as audits`, [org])).rows[0];
    const app = createWiseEffServer({ db: api, auth: { mode: "production", verifier: { verify: async () =>
      makeTestAuthContext({ organizationId: org, userId: user, roles: [{ roleId: "admin", projectId: null }] }) } } });
    const result = await requestJson(app, `/api/v2/organizations/${org}/module-structure/exports`, { method: "POST", body: "{}" });
    expect(result.status).toBe(400);
    expect((await db.query(`select
      (select count(*) from parameter_catalog.module_structure_export_baselines where organization_id=$1) as baselines,
      (select count(*) from audit_events where organization_id=$1 and action='module-structure-export') as audits`, [org])).rows[0]).toEqual(before);
  });
});
