import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCheckedEmptyDatabase, type ParameterCatalogDatabase } from "../../testing/upgradeComponents";
import { createPostgresDatabase } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { captureFrozenSourceSnapshot, inspectFrozenSourceSnapshotProgress, verifyFrozenSourceSnapshot, type FrozenSourceSnapshot } from "./sourceSnapshot";
import { runControlledManagementMigrations, verifyControlledManagementMigrations, type ManagementMigrationIntent, type ManagementMigrationReceipt } from "../../../scripts/migrate";
import { bindingJournalPath } from "../../../ops/self-hosted/scripts/parameter-catalog-upgrade/bindingJournal";
import { openUpgradeJournal, sha256Prefixed } from "../../../ops/self-hosted/scripts/parameter-catalog-upgrade/journal";
import { createManagementMigrationJournal, readManagementMigrationAttempt, verifyCommittedManagementMigration } from "../../../ops/self-hosted/scripts/parameter-catalog-upgrade/managementJournal";
import { createManagementMigrationPreparation } from "../../../ops/self-hosted/scripts/parameter-catalog-upgrade/managementPreparation";
import { withHostOperationLock } from "../../../ops/self-hosted/scripts/parameter-catalog-upgrade/handoff";

// The parent runs this through vitest.upgrade-cutover.config.ts, which verifies
// its explicit private target receipt before collecting any PostgreSQL suite.
describe("frozen old public projection across exact append-only migrations", () => {
  let database: ParameterCatalogDatabase;
  let pool: pg.Pool;
  let migrationDb: ReturnType<typeof createPostgresDatabase>;
  let directory: string;
  let sourceDirectory: string;
  let candidateDirectory: string;
  let frozen: FrozenSourceSnapshot;
  const sourceSha = "82344044b436a8dafecefbb85dfd724cecb05e3f";
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const verify = () => verifyFrozenSourceSnapshot({ pool, descriptor: frozen,
    expectedDescriptorDigest: frozen.digest, candidateMigrationsDirectory: candidateDirectory });
  beforeAll(async () => {
    database = await createCheckedEmptyDatabase("frozensusource");
    pool = new pg.Pool({ connectionString: database.url, max: 2 });
    migrationDb = createPostgresDatabase(database.url);
    directory = await mkdtemp(path.join(os.tmpdir(), "upg-frozen-source-"));
    sourceDirectory = path.join(directory, "source"); candidateDirectory = path.join(directory, "candidate");
    for (const [revision, destination] of [[sourceSha, sourceDirectory], [candidateSha, candidateDirectory]]) {
      await mkdir(destination);
      const files = execFileSync("git", ["ls-tree", "--name-only", `${revision}:server/migrations`], { encoding: "utf8" }).trim().split("\n").filter(name => name.endsWith(".sql"));
      for (const name of files) await writeFile(path.join(destination, name), execFileSync("git", ["show", `${revision}:server/migrations/${name}`]));
    }
    await applyMigrations(migrationDb, sourceDirectory);
    await pool.query(`
      insert into organizations(id,name) values ('frozen-org','private-synthetic-value');
      insert into projects(id,organization_id,name,code) values ('frozen-project','frozen-org','Synthetic','FROZEN');
      insert into dts_config_set(id,organization_id,project_id,name) values ('frozen-config','frozen-org','frozen-project','Synthetic');
      insert into dts_config_revisions(id,organization_id,project_id,config_set_id,revision_number,status)
        values ('frozen-r1','frozen-org','frozen-project','frozen-config',1,'draft'), ('frozen-r2','frozen-org','frozen-project','frozen-config',2,'draft');
      insert into parameter_specs(id,organization_id,source_kind,specification_key) values ('frozen-spec','frozen-org','manual','synthetic');
      insert into parameter_spec_versions(id,parameter_spec_id,version,display_name,description,value_shape,lifecycle)
        values ('frozen-spec-v1','frozen-spec',1,'Synthetic','Synthetic','{"kind":"string"}','draft');
      insert into parameter_modules(id,organization_id,name,path,depth,sort_order,description,scope)
        values ('frozen-module','frozen-org','Synthetic','frozen-module',1,0,'',''),
          ('frozen-other-module','frozen-org','Other','frozen-other-module',1,1,'','');
      insert into project_parameter_bindings(id,organization_id,project_id,parameter_spec_id,module_id)
        values ('frozen-binding','frozen-org','frozen-project','frozen-spec','frozen-module');
      insert into project_parameter_binding_revisions(id,binding_id,config_revision_id,parameter_spec_version_id,typed_value,canonical_value,raw_value)
        values ('frozen-v1','frozen-binding','frozen-r1','frozen-spec-v1','null',null,null),
          ('frozen-v2','frozen-binding','frozen-r2','frozen-spec-v1','"private-synthetic-value"','"private-synthetic-value"','private-synthetic-value');
    `);
    frozen = await captureFrozenSourceSnapshot({ pool, sourceMigrationsDirectory: sourceDirectory, candidateMigrationsDirectory: candidateDirectory });
  });
  afterAll(async () => {
    await pool?.end(); await migrationDb?.close(); await database?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("preserves the complete original projection while the actual candidate adds columns, tables and ledger entries", async () => {
    const input = { pool, descriptor: frozen, expectedDescriptorDigest: frozen.digest, candidateMigrationsDirectory: candidateDirectory };
    const progress = await inspectFrozenSourceSnapshotProgress(input);
    expect(progress.appliedSuffix).toBe(0);
    expect(progress.complete).toBe(false);
    expect(progress.verifiedRelations).toBe(frozen.relations.length);
    await pool.query("update organizations set name='changed-before-migration' where id='frozen-org'");
    try { await expect(inspectFrozenSourceSnapshotProgress(input)).rejects.toThrow("source-snapshot-row-drift"); }
    finally { await pool.query("update organizations set name='private-synthetic-value' where id='frozen-org'"); }
    await expect(verify()).rejects.toThrow("source-snapshot-migration-suffix-incomplete");
    // A URL/session search_path must not redirect the real runner away from the
    // public ledger that its frozen-source preflight verified.
    await pool.query("create schema shadow; create table shadow.schema_migrations(name text primary key,checksum text,applied_at timestamptz default now())");
    const shadowUrl = new URL(database.url);
    shadowUrl.searchParams.set("options", "-c search_path=shadow,public");
    const operationRoot = path.join(directory, "operation");
    await mkdir(operationRoot, { mode: 0o700 });
    const intent: ManagementMigrationIntent = { version: "pcat-management-migration-intent-v1", runId: "frozen-management",
      preparationPlanDigest: sha256Prefixed("isolated component preparation"), target: frozen.target,
      sourceSnapshotDigest: frozen.digest, candidateInventoryDigest: frozen.candidateInventoryDigest,
      writeFenceReceiptDigest: sha256Prefixed("component fixture has no application writers"),
      recoveryManifestDigest: sha256Prefixed("boundary port is isolated in this component test"), checkpointMode: "postgres" };
    const opened = openUpgradeJournal({ runId: intent.runId, journalPath: bindingJournalPath({ operationRoot, target: frozen.target, runId: intent.runId }) });
    if (!opened.ok) throw new Error("fixture-journal-open-failed");
    let managementReceipt: ManagementMigrationReceipt | undefined;
    let recomputed: ManagementMigrationReceipt | undefined;
    await withHostOperationLock(operationRoot, async operationLock => {
      const journal = createManagementMigrationJournal({ operationRoot, target: frozen.target, journal: opened.value, assertHeld: operationLock.assertHeld });
      managementReceipt = await runControlledManagementMigrations({ DATABASE_URL: shadowUrl.toString(), XIAOZE_CHECKPOINTER: "postgres" }, {
        ...input, intent, operationLock, journal,
        // This component proves the real migration/session/receipt boundary.
        // Real P2/P3 storage and writer producers are independently root-owned;
        // their deployment acceptance is not claimed by this port fixture.
        boundary: { verify: async observed => { expect(observed).toEqual(intent); } },
      });
      recomputed = await verifyControlledManagementMigrations({ DATABASE_URL: shadowUrl.toString(), XIAOZE_CHECKPOINTER: "postgres" }, {
        ...input, intent, operationLock, boundary: { verify: async observed => { expect(observed).toEqual(intent); } },
      });
      const state = readManagementMigrationAttempt(opened.value.record);
      if (state.status !== "committed") throw new Error("fixture-management-receipt-not-committed");
      const preparation = createManagementMigrationPreparation({
        environment: { DATABASE_URL: shadowUrl.toString(), XIAOZE_CHECKPOINTER: "postgres" },
        operationRoot, journalPath: opened.value.journalPath,
        context: { ...input, intent, operationLock, boundary: { verify: async observed => { expect(observed).toEqual(intent); } } },
      });
      expect(await preparation.verify({ receiptDigest: state.receiptDigest, target: frozen.target })).toEqual({
        receiptDigest: state.receiptDigest, sourceSnapshotDigest: frozen.digest, candidateInventoryDigest: frozen.candidateInventoryDigest,
      });
      await expect(preparation.verify({ receiptDigest: sha256Prefixed("another receipt"), target: frozen.target }))
        .rejects.toThrow("management-preparation-receipt-unavailable");
      await expect(preparation.verify({ receiptDigest: state.receiptDigest, target: { ...frozen.target, databaseOid: "0" } }))
        .rejects.toThrow("management-preparation-target-mismatch");
    });
    expect(managementReceipt).toEqual(recomputed);
    expect(recomputed!.checkpoint).toEqual({ mode: "postgres", status: "verified" });
    expect(verifyCommittedManagementMigration(opened.value.record, intent, recomputed!).attemptId).toBeTruthy();
    expect(opened.value.record.planDigest).toBeNull();
    expect((await pool.query("select count(*)::int as n from shadow.schema_migrations")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='shadow'")).rows[0].n).toBe(2);
    const receipt = await verify();
    expect(receipt.sourceSnapshotDigest).toBe(frozen.digest);
    expect(receipt.verifiedRelations).toBe(frozen.relations.length);
    expect(frozen.relations.find(relation => relation.name === "project_parameter_binding_revisions")?.rowCount).toBe(2);
    expect(JSON.stringify([frozen, receipt])).not.toContain("private-synthetic-value");
    expect(await applyMigrations(migrationDb, candidateDirectory)).toEqual([]);
    expect(await verify()).toEqual(receipt);
  });

  it("inspects a known committed suffix prefix while full completion remains refused", async () => {
    const partial = await createCheckedEmptyDatabase("frozenpartial");
    const partialDb = createPostgresDatabase(partial.url);
    const partialPool = new pg.Pool({ connectionString: partial.url });
    try {
      await applyMigrations(partialDb, sourceDirectory);
      await partialPool.query("insert into organizations(id,name) values ('partial-org','preserve this source row')");
      const descriptor = await captureFrozenSourceSnapshot({ pool: partialPool, sourceMigrationsDirectory: sourceDirectory, candidateMigrationsDirectory: candidateDirectory });
      const initialInput = { pool: partialPool, descriptor, expectedDescriptorDigest: descriptor.digest, candidateMigrationsDirectory: candidateDirectory };
      const intent: ManagementMigrationIntent = { version: "pcat-management-migration-intent-v1", runId: "refuse-schema-drift",
        preparationPlanDigest: sha256Prefixed("isolated schema-drift component preparation"), target: descriptor.target,
        sourceSnapshotDigest: descriptor.digest, candidateInventoryDigest: descriptor.candidateInventoryDigest,
        writeFenceReceiptDigest: sha256Prefixed("component writer-boundary fixture"), recoveryManifestDigest: sha256Prefixed("component recovery-boundary fixture"), checkpointMode: "memory" };
      const operationRoot = path.join(directory, "partial-operation");
      await mkdir(operationRoot, { mode: 0o700 });
      const assertRefusedBeforeIntent = async () => {
        let begins = 0;
        await withHostOperationLock(operationRoot, async operationLock => {
          await expect(runControlledManagementMigrations({ DATABASE_URL: partial.url }, {
            ...initialInput, intent, operationLock, boundary: { verify: async () => {} },
            journal: { begin: async () => { begins++; throw new Error("must not begin"); },
              finish: async () => { throw new Error("must not finish"); }, unknown: async () => { throw new Error("must not mark unknown"); } },
          })).rejects.toThrow("source-snapshot-source-schema-drift");
        });
        expect(begins).toBe(0);
        expect((await partialPool.query("select name from public.schema_migrations order by name collate \"C\"")).rows.map(row => row.name))
          .toEqual(descriptor.sourceMigrations.map(row => row.name));
      };
      await partialPool.query("create table public.unfrozen_business(id text); insert into public.unfrozen_business values ('not captured')");
      try {
        await expect(inspectFrozenSourceSnapshotProgress(initialInput)).rejects.toThrow("source-snapshot-source-schema-drift");
        await assertRefusedBeforeIntent();
      }
      finally { await partialPool.query("drop table public.unfrozen_business"); }
      await partialPool.query("alter table public.organizations add column uncaptured text default 'not captured'");
      try {
        await expect(inspectFrozenSourceSnapshotProgress(initialInput)).rejects.toThrow("source-snapshot-source-schema-drift");
        await assertRefusedBeforeIntent();
      }
      finally { await partialPool.query("alter table public.organizations drop column uncaptured"); }
      const first = descriptor.migrationSuffix[0];
      expect(first).toBeDefined();
      await applyMigrations(partialDb, candidateDirectory, { through: first!.name });
      const partialInput = { pool: partialPool, descriptor, expectedDescriptorDigest: descriptor.digest, candidateMigrationsDirectory: candidateDirectory };
      expect(await inspectFrozenSourceSnapshotProgress(partialInput)).toMatchObject({ appliedSuffix: 1, complete: false });
      await expect(verifyFrozenSourceSnapshot(partialInput)).rejects.toThrow("source-snapshot-migration-suffix-incomplete");
      await partialPool.query("update organizations set name='changed after partial migration' where id='partial-org'");
      await expect(inspectFrozenSourceSnapshotProgress(partialInput)).rejects.toThrow("source-snapshot-row-drift");
    } finally { await partialPool.end(); await partialDb.close(); await partial.close(); }
  });

  it("refuses business value drift without returning its value", async () => {
    await pool.query("update organizations set name='private-changed-value' where id='frozen-org'");
    try { await expect(verify()).rejects.toThrow("source-snapshot-row-drift"); }
    finally { await pool.query("update organizations set name='private-synthetic-value' where id='frozen-org'"); }
  });

  it("distinguishes SQL NULL from JSON null in an actual old Binding revision", async () => {
    // typed_value is NOT NULL in the actual old schema; canonical_value is nullable.
    await pool.query("update project_parameter_binding_revisions set canonical_value='null' where id='frozen-v1'");
    try { await expect(verify()).rejects.toThrow("source-snapshot-row-drift"); }
    finally { await pool.query("update project_parameter_binding_revisions set canonical_value=null where id='frozen-v1'"); }
  });

  it("refuses a changed Binding relationship even when all row counts stay equal", async () => {
    await pool.query("update project_parameter_bindings set module_id='frozen-other-module' where id='frozen-binding'");
    try { await expect(verify()).rejects.toThrow("source-snapshot-row-drift"); }
    finally { await pool.query("update project_parameter_bindings set module_id='frozen-module' where id='frozen-binding'"); }
  });

  it("rejects omission from the fixed descriptor", async () => {
    await expect(verifyFrozenSourceSnapshot({ pool, descriptor: { ...frozen, relations: frozen.relations.slice(1) },
      expectedDescriptorDigest: frozen.digest, candidateMigrationsDirectory: candidateDirectory })).rejects.toThrow("source-snapshot-descriptor-mismatch");
  });

  it("rejects changed old ledger checksums and unexpected additional suffix names", async () => {
    const original = frozen.sourceMigrations[0];
    await pool.query("update schema_migrations set checksum=$1 where name=$2", ["0".repeat(64), original.name]);
    try { await expect(verify()).rejects.toThrow("source-snapshot-migration-prefix-drift"); }
    finally { await pool.query("update schema_migrations set checksum=$1 where name=$2", [original.checksum, original.name]); }
    await pool.query("insert into schema_migrations(name,checksum) values('9999_unapproved_suffix.sql',$1)", ["a".repeat(64)]);
    try { await expect(verify()).rejects.toThrow("source-snapshot-migration-suffix-drift"); }
    finally { await pool.query("delete from schema_migrations where name='9999_unapproved_suffix.sql'"); }
  });

  it("rereads candidate SQL bytes rather than trusting a cached inventory", async () => {
    const file = path.join(candidateDirectory, frozen.migrationSuffix[0].name);
    const bytes = await readFile(file);
    await writeFile(file, Buffer.concat([bytes, Buffer.from("\n-- candidate drift\n")]));
    try { await expect(verify()).rejects.toThrow("source-snapshot-candidate-inventory-drift"); }
    finally { await writeFile(file, bytes); }
  });

  it("rejects the specific unsafe historical migration without confusing other 0121 filenames", async () => {
    expect(frozen.sourceMigrations.some(entry => entry.name.startsWith("0121_") && entry.name !== "0121_classify_nodename_driver_subjects.sql")).toBe(true);
    await pool.query("insert into schema_migrations(name,checksum) values('0121_classify_nodename_driver_subjects.sql',$1)", ["a".repeat(64)]);
    try { await expect(verify()).rejects.toThrow("source-snapshot-unsafe-historical-migration"); }
    finally { await pool.query("delete from schema_migrations where name='0121_classify_nodename_driver_subjects.sql'"); }
  });

  it("rejects a missing original column or relation even when its rows were empty", async () => {
    await pool.query("alter table organizations rename column name to moved_name");
    try { await expect(verify()).rejects.toThrow("source-snapshot-column-drift"); }
    finally { await pool.query("alter table organizations rename column moved_name to name"); }
    await pool.query("alter table parameter_policy_targets rename to moved_policy_targets");
    try { await expect(verify()).rejects.toThrow("source-snapshot-relation-drift"); }
    finally { await pool.query("alter table moved_policy_targets rename to parameter_policy_targets"); }
    expect((await verify()).sourceSnapshotDigest).toBe(frozen.digest);
  });
});
