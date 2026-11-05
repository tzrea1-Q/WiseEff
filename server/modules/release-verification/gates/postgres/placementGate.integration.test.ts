import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryTestDatabase, type InMemoryTestDatabase } from "../../../../testing/testDatabase";
import { runV05 } from "./countGates";
import { queryOf } from "./session";

describe("V05 subject placement verification", () => {
  let db: InMemoryTestDatabase;
  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query("set constraints all deferred");
    await db.query("select pg_catalog.set_config('session_replication_role', 'replica', true)");
    await db.query("insert into organizations(id,name) values ('gate-org','Gate')");
    await db.query(`insert into parameter_catalog.catalog_releases
      (id,release_sequence,release_version,release_digest,compiled_model_digest,toolchain_digest,published_at)
      values ('gate-release',900001,'gate-release','gate-release','compiled','toolchain',now())`);
    await db.query(`insert into parameter_catalog.catalog_subjects(id,introduced_release_id,kind,canonical_key,owner_subject_id)
      values ('gate-driver','gate-release','driver','vendor,gate',null),
        ('gate-child','gate-release','node-type','gate-child','gate-driver'),
        ('gate-root','gate-release','node-type','gate-root',null),
        ('gate-legacy','gate-release','driver','vendor,legacy',null)`);
    await db.query(`insert into public.attribution_subjects(id,organization_id,subject_kind,display_name,origin,source_key)
      values ('gate-attr','gate-org','driver-registration','Legacy','curated','gate-attr')`);
    await db.query(`insert into public.parameter_modules(id,organization_id,name,path,depth,kind,origin,attribution_subject_id)
      values ('gate-business','gate-org','Business','gate-business',1,'business','curated',null),
        ('gate-unclassified','gate-org','Unclassified','gate-unclassified',1,'unclassified','auto',null),
        ('gate-typed','gate-org','Legacy','gate-typed',1,'driver-group','curated','gate-attr')`);
    await db.query(`insert into parameter_catalog.organization_subject_registrations
      (id,organization_id,subject_id,status,registration_method,proof,current_placement_id)
      values ('gate-driver-reg','gate-org','gate-driver','active','explicit','{}','gate-driver-place'),
        ('gate-child-reg','gate-org','gate-child','active','explicit','{}','gate-child-place'),
        ('gate-root-reg','gate-org','gate-root','active','explicit','{}','gate-root-place'),
        ('gate-legacy-reg','gate-org','gate-legacy','active','explicit','{}','gate-legacy-place')`);
    await db.query(`insert into parameter_catalog.subject_placements(id,registration_id,organization_id,module_id,origin)
      values ('gate-driver-place','gate-driver-reg','gate-org','gate-business','curated'),
        ('gate-child-place','gate-child-reg','gate-org',null,'curated'),
        ('gate-root-place','gate-root-reg','gate-org','gate-unclassified','curated'),
        ('gate-legacy-place','gate-legacy-reg','gate-org','gate-typed','curated')`);
    await db.query("select pg_catalog.set_config('session_replication_role', 'origin', true)");
  });
  afterEach(async () => { await db.rollback(); });

  it("accepts business roots, structural children and unmigrated legacy placements", async () => {
    expect((await runV05(queryOf(db))).status).toBe("passed");
  });

  it("rejects a structural child without an active owner", async () => {
    await db.query("select pg_catalog.set_config('session_replication_role', 'replica', true)");
    await db.query("update parameter_catalog.organization_subject_registrations set status='retired' where id='gate-driver-reg'");
    await db.query("select pg_catalog.set_config('session_replication_role', 'origin', true)");
    expect((await runV05(queryOf(db))).status).toBe("failed");
  });

  it.each([
    { child: "active", owner: "active", expected: "passed" },
    { child: "active", owner: "retired", expected: "failed" },
    { child: "retired", owner: "retired", expected: "passed" },
  ])("checks the organization owner when the Catalog owner is retired: child=$child owner=$owner", async ({ child, owner, expected }) => {
    await db.query("select pg_catalog.set_config('session_replication_role', 'replica', true)");
    await db.query("update parameter_catalog.organization_subject_registrations set status='retired' where id='gate-driver-reg'");
    await db.query("update parameter_catalog.organization_subject_registrations set owner_subject_id='gate-legacy',status=$1 where id='gate-child-reg'", [child]);
    await db.query("update parameter_catalog.organization_subject_registrations set status=$1 where id='gate-legacy-reg'", [owner]);
    await db.query("select pg_catalog.set_config('session_replication_role', 'origin', true)");
    expect((await runV05(queryOf(db))).status).toBe(expected);
  });

  it("rejects typed placement after its migration evidence exists", async () => {
    await db.query(`insert into parameter_catalog.module_structure_migration_map
      (run_id,organization_id,module_id,registration_id,action,from_module_id,to_module_id)
      values (gen_random_uuid(),'gate-org','gate-typed','gate-legacy-reg','move-placement','gate-typed','gate-business')`);
    expect((await runV05(queryOf(db))).status).toBe("failed");
    await db.query("update parameter_catalog.subject_placements set module_id='gate-business' where id='gate-legacy-place'");
    expect((await runV05(queryOf(db))).status).toBe("passed");
  });

  it("rejects archived roots and independently placed owned children", async () => {
    await db.query("select pg_catalog.set_config('session_replication_role', 'replica', true)");
    await db.query("update parameter_modules set archived_at=now() where id='gate-business'");
    await db.query("update parameter_catalog.subject_placements set module_id='gate-unclassified' where id='gate-child-place'");
    await db.query("select pg_catalog.set_config('session_replication_role', 'origin', true)");
    expect((await runV05(queryOf(db))).status).toBe("failed");
  });
});
