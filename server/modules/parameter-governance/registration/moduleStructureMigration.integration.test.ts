import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../testing/testDatabase";
import { listParameterModules, getParameterModuleById } from "../../parameters/parameterModuleRepository";
import { migrateModuleStructure } from "../../../../scripts/migrate-module-structure";
import { pruneRuntimeDemoDriverGroupModules } from "../../../../scripts/reset-quality-runtime";
import { readPlacementHintEvidence } from "./readRepository";
import type pg from "pg";

describe("module structure migration schema", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query("insert into organizations (id, name) values ('s4-org', 'S4')");
    await db.query(`insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, archived_at)
      values ('s4-archived', 's4-org', 'Archived', 's4-archived', 1, 'business', 'curated', now())`);
  });

  afterEach(async () => { await db?.rollback(); });

  it("rejects an archived module as a parent", async () => {
    await expect(db.query(`insert into parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin)
      values ('s4-child', 's4-org', 's4-archived', 'Child', 's4-archived/s4-child', 2, 'business', 'curated')`))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("keeps archived modules readable by id but hides them from the tree", async () => {
    expect(await getParameterModuleById(db, { organizationId: "s4-org", moduleId: "s4-archived" })).not.toBeNull();
    expect(await listParameterModules(db, { organizationId: "s4-org" })).toEqual([]);
    expect((await readPlacementHintEvidence(db as unknown as Pick<pg.Client, "query">, "s4-org")).modules).toEqual([]);
  });

  it("preserves archived modules during quality runtime cleanup", async () => {
    await db.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ('s4-demo-attr','s4-org','driver-registration','FoldRegistryTestDG','auto','s4-demo-attr')`);
    await db.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id,archived_at)
      values ('s4-demo','s4-org','FoldRegistryTestDG','s4-demo',1,'driver-group','auto','s4-demo-attr',now())`);
    await pruneRuntimeDemoDriverGroupModules(db);
    expect((await db.query("select id from public.parameter_modules where id='s4-demo'")).rows).toEqual([{ id: "s4-demo" }]);
  });

  it("reports an organization with no typed modules as a read-only no-op", async () => {
    const report = await migrateModuleStructure(db, "s4-org", false);
    expect(report.changes).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect((await db.query("select * from parameter_catalog.module_structure_migration_map")).rows).toEqual([]);
  });

  it("reports unresolved owners, ancestors and recognition rules without moving them or another organization", async () => {
    await db.query("set constraints all deferred");
    await db.query("insert into public.organizations(id,name) values ('s4-other','Other')");
    await db.query(`insert into parameter_catalog.catalog_releases
      (id,release_sequence,release_version,release_digest,compiled_model_digest,toolchain_digest,published_at)
      values ('s4-conflict-release',999997,'s4-conflict-release','s4-conflict-release','compiled','toolchain',now())`);
    await db.query(`insert into parameter_catalog.catalog_subjects(id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('s4-owner','s4-conflict-release','driver','vendor,s4-owner',null),
        ('s4-child','s4-conflict-release','node-type','s4-child','s4-owner'),
        ('s4-root','s4-conflict-release','node-type','s4-root',null),
        ('s4-long-root','s4-conflict-release','node-type','s4-long-root',null)`);
    await db.query(`insert into parameter_catalog.catalog_release_subjects(release_id,subject_id,lifecycle,selector_snapshot,selector_provenance)
      values ('s4-conflict-release','s4-owner','active','{}','{}'),('s4-conflict-release','s4-child','active','{}','{}'),
        ('s4-conflict-release','s4-root','active','{}','{}'),('s4-conflict-release','s4-long-root','active','{}','{}')`);
    await db.query("insert into parameter_catalog.catalog_drivers(subject_id,nature,cardinality) values ('s4-owner','physical-device','multiple')");
    await db.query("insert into parameter_catalog.catalog_node_types(subject_id) values ('s4-child'),('s4-root'),('s4-long-root')");
    await db.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ('s4-attr-child','s4-org','node-type-definition','child','curated','s4-attr-child'),
        ('s4-attr-root','s4-org','node-type-definition','root','curated','s4-attr-root'),
        ('s4-attr-other','s4-other','node-type-definition','other','curated','s4-attr-other'),
        ('s4-attr-long','s4-org','node-type-definition','long','curated','s4-attr-long')`);
    await db.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
      values ('s4-root-typed','s4-org','root','s4-root-typed',1,'node-type','curated','s4-attr-root'),
        ('s4-other-typed','s4-other','other','s4-other-typed',1,'node-type','curated','s4-attr-other'),
        ('s4-business','s4-org','Business','s4-business',1,'business','curated',null)`);
    await db.query(`insert into public.parameter_modules(id,organization_id,parent_id,name,path,depth,kind,origin,attribution_subject_id)
      values ('s4-child-typed','s4-org','s4-business','child','s4-business/s4-child-typed',2,'node-type','curated','s4-attr-child'),
        ('s4-business-child','s4-org','s4-root-typed','Nested business','s4-root-typed/s4-business-child',2,'business','curated',null),
        ('s4-long-typed','s4-org','s4-business',repeat('x',129),'s4-business/s4-long-typed',2,'node-type','curated','s4-attr-long'),
        ('s4-same-name','s4-org','s4-business','Duplicate','s4-business/s4-same-name',2,'business','curated',null)`);
    await db.query(`insert into public.parameter_modules(id,organization_id,parent_id,name,path,depth,kind,origin)
      values ('s4-collision-child','s4-org','s4-child-typed','Duplicate','s4-business/s4-child-typed/s4-collision-child',3,'business','curated')`);
    await db.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('s4-child-reg','s4-org','s4-child','active','explicit','{}','s4-child-placement'),
        ('s4-root-reg','s4-org','s4-root','active','explicit','{}','s4-root-placement'),
        ('s4-long-reg','s4-org','s4-long-root','active','explicit','{}','s4-long-placement')`);
    await db.query("alter table parameter_catalog.subject_placements disable trigger subject_placement_kind_ck");
    await db.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('s4-child-placement','s4-child-reg','s4-org','s4-child-typed','curated'),
        ('s4-root-placement','s4-root-reg','s4-org','s4-root-typed','curated'),
        ('s4-long-placement','s4-long-reg','s4-org','s4-long-typed','curated')`);
    await db.query("set constraints all immediate");
    await db.query("alter table parameter_catalog.subject_placements enable trigger subject_placement_kind_ck");
    await db.query(`insert into public.module_recognition_rules(organization_id,module_id,canonical_subject_id,node_type_name)
      values ('s4-org','s4-child-typed','s4-child','s4-child')`);
    const before = (await db.query(`select id,module_id from parameter_catalog.subject_placements where organization_id='s4-org' order by id`)).rows;
    const counts = () => db.query(`select
      (select count(*) from public.parameter_modules) as modules,
      (select count(*) from parameter_catalog.organization_subject_registrations) as registrations,
      (select count(*) from parameter_catalog.subject_placements) as placements,
      (select count(*) from parameter_catalog.module_structure_migration_map) as mappings,
      (select count(*) from public.audit_events) as audits`);
    const beforeCounts = (await counts()).rows;
    const preflight = await migrateModuleStructure(db, "s4-org", false);
    expect((await counts()).rows).toEqual(beforeCounts);
    expect(preflight.conflicts.map((item) => item.action)).toEqual(expect.arrayContaining([
      "owner-not-registered", "no-business-ancestor", "unmigrated-recognition-rule", "module-not-empty",
      "business-name-conflict", "invalid-display-alias",
    ]));
    expect(preflight.changes).toEqual([]);
    const applied = await migrateModuleStructure(db, "s4-org", true);
    expect(applied.changes).toEqual([]);
    expect((await db.query(`select id,module_id from parameter_catalog.subject_placements where organization_id='s4-org' order by id`)).rows).toEqual(before);
    expect((await db.query<{ archived_at: Date | null }>("select archived_at from public.parameter_modules where id='s4-other-typed'")).rows[0]!.archived_at).toBeNull();
    expect((await db.query<{ parent_id: string }>("select parent_id from public.parameter_modules where id='s4-business-child'")).rows[0]!.parent_id).toBe("s4-root-typed");
    await db.query("set constraints all deferred");
    await db.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('s4-retired-owner','s4-org','s4-owner','retired','explicit','{}','s4-retired-owner-placement')`);
    await db.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('s4-retired-owner-placement','s4-retired-owner','s4-org',null,'curated')`);
    await db.query("set constraints all immediate");
    const retiredOwner = await migrateModuleStructure(db, "s4-org", false);
    expect(retiredOwner.changes).toContainEqual(expect.objectContaining({ action: "structural-placement", registrationId: "s4-child-reg",
      detail: expect.objectContaining({ effectiveModuleId: null }) }));
    await migrateModuleStructure(db, "s4-org", true);
    expect((await db.query<{ module_id: string | null }>("select module_id from parameter_catalog.subject_placements where id='s4-child-placement'")).rows[0]!.module_id).toBeNull();
  });

  it("preflights and migrates a retained root placement without changing its identity", async () => {
    await db.query("set constraints all deferred");
    await db.query("insert into public.organizations(id,name) values ('s4-other','Other')");
    await db.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ('s4-other-attr','s4-other','node-type-definition','Other','curated','s4-other-attr')`);
    await db.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
      values ('s4-other-module','s4-other','Other','s4-other-module',1,'node-type','curated','s4-other-attr')`);
    await db.query(`insert into parameter_catalog.catalog_releases
      (id,release_sequence,release_version,release_digest,compiled_model_digest,toolchain_digest,published_at)
      values ('s4-release',999998,'s4-release','s4-release','compiled','toolchain',now())`);
    await db.query(`insert into parameter_catalog.catalog_subjects(id,introduced_release_id,kind,canonical_key)
      values ('s4-driver','s4-release','driver','vendor,s4-driver')`);
    await db.query(`insert into parameter_catalog.catalog_release_subjects(release_id,subject_id,lifecycle,selector_snapshot,selector_provenance)
      values ('s4-release','s4-driver','active','{}','{}')`);
    await db.query("insert into parameter_catalog.catalog_drivers(subject_id,nature,cardinality) values ('s4-driver','physical-device','multiple')");
    await db.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin)
      values ('s4-business','s4-org','Business','s4-business',1,'business','curated')`);
    await db.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ('s4-attribution','s4-org','driver-registration','Legacy name','curated','s4-attribution')`);
    await db.query(`insert into public.parameter_modules(id,organization_id,parent_id,name,path,depth,kind,origin,attribution_subject_id)
      values ('s4-typed','s4-org','s4-business','Legacy name','s4-business/s4-typed',2,'driver-group','curated','s4-attribution')`);
    await db.query(`insert into public.parameter_modules(id,organization_id,parent_id,name,path,depth,kind,origin)
      values ('s4-nested','s4-org','s4-typed','Nested','s4-business/s4-typed/s4-nested',3,'business','curated'),
        ('s4-deeper','s4-org','s4-nested','Deeper','s4-business/s4-typed/s4-nested/s4-deeper',4,'business','curated')`);
    await db.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('s4-registration','s4-org','s4-driver','active','explicit','{}','s4-placement')`);
    // The fixture represents a row committed before migration 0320 restricted new typed placements.
    await db.query("alter table parameter_catalog.subject_placements disable trigger subject_placement_kind_ck");
    await db.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('s4-placement','s4-registration','s4-org','s4-typed','curated')`);
    await db.query("set constraints all immediate");
    await db.query("alter table parameter_catalog.subject_placements enable trigger subject_placement_kind_ck");

    const countsBefore = (await db.query(`select
      (select count(*) from public.parameter_modules) as modules,
      (select count(*) from parameter_catalog.organization_subject_registrations) as registrations,
      (select count(*) from parameter_catalog.subject_placements) as placements,
      (select count(*) from parameter_catalog.module_structure_migration_map) as mappings,
      (select count(*) from public.audit_events) as audits`)).rows;
    const preflight = await migrateModuleStructure(db, "s4-org", false);
    expect((await db.query(`select
      (select count(*) from public.parameter_modules) as modules,
      (select count(*) from parameter_catalog.organization_subject_registrations) as registrations,
      (select count(*) from parameter_catalog.subject_placements) as placements,
      (select count(*) from parameter_catalog.module_structure_migration_map) as mappings,
      (select count(*) from public.audit_events) as audits`)).rows).toEqual(countsBefore);
    expect(preflight.changes.map((item) => item.action)).toEqual(["set-display-alias", "move-placement", "reparent-business", "repath-descendant", "archive-module"]);
    expect(preflight.information.map((item) => item.action)).toEqual(["renamed-module"]);
    expect((await db.query<{ module_id: string }>("select module_id from parameter_catalog.subject_placements where id='s4-placement'")).rows[0]!.module_id).toBe("s4-typed");
    expect((await db.query("select * from parameter_catalog.module_structure_migration_map")).rows).toEqual([]);
    await db.query(`create function pg_temp.s4_fail_mapping() returns trigger language plpgsql as $$
      begin if new.action='move-placement' then raise exception 'injected migration failure'; end if; return new; end $$`);
    await db.query(`create trigger s4_fail_mapping before insert on parameter_catalog.module_structure_migration_map
      for each row execute function pg_temp.s4_fail_mapping()`);
    await expect(migrateModuleStructure(db, "s4-org", true)).rejects.toThrow("injected migration failure");
    expect((await db.query<{ module_id: string }>("select module_id from parameter_catalog.subject_placements where id='s4-placement'")).rows[0]!.module_id).toBe("s4-typed");
    expect((await db.query<{ display_alias: string | null }>("select display_alias from parameter_catalog.organization_subject_registrations where id='s4-registration'")).rows[0]!.display_alias).toBeNull();
    expect((await db.query("select * from parameter_catalog.module_structure_migration_map")).rows).toEqual([]);
    await db.query("drop trigger s4_fail_mapping on parameter_catalog.module_structure_migration_map");
    await migrateModuleStructure(db, "s4-org", true);
    expect((await db.query<{ count: number }>("select count(*)::int as count from parameter_catalog.module_structure_migration_map where organization_id='s4-org'")).rows[0]!.count).toBe(5);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.audit_events where organization_id='s4-org' and kind='module-structure-migrated'")).rows[0]!.count).toBe(1);
    expect((await db.query("select id,parent_id,path,depth from public.parameter_modules where id in ('s4-nested','s4-deeper') order by id")).rows).toEqual([
      { id: "s4-deeper", parent_id: "s4-nested", path: "s4-business/s4-nested/s4-deeper", depth: 3 },
      { id: "s4-nested", parent_id: "s4-business", path: "s4-business/s4-nested", depth: 2 },
    ]);
    expect((await db.query(`select placement.id,placement.module_id,registration.display_alias,module.archived_at is not null as archived
      from parameter_catalog.subject_placements placement
      join parameter_catalog.organization_subject_registrations registration on registration.id=placement.registration_id
      join public.parameter_modules module on module.id='s4-typed' where placement.id='s4-placement'`)).rows).toEqual([
      { id: "s4-placement", module_id: "s4-business", display_alias: "Legacy name", archived: true },
    ]);
    expect((await migrateModuleStructure(db, "s4-org", true)).changes).toEqual([]);
    expect((await db.query<{ count: number }>("select count(*)::int as count from public.audit_events where organization_id='s4-org' and kind='module-structure-migrated'")).rows[0]!.count).toBe(1);
    expect((await db.query<{ archived_at: Date | null }>("select archived_at from public.parameter_modules where id='s4-other-module'")).rows[0]!.archived_at).toBeNull();
    await expect(db.query("update parameter_catalog.subject_placements set module_id='s4-archived' where id='s4-placement'"))
      .rejects.toMatchObject({ code: "23514", constraint: "subject_placement_kind_ck" });
  });
});
