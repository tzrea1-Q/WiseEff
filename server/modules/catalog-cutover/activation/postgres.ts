import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type pg from "pg";
import { digestOf } from "../../release-verification/core/digest";
import { PRE_ACTIVATION_PHASES } from "../interface";
import type { ActivationBinding, ActivationIdentity, ActivationIntent } from "./interface";
import { activationHead, decodeBinding, refuse } from "./records";

export const ACTIVATION_EVENT = "application-read-activated";
const EPOCH_EVENT = "activation-mapping-epoch";
type Run = {
  id: string; plan_digest: string; source_snapshot_fingerprint: string;
  target_artifact_sha: string; target_catalog_release_digest: string;
  migration_contract_version: string; current_phase: string; state: string;
  pointer_rollback_closed_at: string | null;
};
type Catalog = ActivationBinding["catalog"];
export type ActivationFacts = {
  target: ActivationIdentity; run: Run; catalog: Catalog; headDigest: string;
  versionInventoryDigest: string; mappingEpoch: string | null; currentBinding: ActivationBinding | null;
};

export async function physicalIdentity(client: pg.PoolClient): Promise<ActivationIdentity> {
  const result = await client.query<ActivationIdentity>(`select s.system_identifier::text as "systemIdentifier", d.oid::text as "databaseOid"
    from pg_catalog.pg_control_system() s cross join pg_catalog.pg_database d where d.datname=pg_catalog.current_database()`);
  if (result.rowCount !== 1 || !result.rows[0]) refuse("TARGET-UNAVAILABLE");
  return result.rows[0];
}

export async function readActivationChain(client: pg.PoolClient, target: ActivationIdentity): Promise<ActivationBinding | null> {
  const events = await client.query<{ cutover_run_id: string; payload: unknown }>(
    "select cutover_run_id,payload from parameter_catalog.parameter_catalog_cutover_events where event_kind=$1", [ACTIVATION_EVENT]);
  const checkpoints = await client.query<{ cutover_run_id: string; checkpoint_digest: string; payload: unknown }>(
    "select cutover_run_id,checkpoint_digest,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where phase='P12'");
  if (events.rows.length !== checkpoints.rows.length) refuse("CHECKPOINT-INCONSISTENT");
  for (const event of events.rows) {
    const binding = decodeBinding(event.payload);
    const checkpoint = checkpoints.rows.filter(row => row.cutover_run_id === event.cutover_run_id);
    if (binding.intent.runId !== event.cutover_run_id || !isDeepStrictEqual(binding.intent.target, target) || checkpoint.length !== 1 ||
        checkpoint[0]!.checkpoint_digest !== binding.bindingDigest || !isDeepStrictEqual(checkpoint[0]!.payload, binding)) refuse("CHECKPOINT-INCONSISTENT");
    const run = await client.query<{ current_phase: string; plan_digest: string }>(
      "select current_phase,plan_digest from parameter_catalog.parameter_catalog_cutover_runs where id=$1", [binding.intent.runId]);
    if (run.rowCount !== 1 || !/^P1[2-6]$/.test(run.rows[0]!.current_phase) || run.rows[0]!.plan_digest !== binding.intent.planDigest) refuse("CHECKPOINT-INCONSISTENT");
  }
  return activationHead(events.rows.map(row => row.payload));
}

export async function readFacts(client: pg.PoolClient, target: ActivationIdentity, runId: string, planDigest: string): Promise<ActivationFacts> {
  if (!isDeepStrictEqual(await physicalIdentity(client), target)) refuse("TARGET-MISMATCH");
  const rows = await client.query<Run>(`select id,plan_digest,source_snapshot_fingerprint,target_artifact_sha,
    target_catalog_release_digest,migration_contract_version,current_phase,state,pointer_rollback_closed_at::text
    from parameter_catalog.parameter_catalog_cutover_runs where id=$1`, [runId]);
  const run = rows.rows[0];
  if (rows.rowCount !== 1 || !run || run.plan_digest !== planDigest) refuse("RUN-MISMATCH");
  const checkpoints = (await client.query<{ phase: string; checkpoint_digest: string; payload: Record<string, unknown> }>(
    "select phase,checkpoint_digest,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1", [runId])).rows;
  for (const phase of PRE_ACTIVATION_PHASES) {
    const found = checkpoints.filter(row => row.phase === phase);
    if (found.length !== 1 || !found[0]!.checkpoint_digest || !found[0]!.payload) refuse("PREPARATION-INCOMPLETE");
  }
  const p0 = checkpoints.find(row => row.phase === "P0")!.payload;
  if (p0.sourceSnapshotFingerprint !== run.source_snapshot_fingerprint || !Number.isSafeInteger(p0.identityCount) || Number(p0.identityCount) <= 0) refuse("SOURCE-INCOMPLETE");
  const current = await client.query<{ releaseId: string | null; releaseDigest: string | null; compiledFingerprint: string | null; databaseFingerprint: string | null }>(`select s.current_catalog_release_id as "releaseId",r.release_digest as "releaseDigest",
    m.compiled_fingerprint as "compiledFingerprint",m.database_fingerprint as "databaseFingerprint"
    from parameter_catalog.catalog_state s left join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id
    left join parameter_catalog.catalog_materializations m on m.release_id=s.current_catalog_release_id`);
  if (current.rowCount !== 1 || !current.rows[0] || Object.values(current.rows[0]).some(value => typeof value !== "string" || !value.trim())) refuse("CATALOG-UNAVAILABLE");
  const catalog = current.rows[0] as Catalog;
  if (catalog.releaseDigest !== run.target_catalog_release_digest) refuse("CATALOG-MISMATCH");
  const heads = (await client.query<{ legacy_identity_id: string; current_version_id: string; cas_version: string; version: unknown; identity: unknown }>(`select h.legacy_identity_id,h.current_version_id,h.cas_version::text,to_jsonb(v) as version,to_jsonb(i) as identity
    from parameter_catalog.legacy_mapping_heads h left join parameter_catalog.legacy_mapping_versions v
    on v.id=h.current_version_id and v.legacy_identity_id=h.legacy_identity_id
    left join parameter_catalog.legacy_identities i on i.id=h.legacy_identity_id order by h.legacy_identity_id`)).rows;
  if (!heads.length || heads.some(row => !row.version || !row.identity) || new Set(heads.map(row => row.legacy_identity_id)).size !== heads.length) refuse("MAPPING-INCOMPLETE");
  const versions = (await client.query<{ id: string; version: unknown; identity: unknown }>(`select v.id,to_jsonb(v) as version,to_jsonb(i) as identity
    from parameter_catalog.legacy_mapping_versions v left join parameter_catalog.legacy_identities i on i.id=v.legacy_identity_id order by v.id`)).rows;
  if (!versions.length || versions.some(row => !row.identity) || new Set(versions.map(row => row.id)).size !== versions.length) refuse("MAPPING-INCOMPLETE");
  const headDigest = digestOf(heads);
  const versionInventoryDigest = digestOf(versions);
  const basis = { version: "pcat-activation-mapping-v1", target, runId, planDigest,
    sourceSnapshotFingerprint: run.source_snapshot_fingerprint, headDigest, versionInventoryDigest };
  const epoch = digestOf(basis);
  const epochs = (await client.query<{ payload: unknown }>(`select payload from parameter_catalog.parameter_catalog_cutover_events
    where cutover_run_id=$1 and phase='P11' and event_kind=$2`, [runId, EPOCH_EVENT])).rows;
  const seen = new Set<string>();
  for (const row of epochs) {
    if (!row.payload || typeof row.payload !== "object") refuse("MAPPING-EPOCH-CONFLICT");
    const stored = row.payload as typeof basis & { epoch: string };
    const { epoch: priorEpoch, ...priorBasis } = stored;
    if (!/^sha256:[a-f0-9]{64}$/.test(stored.headDigest) || !/^sha256:[a-f0-9]{64}$/.test(stored.versionInventoryDigest) ||
        !isDeepStrictEqual(priorBasis, { ...basis, headDigest: stored.headDigest, versionInventoryDigest: stored.versionInventoryDigest }) ||
        priorEpoch !== digestOf(priorBasis) || seen.has(priorEpoch)) refuse("MAPPING-EPOCH-CONFLICT");
    seen.add(priorEpoch);
  }
  return { target, run, catalog, headDigest, versionInventoryDigest, mappingEpoch: seen.has(epoch) ? epoch : null,
    currentBinding: await readActivationChain(client, target) };
}

async function insertEvent(client: pg.PoolClient, runId: string, phase: string, kind: string, payload: unknown) {
  await client.query(`insert into parameter_catalog.parameter_catalog_cutover_events
    (id,cutover_run_id,sequence_number,phase,event_kind,payload)
    select $1,$2,coalesce(max(sequence_number),0)+1,$3,$4,$5::jsonb
    from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$2`,
  [`activation_${randomUUID()}`, runId, phase, kind, JSON.stringify(payload)]);
}

export async function persistMappingEpoch(client: pg.PoolClient, facts: ActivationFacts): Promise<string> {
  if (facts.mappingEpoch) return facts.mappingEpoch;
  if (facts.run.current_phase !== "P10" || facts.run.state !== "completed") refuse("PREPARATION-INCOMPLETE");
  const basis = { version: "pcat-activation-mapping-v1", target: facts.target, runId: facts.run.id,
    planDigest: facts.run.plan_digest, sourceSnapshotFingerprint: facts.run.source_snapshot_fingerprint, headDigest: facts.headDigest,
    versionInventoryDigest: facts.versionInventoryDigest };
  const epoch = digestOf(basis);
  await insertEvent(client, facts.run.id, "P11", EPOCH_EVENT, { ...basis, epoch });
  return epoch;
}

export async function persistActivation(client: pg.PoolClient, facts: ActivationFacts, binding: ActivationBinding): Promise<void> {
  const existing = await client.query("select 1 from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 and phase='P12'", [binding.intent.runId]);
  if (existing.rowCount !== 0 || facts.run.current_phase !== "P10" || facts.run.state !== "completed") refuse("ACTIVATION-CONFLICT");
  if ((facts.currentBinding?.bindingDigest ?? null) !== binding.intent.predecessorBindingDigest) refuse("PREDECESSOR-MISMATCH");
  const changed = await client.query(`update parameter_catalog.parameter_catalog_cutover_runs set current_phase='P12',state='running',updated_at=now()
    where id=$1 and plan_digest=$2 and current_phase='P10' and state='completed' and pointer_rollback_closed_at is null`, [binding.intent.runId, binding.intent.planDigest]);
  if (changed.rowCount !== 1) refuse("ACTIVATION-CONFLICT");
  await insertEvent(client, binding.intent.runId, "P12", ACTIVATION_EVENT, binding);
  await client.query(`insert into parameter_catalog.parameter_catalog_cutover_checkpoints
    (cutover_run_id,phase,checkpoint_digest,payload) values($1,'P12',$2,$3::jsonb)`, [binding.intent.runId, binding.bindingDigest, JSON.stringify(binding)]);
}

export function inspectIntent(facts: ActivationFacts, intent: ActivationIntent) {
  const current = facts.currentBinding;
  if (current?.intent.attemptId === intent.attemptId) {
    if (!isDeepStrictEqual(current.intent, intent)) refuse("ATTEMPT-CONFLICT");
    return { kind: "applied" as const, binding: current, currentHeadDigest: current.bindingDigest };
  }
  if (facts.run.current_phase !== "P10" || facts.run.state !== "completed" ||
      (current?.bindingDigest ?? null) !== intent.predecessorBindingDigest) refuse("ACTIVATION-CONFLICT");
  return { kind: "not-applied" as const, intent, currentHeadDigest: current?.bindingDigest ?? null };
}
