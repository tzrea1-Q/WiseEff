import type pg from "pg";
import { digestOf } from "../release-verification/core/digest";
import { loadProjection } from "../catalog-kernel/runtime/currentSnapshot";
import { CatalogReleaseDigest, CatalogReleaseId } from "../parameter-catalog-contract/index";
import { readBindingDatabaseIdentity, type BindingDatabaseIdentity } from "../parameter-bindings/cutoverImport/sourceBoundary";

type Migration = { name: string; checksum: string };
type Run = {
  id: string; plan_digest: string; current_phase: string; state: string;
  source_snapshot_fingerprint: string; target_artifact_sha: string;
  target_catalog_release_digest: string; migration_contract_version: string;
  pointer_rollback_closed_at: string | null;
};
export type CutoverRuntimeObservation = {
  readonly database: BindingDatabaseIdentity;
  readonly migrationInventoryDigest: string;
  readonly migrations: readonly Migration[];
  readonly catalog: null | {
    readonly releaseId: string; readonly releaseDigest: string;
    readonly compiledFingerprint: string; readonly databaseFingerprint: string;
  };
  readonly run: Run | null;
  readonly checkpointsDigest: string;
  readonly mappingHeadsDigest: string;
  readonly archiveRecordsDigest: string;
  /** This observer owns no P12/P13 effect, writer retirement or runtime generation. */
  readonly approvalState: "not-produced";
};

export class RuntimeStateRefusal extends Error {
  constructor(readonly reason: "target-mismatch" | "migration-inventory-mismatch" |
    "catalog-unqueryable" | "query-failed" | "transaction-close-unknown") { super(reason); }
}

/** Read-only source/installer management observation. This pool never enters
 * runtime: catalog_migration_owner alone cannot read public.schema_migrations.
 * The expected ledger comes from the pinned
 * candidate package, never verification report pins. Kernel projection validation
 * runs on this exact session/snapshot, without a second pool or copied verifier.
 * Digests name observations, not mapping epochs or approved runtime pin fields.
 */
export async function observeCutoverRuntimeState(sourceInstallerPool: pg.Pool, input: {
  readonly target: BindingDatabaseIdentity;
  readonly runId: string;
  readonly expectedMigrations: readonly Migration[];
}): Promise<CutoverRuntimeObservation> {
  const selectedTarget = { ...input.target };
  const runId = input.runId;
  const expected = input.expectedMigrations.map(row => ({ ...row })).sort((a,b) => a.name.localeCompare(b.name));
  let client: pg.PoolClient;
  try { client = await sourceInstallerPool.connect(); }
  catch { throw new RuntimeStateRefusal("query-failed"); }
  let open = false;
  let destroy = false;
  let closing = false;
  try {
    const database = await readBindingDatabaseIdentity(client);
    if (database.systemIdentifier !== selectedTarget.systemIdentifier || database.databaseOid !== selectedTarget.databaseOid) throw new RuntimeStateRefusal("target-mismatch");
    await client.query("begin isolation level repeatable read read only"); open = true;
    await client.query("set local row_security=off");
    const migrations = (await client.query<Migration>("select name,checksum from public.schema_migrations order by name")).rows;
    if (!expected.length || migrations.some(row => !row.name || !/^[a-f0-9]{64}$/.test(row.checksum)) ||
        digestOf(migrations) !== digestOf(expected)) throw new RuntimeStateRefusal("migration-inventory-mismatch");
    const pointer = await client.query<{ current_catalog_release_id: string | null; release_digest: string | null }>(`select s.current_catalog_release_id,r.release_digest
      from parameter_catalog.catalog_state s left join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id`);
    if (pointer.rowCount === null || pointer.rowCount > 1) throw new RuntimeStateRefusal("catalog-unqueryable");
    const current = pointer.rows[0];
    let catalog: CutoverRuntimeObservation["catalog"] = null;
    if (current?.current_catalog_release_id) {
      if (!current.release_digest) throw new RuntimeStateRefusal("catalog-unqueryable");
      const pin = { id: CatalogReleaseId(current.current_catalog_release_id), digest: CatalogReleaseDigest(current.release_digest) };
      const loaded = await loadProjection(client, pin.id, "current", pin);
      if (!loaded || loaded.identity.id !== pin.id || loaded.identity.digest !== pin.digest) throw new RuntimeStateRefusal("catalog-unqueryable");
      catalog = { releaseId: loaded.identity.id, releaseDigest: loaded.identity.digest,
        compiledFingerprint: loaded.snapshot.compiledFingerprint, databaseFingerprint: loaded.snapshot.databaseFingerprint };
    }
    const run = (await client.query<Run>(`select id,plan_digest,current_phase,state,source_snapshot_fingerprint,
      target_artifact_sha,target_catalog_release_digest,migration_contract_version,pointer_rollback_closed_at::text
      from parameter_catalog.parameter_catalog_cutover_runs where id=$1`, [runId])).rows[0] ?? null;
    const checkpoints = (await client.query(`select phase,checkpoint_digest,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 order by phase`, [runId])).rows;
    const heads = (await client.query(`select h.legacy_identity_id,h.current_version_id,h.cas_version::text,to_jsonb(v) as version
      from parameter_catalog.legacy_mapping_heads h join parameter_catalog.legacy_mapping_versions v on v.id=h.current_version_id and v.legacy_identity_id=h.legacy_identity_id order by h.legacy_identity_id`)).rows;
    const archives = (await client.query("select to_jsonb(a) as archive from parameter_catalog.parameter_catalog_archives a where cutover_run_id=$1 order by id", [runId])).rows;
    closing = true;
    await client.query("rollback"); open = false; closing = false;
    return { database, migrations, migrationInventoryDigest: digestOf(migrations), catalog, run,
      checkpointsDigest: digestOf(checkpoints), mappingHeadsDigest: digestOf(heads), archiveRecordsDigest: digestOf(archives), approvalState: "not-produced" };
  } catch (error) {
    if (closing) { destroy = true; throw new RuntimeStateRefusal("transaction-close-unknown"); }
    if (open) {
      try { await client.query("rollback"); }
      catch { destroy = true; throw new RuntimeStateRefusal("transaction-close-unknown"); }
    }
    if (error instanceof RuntimeStateRefusal) throw error;
    throw new RuntimeStateRefusal("query-failed");
  } finally { client.release(destroy); }
}
