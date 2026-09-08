import type pg from "pg";
import { isDeepStrictEqual } from "node:util";
import { digestOf } from "../release-verification/core/digest";
import { createCatalogKernel } from "../catalog-kernel/interface";
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
    "catalog-unqueryable" | "query-failed" | "transaction-close-unknown" |
    "maintenance-boundary-unavailable" | "observation-drift") { super(reason); }
}

/** Implemented by the existing controller's real maintenance boundary, not a
 * boolean or receipt supplied by a caller. It must fence all relevant writers
 * across metadata observations and the Kernel-owned read transaction. A plain
 * advisory lock without writer participation is not that implementation.
 */
export type RuntimeObservationBoundary = {
  withLockedBoundary<T>(body: () => Promise<T>): Promise<T>;
  verify(target: BindingDatabaseIdentity): Promise<void>;
};

type RuntimeObservationInput = {
  readonly target: BindingDatabaseIdentity;
  readonly runId: string;
  readonly expectedMigrations: readonly Migration[];
};

/** Private metadata read only; this helper does not verify Kernel materialization. */
async function readMetadata(sourceInstallerPool: pg.Pool, input: RuntimeObservationInput): Promise<CutoverRuntimeObservation> {
  let client: pg.PoolClient;
  try { client = await sourceInstallerPool.connect(); }
  catch { throw new RuntimeStateRefusal("query-failed"); }
  let open = false;
  let destroy = false;
  let closing = false;
  try {
    const database = await readBindingDatabaseIdentity(client);
    if (database.systemIdentifier !== input.target.systemIdentifier || database.databaseOid !== input.target.databaseOid) throw new RuntimeStateRefusal("target-mismatch");
    await client.query("begin isolation level repeatable read read only"); open = true;
    await client.query("set local row_security=off");
    const migrations = (await client.query<Migration>("select name,checksum from public.schema_migrations order by name")).rows;
    if (!input.expectedMigrations.length || migrations.some(row => !row.name || !/^[a-f0-9]{64}$/.test(row.checksum)) ||
        digestOf(migrations) !== digestOf(input.expectedMigrations)) throw new RuntimeStateRefusal("migration-inventory-mismatch");
    const pointer = await client.query<{ current_catalog_release_id: string | null; release_digest: string | null; compiled_fingerprint: string | null; database_fingerprint: string | null }>(`select s.current_catalog_release_id,r.release_digest,m.compiled_fingerprint,m.database_fingerprint
      from parameter_catalog.catalog_state s left join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id
      left join parameter_catalog.catalog_materializations m on m.release_id=s.current_catalog_release_id`);
    if (pointer.rowCount === null || pointer.rowCount > 1) throw new RuntimeStateRefusal("catalog-unqueryable");
    const current = pointer.rows[0];
    let catalog: CutoverRuntimeObservation["catalog"] = null;
    if (current?.current_catalog_release_id) {
      if (!current.release_digest || !current.compiled_fingerprint || !current.database_fingerprint) throw new RuntimeStateRefusal("catalog-unqueryable");
      catalog = { releaseId: current.current_catalog_release_id, releaseDigest: current.release_digest,
        compiledFingerprint: current.compiled_fingerprint, databaseFingerprint: current.database_fingerprint };
    }
    const run = (await client.query<Run>(`select id,plan_digest,current_phase,state,source_snapshot_fingerprint,
      target_artifact_sha,target_catalog_release_digest,migration_contract_version,pointer_rollback_closed_at::text
      from parameter_catalog.parameter_catalog_cutover_runs where id=$1`, [input.runId])).rows[0] ?? null;
    const checkpoints = (await client.query(`select phase,checkpoint_digest,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 order by phase`, [input.runId])).rows;
    const heads = (await client.query(`select h.legacy_identity_id,h.current_version_id,h.cas_version::text,to_jsonb(v) as version
      from parameter_catalog.legacy_mapping_heads h join parameter_catalog.legacy_mapping_versions v on v.id=h.current_version_id and v.legacy_identity_id=h.legacy_identity_id order by h.legacy_identity_id`)).rows;
    const archives = (await client.query("select to_jsonb(a) as archive from parameter_catalog.parameter_catalog_archives a where cutover_run_id=$1 order by id", [input.runId])).rows;
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

/** The source/installer pool never enters runtime. Catalog Kernel owns its own
 * public loadCurrentCatalog transaction; no client/callback crosses that seam.
 * The controller must supply cross-transaction stability. Both complete metadata
 * observations and all public snapshot pins must agree before returning facts.
 */
export async function observeCutoverRuntimeState(sourceInstallerPool: pg.Pool, input: RuntimeObservationInput,
  boundary: RuntimeObservationBoundary): Promise<CutoverRuntimeObservation> {
  if (!boundary || typeof boundary.withLockedBoundary !== "function" || typeof boundary.verify !== "function") throw new RuntimeStateRefusal("maintenance-boundary-unavailable");
  const fixed = { target: { ...input.target }, runId: input.runId,
    expectedMigrations: input.expectedMigrations.map(row => ({ ...row })).sort((a,b) => a.name.localeCompare(b.name)) };
  try {
    return await boundary.withLockedBoundary(async () => {
      const verify = async () => {
        try { await boundary.verify({ ...fixed.target }); }
        catch { throw new RuntimeStateRefusal("maintenance-boundary-unavailable"); }
      };
      await verify();
      const before = await readMetadata(sourceInstallerPool, fixed);
      await verify();
      if (before.catalog) {
        const loaded = await createCatalogKernel(sourceInstallerPool).loadCurrentCatalog({
          id: CatalogReleaseId(before.catalog.releaseId), digest: CatalogReleaseDigest(before.catalog.releaseDigest),
        });
        if (!loaded.ok || !isDeepStrictEqual(before.catalog, { releaseId: loaded.value.release.id,
          releaseDigest: loaded.value.release.digest, compiledFingerprint: loaded.value.compiledFingerprint,
          databaseFingerprint: loaded.value.databaseFingerprint })) throw new RuntimeStateRefusal("catalog-unqueryable");
      }
      await verify();
      const after = await readMetadata(sourceInstallerPool, fixed);
      await verify();
      if (!isDeepStrictEqual(before, after)) throw new RuntimeStateRefusal("observation-drift");
      return before;
    });
  } catch (error) {
    if (error instanceof RuntimeStateRefusal) throw error;
    throw new RuntimeStateRefusal("maintenance-boundary-unavailable");
  }
}
