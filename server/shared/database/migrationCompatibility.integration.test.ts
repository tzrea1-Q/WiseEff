import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "./client";
import { applyMigrations, migrationsDir, withTempDatabase } from "../../testing/tempDatabase";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createDefinitionDeletionFixture } from "../../testing/parameterCatalog/definitionDeletion";
import { prepareCatalogDefinitionErasure } from "../../modules/catalog-publication/definitionErasure";
import { X_DEFINITION_ID, Y_DEFINITION_ID } from "../../modules/catalog-kernel/runtime/catalogChain.fixture";

const original = "0214_parameter_definition_purge_scope.sql";
const replacement = "0220_parameter_definition_purge_compatibility.sql";
const originalSql = await readFile(path.join(migrationsDir, original), "utf8");
const databaseAvailable = await isTestDatabaseAvailable();

/** Replay the actual historical cutover and management compatibility tables. */
async function retireFlatIdentity(db: Database) {
  await db.query("insert into organizations(id,name) values ('upgrade-retain-org','Retained archive')");
  await db.query("insert into projects(id,organization_id,name,code) values ('upgrade-retain-project','upgrade-retain-org','Retained project','retained')");
  await db.query(`insert into parameter_definitions(id,organization_id,name,description,explanation,config_format,module,default_range,unit,risk)
    values ('upgrade-retain-definition','upgrade-retain-org','Retained','Retained','','json','Legacy','','','Low'),
      ('upgrade-target-definition','upgrade-retain-org','Target','Target','','json','Legacy','','','Low')`);
  await db.query(`insert into parameter_identity_migration_runs(id,mode,status)
    values ('upgrade-cutover-run','apply','finalized')`);
  // The historical identity was validated while its real source was active.
  // After cutover it is retained evidence; never bypass the fixed source-owner
  // guard to manufacture a new identity against an empty compatibility table.
  await db.query(`insert into parameter_catalog.legacy_identities(id,source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)
    values ('upgrade-flat-identity','wiseeff-v1','legacy-flat-parameter-definition','organization','upgrade-retain-org','upgrade-target-definition')`);
  const cutover = (await readFile(path.resolve(migrationsDir, "../cutovers/2026-07-16-parameter-identity-cutover.sql"), "utf8"))
    .replaceAll("{{MIGRATION_RUN_ID}}", "upgrade-cutover-run").replaceAll("{{CUTOVER_ID}}", "upgrade-cutover");
  await db.transaction(async tx => { await tx.query(cutover); });
  await db.query(`insert into legacy_project_parameter_values(id,organization_id,project_id,parameter_definition_id,current_value,recommended_value)
    values ('upgrade-target-value','upgrade-retain-org','upgrade-retain-project','upgrade-target-definition','42','43'),
      ('upgrade-retain-value','upgrade-retain-org','upgrade-retain-project','upgrade-retain-definition','84','85')`);
  for (const table of ["parameter_definitions", "project_parameter_values"]) {
    await db.query(`create table public.${table} (like public.legacy_${table} including all)`);
    await db.query(`do $$ declare edge record; begin
      for edge in select conname,pg_get_constraintdef(oid) definition from pg_constraint
        where conrelid='public.legacy_${table}'::regclass and contype='f'
      loop execute format('alter table public.${table} add constraint %I %s',edge.conname,edge.definition); end loop;
    end $$`);
  }
}

describe.skipIf(!databaseAvailable)("immutable 0214 replacement on populated historical schemas", () => {
  it("reproduces the missing FK, upgrades the retired schema and erases through the API role", async () => {
    await withTempDatabase({ prefix: "purge_cutover", migrate: false }, async ({ db, connectionString }) => {
      await applyMigrations(db, migrationsDir, { through: "0212_module_recognition_rules.sql" });
      await retireFlatIdentity(db);
      await applyMigrations(db, migrationsDir, { through: "0213_parameter_definition_purge.sql" });
      await expect(db.transaction(async tx => { await tx.query(originalSql); }))
        .rejects.toThrow("Missing pre-erasure FK parameter_drafts_project_parameter_value_id_fkey");

      const applied = await applyMigrations(db, migrationsDir);
      expect(applied[0]).toBe(replacement);
      expect(applied).not.toContain(original);
      expect(await applyMigrations(db, migrationsDir)).toEqual([]);
      expect((await db.query("select name from schema_migrations where name=$1", [original])).rows).toHaveLength(0);
      expect((await db.query(`select 1 from information_schema.columns where table_schema='public'
        and table_name='parameter_drafts' and column_name='project_parameter_value_id'`)).rows).toHaveLength(0);
      const aliases = await db.query<{ conname: string; confdeltype: string; condeferrable: boolean }>(`select conname,confdeltype,condeferrable
        from pg_constraint where conrelid='public.project_parameter_values'::regclass and conname like 'legacy_ppv_%' order by conname`);
      expect(aliases.rows).toEqual([
        { conname: "legacy_ppv_legacy_definition_fkey", confdeltype: "a", condeferrable: false },
        { conname: "legacy_ppv_project_id_fkey", confdeltype: "c", condeferrable: false },
      ]);

      const fixture = await createDefinitionDeletionFixture("upgraded_erasure", { url: connectionString, drop: async () => {} });
      try {
        await fixture.root.query(`insert into parameter_catalog.parameter_catalog_cutover_runs(id,source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest,current_phase,state)
          values ('upgrade-catalog-map','fixture',$1,$2,'1.0.0','upgrade-plan','P0','planned')`, ["a".repeat(40), fixture.chain.pinC.digest]);
        await fixture.root.query(`insert into parameter_catalog.legacy_mapping_versions(id,legacy_identity_id,cutover_run_id,version_number,source_checksum,graph_fingerprint,r_class,target_kind,target_id)
          values ('upgrade-flat-map','upgrade-flat-identity','upgrade-catalog-map',1,'source','graph','R4','parameter-definition',$1)`, [X_DEFINITION_ID]);
        await fixture.root.query(`insert into parameter_catalog.legacy_mapping_heads(legacy_identity_id,current_version_id,cas_version)
          values ('upgrade-flat-identity','upgrade-flat-map',1)`);
        const retained = (await fixture.root.query("select * from parameter_catalog.project_parameter_values where definition_id=$1 order by id", [Y_DEFINITION_ID])).rows;
        const archived = (await fixture.root.query("select * from public.legacy_project_parameter_values where id='upgrade-retain-value'")).rows;
        await fixture.api.transaction(async tx => {
          await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [X_DEFINITION_ID]);
          const plan = await prepareCatalogDefinitionErasure(tx, X_DEFINITION_ID);
          await tx.query("select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4)",
            [X_DEFINITION_ID, JSON.stringify(plan), "erase-platform", "upgraded-erasure-audit"]);
        });
        expect((await fixture.root.query("select id from parameter_catalog.parameter_definitions where id=$1", [X_DEFINITION_ID])).rows).toHaveLength(0);
        expect((await fixture.root.query("select * from parameter_catalog.project_parameter_values where definition_id=$1 order by id", [Y_DEFINITION_ID])).rows).toEqual(retained);
        expect((await fixture.root.query("select id from public.legacy_parameter_definitions where id='upgrade-retain-definition'")).rows).toHaveLength(1);
        expect((await fixture.root.query("select id from public.legacy_parameter_definitions where id='upgrade-target-definition'")).rows).toHaveLength(0);
        expect((await fixture.root.query("select id from public.legacy_project_parameter_values where id='upgrade-target-value'")).rows).toHaveLength(0);
        expect((await fixture.root.query("select * from public.legacy_project_parameter_values where id='upgrade-retain-value'")).rows).toEqual(archived);
        await expect(fixture.api.query("delete from parameter_catalog.parameter_definitions where id=$1", [Y_DEFINITION_ID]))
          .rejects.toMatchObject({ code: "42501" });
      } finally { await fixture.close(); }
    });
  }, 120_000);

  it("keeps later security fixes when the immutable original already succeeded", async () => {
    await withTempDatabase({ prefix: "purge_existing", migrate: false }, async ({ db }) => {
      await applyMigrations(db, migrationsDir, { through: "0213_parameter_definition_purge.sql" });
      await db.transaction(async tx => {
        await tx.query(originalSql);
        await tx.query("insert into schema_migrations(name,checksum) values($1,$2)",
          [original, createHash("sha256").update(originalSql).digest("hex")]);
      });
      await applyMigrations(db, migrationsDir, { through: "0219_definition_erasure_private_trigger_capability.sql" });
      const readPolicy = async () => (await db.query(`select
        pg_get_functiondef('parameter_catalog.purge_parameter_definition(text,jsonb,text,text)'::regprocedure) as erasure,
        pg_get_functiondef('parameter_catalog.lock_parameter_plane_archive()'::regprocedure) as archive,
        has_function_privilege('public','parameter_catalog.definition_purge_allows_change(text,text,jsonb,text)','EXECUTE') as public_capability`)).rows;
      const before = await readPolicy();
      expect(await applyMigrations(db, migrationsDir)).toEqual([replacement]);
      expect(await readPolicy()).toEqual(before);
      expect(before[0]).toMatchObject({ public_capability: false });
    });
  }, 120_000);

  it("rejects unknown missing constraints and retries a rolled-back replacement transaction", async () => {
    await withTempDatabase({ prefix: "purge_retry", migrate: false }, async ({ db }) => {
      await applyMigrations(db, migrationsDir, { through: "0213_parameter_definition_purge.sql" });
      const constraint = "parameter_drafts_organization_id_fkey";
      const definition = (await db.query<{ definition: string }>("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.parameter_drafts'::regclass and conname=$1", [constraint])).rows[0]!.definition;
      await db.query(`alter table public.parameter_drafts drop constraint ${constraint}`);
      await expect(applyMigrations(db, migrationsDir)).rejects.toThrow(`Missing pre-erasure FK ${constraint}`);
      expect((await db.query("select name from schema_migrations where name=$1", [replacement])).rows).toHaveLength(0);
      expect((await db.query("select 1 from pg_attribute where attrelid='parameter_catalog.project_value_source_pins'::regclass and attname='erased_request_audit_id' and not attisdropped")).rows).toHaveLength(0);
      await db.query(`alter table public.parameter_drafts add constraint ${constraint} ${definition}`);
      expect((await applyMigrations(db, migrationsDir))[0]).toBe(replacement);
    });
  }, 120_000);

  it("refuses explicit bounds that exclude the required replacement", async () => {
    await withTempDatabase({ prefix: "purge_bounds", migrate: false }, async ({ db }) => {
      await applyMigrations(db, migrationsDir, { through: "0213_parameter_definition_purge.sql" });
      await expect(applyMigrations(db, migrationsDir, { through: original })).rejects.toThrow("bounds exclude the required 0220 replacement");
      expect((await db.query("select name from schema_migrations where name=$1", [replacement])).rows).toHaveLength(0);
    });
  }, 120_000);
});
