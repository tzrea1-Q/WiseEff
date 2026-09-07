import type pg from "pg";
import { digestOf } from "../../release-verification/core/digest";
import { readBindingDatabaseIdentity } from "../../parameter-bindings/cutoverImport/sourceBoundary";
import { captureConversionSourceInventory } from "../conversionManifest";
import { MIGRATION_CONTRACT_VERSION, PRE_ACTIVATION_PHASES } from "../interface";
import { ActivationRefusal, type ActivationOptions } from "./interface";

export const requireActivationFact = (value: unknown, reason: string): void => {
  if (!value) throw new ActivationRefusal(reason);
};

/** Called only under the live owner's boundary. All mapping heads, including
 * heads outside this run, participate; missing/dangling heads cannot disappear
 * through an INNER JOIN. Values from legacy business rows leave only as digest.
 */
export async function readActivationFacts(client: pg.PoolClient, input: ActivationOptions) {
  const target = await readBindingDatabaseIdentity(client);
  requireActivationFact(digestOf(target) === digestOf(input.target), "target-mismatch");
  const run = (await client.query(`select id,plan_digest,source_snapshot_fingerprint,target_artifact_sha,
    target_catalog_release_digest,migration_contract_version,current_phase,state,pointer_rollback_closed_at
    from parameter_catalog.parameter_catalog_cutover_runs where id=$1`, [input.runId])).rows[0];
  requireActivationFact(run && ["P10", "P12"].includes(run.current_phase) && run.state === "completed" && run.pointer_rollback_closed_at === null, "run-not-prepared");
  const checkpoints = (await client.query(`select phase,checkpoint_digest,payload from parameter_catalog.parameter_catalog_cutover_checkpoints
    where cutover_run_id=$1 and phase=any($2::text[]) order by phase collate "C"`, [input.runId, PRE_ACTIVATION_PHASES])).rows;
  requireActivationFact(checkpoints.length === PRE_ACTIVATION_PHASES.length && PRE_ACTIVATION_PHASES.every(phase => checkpoints.some(row => row.phase === phase)), "checkpoint-missing");
  const p0 = checkpoints.find(row => row.phase === "P0")!.payload;
  requireActivationFact(p0.sourceSnapshotFingerprint === run.source_snapshot_fingerprint && p0.identityCount > 0, "source-checkpoint-mismatch");
  const p2 = checkpoints.find(row => row.phase === "P2")!.payload.bindingBoundaryReceipt;
  const p3 = checkpoints.find(row => row.phase === "P3")!.payload;
  const p4 = checkpoints.find(row => row.phase === "P4")!.payload;
  requireActivationFact(run.migration_contract_version === MIGRATION_CONTRACT_VERSION && p0.bindingImportIntent &&
    typeof p0.sourceInventoryFingerprint === "string" && p2 && p2.runId === run.id && p2.planDigest === run.plan_digest &&
    digestOf(p2.target) === digestOf(target) && p2.sourceInventoryFingerprint === p0.sourceInventoryFingerprint &&
    /^sha256:[a-f0-9]{64}$/.test(p2.writeFenceReceiptDigest) && /^sha256:[a-f0-9]{64}$/.test(p2.recoveryManifestDigest) &&
    p3.recoveryManifestDigest === p2.recoveryManifestDigest && p4.mode === "controlled-receipt-verified", "controlled-preparation-required");
  const migrations = (await client.query<{ name: string; checksum: string }>("select name,checksum from public.schema_migrations order by name collate \"C\"")).rows;
  requireActivationFact(input.expectedMigrations.length > 0 && digestOf(migrations) === digestOf(input.expectedMigrations), "migration-inventory-mismatch");
  const catalogRows = (await client.query(`select s.current_catalog_release_id as "releaseId",r.release_digest as "releaseDigest",
    m.compiled_fingerprint as "compiledModelDigest",m.database_fingerprint as "materializationFingerprint"
    from parameter_catalog.catalog_state s left join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id
    left join parameter_catalog.catalog_materializations m on m.release_id=s.current_catalog_release_id`)).rows;
  const catalog = catalogRows[0];
  requireActivationFact(catalogRows.length === 1 && catalog && Object.values(catalog).every(value => typeof value === "string" && value.length > 0) && catalog.releaseDigest === run.target_catalog_release_digest, "catalog-unavailable");
  const heads = (await client.query(`select i.id as legacy_identity_id,h.current_version_id,h.cas_version::text,to_jsonb(v) as version
    from parameter_catalog.legacy_identities i left join parameter_catalog.legacy_mapping_heads h on h.legacy_identity_id=i.id
    left join parameter_catalog.legacy_mapping_versions v on v.id=h.current_version_id and v.legacy_identity_id=i.id
    order by i.id collate "C"`)).rows;
  requireActivationFact(heads.length > 0 && heads.every(row => row.current_version_id && row.cas_version && row.version), "mapping-incomplete");
  requireActivationFact(heads.filter(row => row.version.cutover_run_id === run.id).length === p0.identityCount, "mapping-source-coverage-mismatch");
  const archives = (await client.query("select to_jsonb(a) as archive from parameter_catalog.parameter_catalog_archives a where cutover_run_id=$1 order by id collate \"C\"", [input.runId])).rows;
  requireActivationFact(archives.length > 0, "archive-missing");
  const sourceInventoryFingerprint = await captureConversionSourceInventory(client);
  requireActivationFact(p0.sourceInventoryFingerprint === sourceInventoryFingerprint, "source-drift");
  return {
    contract: "pcat-p12-activation-facts-v1",
    target,
    run: { id: run.id as string, planDigest: run.plan_digest as string, sourceSnapshotFingerprint: run.source_snapshot_fingerprint as string,
      artifactSha: run.target_artifact_sha as string, contractVersion: run.migration_contract_version as string },
    catalog: catalog as { releaseId: string; releaseDigest: string; compiledModelDigest: string; materializationFingerprint: string },
    migrations, migrationInventoryDigest: digestOf(migrations), sourceInventoryFingerprint,
    checkpointsDigest: digestOf(checkpoints), mappingHeadDigest: digestOf(heads), archiveManifestDigest: digestOf(archives),
    recoveryManifestDigest: p2.recoveryManifestDigest as string,
  };
}

export type ActivationFacts = Awaited<ReturnType<typeof readActivationFacts>>;

/** A stable epoch identifies one exact complete mapping/source/plan observation.
 * It does not confer approval. New heads or versions produce a different epoch.
 */
export const activationEpochFacts = (facts: ActivationFacts) => ({
  contract: "pcat-mapping-epoch-v1", target: facts.target, run: facts.run,
  sourceInventoryFingerprint: facts.sourceInventoryFingerprint,
  checkpointsDigest: facts.checkpointsDigest,
  mappingHeadDigest: facts.mappingHeadDigest,
});
export const activationEpochDigest = (facts: ActivationFacts): string => digestOf(activationEpochFacts(facts));
