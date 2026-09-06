/** Internal S6 management seam. Deliberately absent from the runtime public index. */
import { createHash } from "node:crypto";
import type pg from "pg";
import { serializeContract, type ContractJsonValue } from "../../parameter-catalog-contract/index";
import { createArchiveAdapter, type ArchiveAdapterOptions } from "../../catalog-cutover/archive";
import { appendCutoverEvent } from "../../catalog-cutover/checkpoints";
import { insertBinding } from "../binding/repositories";
import { digestProjectValuePayload, insertProjectValue } from "../values/repositories";
import type { ProjectValueKind, ProjectValuePayload } from "../values/types";
import { captureBindingImportIntent, type BindingImportIntent } from "./intent";

export type BindingImportEntry = {
  readonly sourceBindingId: string;
  readonly archiveId: string;
  readonly sourceChecksum: string;
  readonly definitionMappingVersionId: string;
  readonly registrationId: string;
  /** Explicit source authority; the importer never chooses the newest revision. */
  readonly sourceTipRevisionId: string;
  readonly revisions: readonly {
    readonly sourceRevisionId: string;
    readonly revisionMappingVersionId: string;
    readonly retainedReleaseId: string;
    readonly sourceAuditRef: string;
  }[];
};

export type BindingImportManifest = {
  readonly version: "s6-binding-import-v1" | "s6-binding-import-v2";
  readonly intentDigest?: string;
  readonly mappingPins?: readonly {identityId:string;versionId:string;casVersion:number}[];
  readonly runId: string;
  readonly planDigest: string;
  readonly sourceSnapshotFingerprint: string;
  readonly sourceInventoryFingerprint: string;
  readonly bindings: readonly BindingImportEntry[];
};

export const bindingImportDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(serializeContract(value as ContractJsonValue)).digest("hex")}`;

type SourceBinding = {
  id: string; organization_id: string; project_id: string; logical_node_id: string | null;
  parameter_spec_id: string; module_id: string; created_at: string;
};
type SourceRevision = {
  id: string; binding_id: string; config_revision_id: string; parameter_spec_version_id: string;
  typed_value: ContractJsonValue; created_at: string;
};
export type BindingImportSource = {
  binding: SourceBinding;
  revisions: SourceRevision[];
  configRevisions: Record<string, ContractJsonValue>[];
  specVersions: Record<string, ContractJsonValue>[];
  auditEvents: Record<string, ContractJsonValue>[];
};

export type DefinitionBindingImportSource = {
  version: "s6-definition-binding-source-v1";
  parameterSpec: Record<string, ContractJsonValue>;
  specVersions: Record<string, ContractJsonValue>[];
  bindings: BindingImportSource[];
};

/** Full rows, including raw/schema/policy and SQL-null flags, remain private. */
export async function captureBindingImportSource(client: Pick<pg.PoolClient, "query">, bindingId: string): Promise<BindingImportSource> {
  const binding = await client.query<{ row: SourceBinding }>("select to_jsonb(b) as row from public.project_parameter_bindings b where b.id=$1", [bindingId]);
  if (binding.rowCount !== 1) throw new ImportRefusal("source-binding-absent");
  const revisions = await client.query<{ row: SourceRevision }>(`select to_jsonb(r) || jsonb_build_object('typed_value_sql_null',r.typed_value is null,'canonical_value_sql_null',r.canonical_value is null) as row
    from public.project_parameter_binding_revisions r where binding_id=$1 order by id`, [bindingId]);
  const configs = await client.query<{ row: Record<string, ContractJsonValue> }>(`select to_jsonb(c) as row from public.dts_config_revisions c where id in (select config_revision_id from public.project_parameter_binding_revisions where binding_id=$1) order by id`, [bindingId]);
  const specs = await client.query<{ row: Record<string, ContractJsonValue> }>(`select to_jsonb(s) as row from public.parameter_spec_versions s where id in (select parameter_spec_version_id from public.project_parameter_binding_revisions where binding_id=$1) order by id`, [bindingId]);
  const audits = await client.query<{ row: Record<string, ContractJsonValue> }>(`select to_jsonb(a) as row from public.audit_events a where target_id in (select id from public.project_parameter_binding_revisions where binding_id=$1) order by id`, [bindingId]);
  return { binding: binding.rows[0].row, revisions: revisions.rows.map(r => r.row), configRevisions: configs.rows.map(r => r.row), specVersions: specs.rows.map(r => r.row), auditEvents: audits.rows.map(r => r.row) };
}

/** One formal definition can serve many projects. Its evidence is one complete graph. */
export async function captureDefinitionBindingImportSource(client: Pick<pg.PoolClient, "query">, specId: string): Promise<DefinitionBindingImportSource> {
  const spec = await client.query<{ row: Record<string, ContractJsonValue> }>("select to_jsonb(s) as row from public.parameter_specs s where id=$1", [specId]);
  requireFact(spec.rowCount === 1, "source-definition-absent");
  const versions = await client.query<{ row: Record<string, ContractJsonValue> }>("select to_jsonb(v) as row from public.parameter_spec_versions v where parameter_spec_id=$1 order by id", [specId]);
  const ids = await client.query<{ id: string }>("select id from public.project_parameter_bindings where parameter_spec_id=$1 order by id", [specId]);
  const bindings: BindingImportSource[] = [];
  for (const row of ids.rows) bindings.push(await captureBindingImportSource(client,row.id));
  return {version:"s6-definition-binding-source-v1",parameterSpec:spec.rows[0].row,specVersions:versions.rows.map(v => v.row),bindings};
}

class ImportRefusal extends Error {
  constructor(message: string, readonly typedCause?: string) { super(message); }
}
const requireFact = (condition: unknown, reason: string): void => { if (!condition) throw new ImportRefusal(reason); };
const valueKind = (value: ContractJsonValue): ProjectValueKind => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return typeof value as "string" | "number" | "boolean";
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "string")) return "string-array";
  if (Array.isArray(value) && value.length > 0 && value.every(v => typeof v === "number")) return "number-array";
  return "json";
};

async function mapping(client: pg.PoolClient, id: string, runId: string, sourceId: string, sourceKind: string, targetKind: string, evidenceArchiveId?: string, sourceChecksum?: string): Promise<string> {
  const found = await client.query<{ target_id: string }>(`select v.target_id from parameter_catalog.legacy_mapping_versions v
    join parameter_catalog.legacy_mapping_heads h on h.current_version_id=v.id and h.legacy_identity_id=v.legacy_identity_id
    join parameter_catalog.legacy_identities i on i.id=v.legacy_identity_id
    where v.id=$1 and v.cutover_run_id=$2 and i.source_id=$3 and i.source_kind=$4 and v.target_kind=$5
      and ($6::text is null or v.evidence_archive_id=$6) and ($7::text is null or v.source_checksum=$7)`, [id,runId,sourceId,sourceKind,targetKind,evidenceArchiveId ?? null,sourceChecksum ?? null]);
  requireFact(found.rowCount === 1, "mapping-authority-mismatch");
  return found.rows[0].target_id;
}

export type BindingImportResult =
  | { ok: true; status: "imported" | "already-imported"; manifestDigest: string; bindings: number; values: number }
  | { ok: false; reason: string; typedCause?: string };

type ImportRequest = {
  runId: string;
  planDigest: string;
  manifestDigest: string;
  archive: Omit<ArchiveAdapterOptions, "client" | "failAfter">;
};

/** Requires a real parent transaction: SAVEPOINT fails outside one. No lock-trust flag exists. */
async function importOnClient(client: pg.PoolClient, input: ImportRequest, contract: "historical-v1" | "prepared-v2" | "verify-v2"): Promise<BindingImportResult> {
  try {
    await client.query("savepoint s6_binding_import_scope");
    const login = await client.query<{ safe: boolean }>(`select (not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolreplication and not rolinherit
      and pg_has_role(session_user,'catalog_migration_owner','MEMBER')
      and not exists (select 1 from pg_roles inherited where pg_has_role(session_user,inherited.oid,'MEMBER')
        and (inherited.rolsuper or inherited.rolbypassrls or inherited.rolcreatedb or inherited.rolcreaterole or inherited.rolreplication))) as safe from pg_roles where rolname=session_user`);
    requireFact(login.rows[0]?.safe, "management-login-required");
    await client.query("set local role catalog_migration_owner");
    await client.query("set local search_path=pg_catalog,parameter_catalog");
    // Restricted readers must fail explicitly if an RLS policy hides any source row.
    await client.query("set local row_security=off");
    const locked = await client.query<{ acquired: boolean }>("select pg_try_advisory_xact_lock(hashtext('s7-orc-cutover-target'),hashtext(current_database())) as acquired");
    requireFact(locked.rows[0]?.acquired, "cutover-target-lock-held");
    const run = await client.query<{ plan_digest: string; source_snapshot_fingerprint: string; target_catalog_release_digest: string; current_phase: string; state: string; pointer_rollback_closed_at: unknown }>("select plan_digest,source_snapshot_fingerprint,target_catalog_release_digest,current_phase,state,pointer_rollback_closed_at from parameter_catalog.parameter_catalog_cutover_runs where id=$1 for update", [input.runId]);
    const r = run.rows[0];
    requireFact(r && r.plan_digest === input.planDigest && (contract === "verify-v2" ? r.current_phase === "P10" && r.state === "completed" : ["P8","P9"].includes(r.current_phase) && r.state === "running") && r.pointer_rollback_closed_at === null, "run-not-applicable");
    const current = await client.query("select 1 from parameter_catalog.catalog_state s join parameter_catalog.catalog_releases r on r.id=s.current_catalog_release_id join parameter_catalog.catalog_materializations m on m.release_id=r.id where s.singleton and r.release_digest=$1",[r.target_catalog_release_digest]);
    requireFact(current.rowCount === 1, "target-release-drift");
    const checkpoints = await client.query<{ phase: string; payload: Record<string, unknown> }>("select phase,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 and phase in ('P0','P8')", [input.runId]);
    const p0 = checkpoints.rows.find(v => v.phase === "P0")?.payload;
    const manifest = checkpoints.rows.find(v => v.phase === "P8")?.payload.bindingImport as BindingImportManifest | undefined;
    requireFact(manifest && bindingImportDigest(manifest) === input.manifestDigest, "manifest-pin-mismatch");
    const m = manifest!;
    requireFact(m.version === (contract === "historical-v1" ? "s6-binding-import-v1":"s6-binding-import-v2") && m.runId === input.runId && m.planDigest === input.planDigest && m.sourceSnapshotFingerprint === r.source_snapshot_fingerprint && m.sourceInventoryFingerprint === p0?.sourceInventoryFingerprint, "manifest-lineage-mismatch");
    requireFact(Array.isArray(m.bindings) && m.bindings.length > 0 && new Set(m.bindings.map(b => b.sourceBindingId)).size === m.bindings.length, "binding-conservation");
    if (contract === "historical-v1") {
      requireFact(p0?.bindingImportManifestDigest === input.manifestDigest, "manifest-pin-mismatch");
    } else {
      const intent = p0?.bindingImportIntent as BindingImportIntent | undefined;
      requireFact(intent && p0?.bindingImportIntentDigest === m.intentDigest && bindingImportDigest(intent) === m.intentDigest, "import-intent-pin-mismatch");
      const observed = await captureBindingImportIntent(client,{sourceSnapshotFingerprint:m.sourceSnapshotFingerprint,sourceInventoryFingerprint:m.sourceInventoryFingerprint});
      requireFact(bindingImportDigest(observed) === m.intentDigest, "import-intent-source-drift");
      requireFact(observed.bindings.length === m.bindings.length && observed.bindings.every(b => m.bindings.some(e => e.sourceBindingId === b.sourceBindingId && e.sourceChecksum === b.sourceChecksum && e.sourceTipRevisionId === b.sourceTipRevisionId)), "all-source-binding-conservation");
      requireFact(Array.isArray(m.mappingPins) && m.mappingPins.length > 0 && new Set(m.mappingPins.map(p => p.identityId)).size === m.mappingPins.length,"import-mapping-pins-required");
      for (const pin of m.mappingPins!) {
        const current = await client.query("select 1 from parameter_catalog.legacy_mapping_heads h join parameter_catalog.legacy_mapping_versions v on v.id=h.current_version_id and v.legacy_identity_id=h.legacy_identity_id where h.legacy_identity_id=$1 and h.current_version_id=$2 and h.cas_version=$3 and v.cutover_run_id=$4",[pin.identityId,pin.versionId,pin.casVersion,input.runId]);
        requireFact(current.rowCount === 1,"import-mapping-pin-drift");
      }
    }
    const done = await client.query<{ payload: Record<string, unknown> }>("select payload from parameter_catalog.parameter_catalog_cutover_events where cutover_run_id=$1 and event_kind='s6-binding-import-completed'", [input.runId]);
    requireFact(done.rowCount === 0 || (done.rowCount === 1 && done.rows[0].payload.manifestDigest === input.manifestDigest), "import-receipt-conflict");
    if (contract === "verify-v2") requireFact(done.rowCount === 1,"import-completion-receipt-required");
    let values = 0;
    const definitionGraphs = new Map<string, DefinitionBindingImportSource>();
    for (const entry of m.bindings) {
      const source = await captureBindingImportSource(client, entry.sourceBindingId);
      requireFact(bindingImportDigest(source) === entry.sourceChecksum, "source-bytes-drift");
      const restored = await createArchiveAdapter({ ...input.archive, client }).restoreArchive({ actor: { role: "cutover-operator", auditRef: input.runId }, archiveId: entry.archiveId });
      if (!restored.ok) throw new ImportRefusal("source-archive-unavailable",restored.error.code);
      let definitionGraph = definitionGraphs.get(source.binding.parameter_spec_id);
      if (!definitionGraph) {
        definitionGraph = await captureDefinitionBindingImportSource(client,source.binding.parameter_spec_id);
        definitionGraphs.set(source.binding.parameter_spec_id,definitionGraph);
      }
      const archiveChecksum = bindingImportDigest(definitionGraph);
      requireFact(restored.value.metadata.cutoverRunId === input.runId && bindingImportDigest(restored.value.sourceGraph.sourcePayload) === archiveChecksum, "source-archive-mismatch");
      requireFact(definitionGraph.bindings.every(b => m.bindings.some(e => e.sourceBindingId === b.binding.id && e.archiveId === entry.archiveId && e.definitionMappingVersionId === entry.definitionMappingVersionId && e.sourceChecksum === bindingImportDigest(b))), "definition-binding-conservation");
      requireFact(entry.revisions.length > 0 && new Set(entry.revisions.map(v => v.sourceRevisionId)).size === entry.revisions.length && entry.revisions.map(v => v.sourceRevisionId).sort().join("\0") === source.revisions.map(v => v.id).sort().join("\0"), "revision-conservation");
      const definitionId = await mapping(client,entry.definitionMappingVersionId,input.runId,source.binding.parameter_spec_id,"parameter-spec","parameter-definition",entry.archiveId,archiveChecksum);
      const reg = await client.query<{ subject_id: string }>(`select r.subject_id from parameter_catalog.organization_subject_registrations r
        join parameter_catalog.parameter_definitions d on d.subject_id=r.subject_id
        join parameter_catalog.subject_placements p on p.id=r.current_placement_id and p.registration_id=r.id
        where r.id=$1 and r.organization_id=$2 and r.status='active' and d.id=$3 and p.module_id=$4`, [entry.registrationId,source.binding.organization_id,definitionId,source.binding.module_id]);
      requireFact(reg.rowCount === 1 && source.binding.logical_node_id, "binding-agreement-mismatch");
      const imported = [];
      for (const revision of entry.revisions) {
        const row = source.revisions.find(v => v.id === revision.sourceRevisionId)!;
        const revisionId = await mapping(client,revision.revisionMappingVersionId,input.runId,row.parameter_spec_version_id,"parameter-spec-version","definition-revision");
        const head = await client.query(`select 1 from parameter_catalog.catalog_release_definition_heads h join parameter_catalog.catalog_materializations m on m.release_id=h.release_id where h.release_id=$1 and h.definition_id=$2 and h.revision_id=$3 and m.compiled_fingerprint=m.database_fingerprint`, [revision.retainedReleaseId,definitionId,revisionId]);
        requireFact(head.rowCount === 1, "historical-release-pin-mismatch");
        const config = source.configRevisions.find(c => c.id === row.config_revision_id);
        const spec = source.specVersions.find(s => s.id === row.parameter_spec_version_id);
        const audit = source.auditEvents.find(a => a.id === revision.sourceAuditRef);
        requireFact(config?.organization_id === source.binding.organization_id && config?.project_id === source.binding.project_id && spec?.parameter_spec_id === source.binding.parameter_spec_id && audit?.organization_id === source.binding.organization_id && audit?.project_id === source.binding.project_id && audit?.target_id === row.id, "source-relationship-mismatch");
        requireFact((row as unknown as Record<string, unknown>).typed_value_sql_null === false, "missing-project-value");
        imported.push({ row, revisionId, releaseId: revision.retainedReleaseId, auditRef: revision.sourceAuditRef, sourceRef: `config-set:${config!.config_set_id}` });
      }
      const tip = imported.find(v => v.row.id === entry.sourceTipRevisionId);
      requireFact(tip, "explicit-tip-required");
      if (done.rowCount === 0) {
        await client.query("set constraints all deferred");
        const binding = await insertBinding(client,{ id:source.binding.id,organizationId:source.binding.organization_id,catalogReleaseId:tip!.releaseId,projectId:source.binding.project_id,logicalNodeId:source.binding.logical_node_id!,registrationId:entry.registrationId,subjectId:reg.rows[0].subject_id,definitionId,effectiveRevisionId:tip!.revisionId,currentValueId:tip!.row.id,createdAt:source.binding.created_at });
        requireFact(binding, "binding-already-exists-without-receipt");
        for (const value of imported) {
          const payload = { kind:valueKind(value.row.typed_value),value:value.row.typed_value } as ProjectValuePayload;
          const inserted = await insertProjectValue(client,{id:value.row.id,bindingId:source.binding.id,definitionId,definitionRevisionId:value.revisionId,sourceRef:value.sourceRef,configRevisionId:value.row.config_revision_id,valueDigest:digestProjectValuePayload(payload),valueKind:payload.kind,valueJson:JSON.stringify(payload.value),createdAt:value.row.created_at});
          requireFact(inserted, "value-already-exists-without-receipt");
          // An import event is not an invented source edit chain; source audit/time remain explicit.
          await client.query(`insert into parameter_catalog.binding_history_events(id,binding_id,new_effective_revision_id,new_current_value_id,reason,success_audit_ref,catalog_release_id,created_at) values($1,$2,$3,$4,'legacy-project-value-import',$5,$6,$7)`, [`s6-import:${input.runId}:${value.row.id}`,source.binding.id,value.revisionId,value.row.id,value.auditRef,value.releaseId,value.row.created_at]);
        }
      }
      const target = await client.query<{ effective_revision_id: string; current_value_id: string; catalog_release_id: string; organization_id: string; project_id: string; logical_node_id: string; registration_id: string; definition_id: string; created_at: Date }>("select * from parameter_catalog.project_parameter_bindings where id=$1", [source.binding.id]);
      const binding = target.rows[0];
      requireFact(binding?.effective_revision_id === tip!.revisionId && binding.current_value_id === tip!.row.id && binding.catalog_release_id === tip!.releaseId && binding.organization_id === source.binding.organization_id && binding.project_id === source.binding.project_id && binding.logical_node_id === source.binding.logical_node_id && binding.registration_id === entry.registrationId && binding.definition_id === definitionId && binding.created_at.toISOString() === new Date(source.binding.created_at).toISOString(), "imported-tip-drift");
      const targetValues = await client.query<{ id: string; definition_id: string; definition_revision_id: string; source_ref: string; config_revision_id: string; value_kind: string; value_digest: string; value: ContractJsonValue; created_at: Date }>("select * from parameter_catalog.project_parameter_values where binding_id=$1",[source.binding.id]);
      requireFact(targetValues.rowCount === imported.length && imported.every(v => targetValues.rows.some(t => t.id === v.row.id && t.definition_id === definitionId && t.definition_revision_id === v.revisionId && t.source_ref === v.sourceRef && t.config_revision_id === v.row.config_revision_id && t.value_kind === valueKind(v.row.typed_value) && t.value_digest === bindingImportDigest(v.row.typed_value) && bindingImportDigest(t.value) === bindingImportDigest(v.row.typed_value) && t.created_at.toISOString() === new Date(v.row.created_at).toISOString())), "imported-history-drift");
      const history = await client.query<{ new_current_value_id: string; new_effective_revision_id: string; success_audit_ref: string; catalog_release_id: string; reason: string; created_at: Date }>("select * from parameter_catalog.binding_history_events where binding_id=$1",[source.binding.id]);
      requireFact(history.rowCount === imported.length && imported.every(v => history.rows.some(h => h.new_current_value_id === v.row.id && h.new_effective_revision_id === v.revisionId && h.success_audit_ref === v.auditRef && h.catalog_release_id === v.releaseId && h.reason === "legacy-project-value-import" && h.created_at.toISOString() === new Date(v.row.created_at).toISOString())), "imported-audit-drift");
      values += imported.length;
    }
    if (done.rowCount === 0) await appendCutoverEvent(client,{runId:input.runId,phase:"P9",eventKind:"s6-binding-import-completed",payload:{manifestDigest:input.manifestDigest,bindings:m.bindings.length,values}});
    await client.query("set constraints all immediate");
    await client.query("release savepoint s6_binding_import_scope");
    return {ok:true,status:done.rowCount === 0 ? "imported":"already-imported",manifestDigest:input.manifestDigest,bindings:m.bindings.length,values};
  } catch (error) {
    await client.query("rollback to savepoint s6_binding_import_scope").catch(() => undefined);
    await client.query("release savepoint s6_binding_import_scope").catch(() => undefined);
    const typedCause = error instanceof ImportRefusal ? error.typedCause :
      error instanceof Error && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
    return {ok:false,reason:error instanceof ImportRefusal ? error.message : "management-import-query-failure",...(typedCause ? {typedCause}: {})};
  }
}

/** Production P9 seam: consumes only a P8 v2 receipt on the controller's transaction. */
export const importPreparedBindingHistory = (input: ImportRequest & {client:pg.PoolClient}): Promise<BindingImportResult> =>
  importOnClient(input.client,input,"prepared-v2");

/** Completed S7 no-op still revalidates the source, mappings and all imported targets. */
export const verifyPreparedBindingHistory = (input: ImportRequest & {client:pg.PoolClient}): Promise<BindingImportResult> =>
  importOnClient(input.client,input,"verify-v2");

/** Retained historical receipt-consumer fixture seam. The production controller never calls it. */
export async function importLegacyBindingHistory(input: ImportRequest & {pool:pg.Pool}): Promise<BindingImportResult> {
  const client = await input.pool.connect();
  let committing = false;
  try {
    await client.query("begin isolation level serializable");
    const result = await importOnClient(client,input,"historical-v1");
    if (!result.ok) { await client.query("rollback"); return result; }
    committing = true;
    await client.query("commit");
    return result;
  } catch {
    await client.query("rollback").catch(() => undefined);
    return {ok:false,reason:committing ? "unknown-commit-outcome":"management-import-query-failure"};
  } finally { client.release(); }
}
