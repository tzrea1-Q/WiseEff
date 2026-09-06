/** S7 producer for the S6 management importer. Never accepts a caller-built P8 receipt. */
import type pg from "pg";
import { CatalogReleaseDigest, CatalogReleaseId, CatalogSubjectId, type ContractJsonValue } from "../parameter-catalog-contract/index";
import { writeGuardedRegistration } from "../parameter-governance/registration/internalGuardedRegistrationWriter";
import { bindingImportDigest, captureBindingImportSource, captureDefinitionBindingImportSource, type BindingImportEntry, type BindingImportManifest } from "../parameter-bindings/cutoverImport";
import { captureBindingImportIntent, type BindingImportIntent } from "../parameter-bindings/cutoverImport/intent";
import type { CatalogReleaseBundle } from "../catalog-kernel/compiler/types";
import { createArchiveAdapter, type ArchiveAdapterOptions } from "./archive";
import type { ClassificationResult, FrozenP0Graph } from "./classifier";
import type { ConversionManifest } from "./conversionManifest";
import { appendMappingVersion, readCurrentMappingHead, type MappingHead } from "./mapping";

export class BindingProducerRefusal extends Error {}
const requireFact = (condition: unknown, reason: string): void => { if (!condition) throw new BindingProducerRefusal(reason); };

export type DatabaseIdentity = { systemIdentifier: string; databaseOid: string };
/** Queries actual servers. Failure to read cluster identity is never replaced by URL comparison. */
export async function readBindingDatabaseIdentity(client: pg.PoolClient): Promise<DatabaseIdentity> {
  const result = await client.query<{ system_identifier: string; database_oid: string }>(`select s.system_identifier::text, d.oid::text as database_oid
    from pg_catalog.pg_control_system() s cross join pg_catalog.pg_database d where d.datname=current_database()`);
  requireFact(result.rowCount === 1, "binding-database-identity-unavailable");
  return {systemIdentifier:result.rows[0].system_identifier,databaseOid:result.rows[0].database_oid};
}

export async function assertBindingManagementLogin(client: pg.PoolClient): Promise<void> {
  const result = await client.query<{ safe: boolean }>(`select not rolsuper and not rolbypassrls and not rolcreatedb and not rolcreaterole and not rolreplication and not rolinherit
    and pg_has_role(session_user,'catalog_migration_owner','MEMBER')
    and not exists(select 1 from pg_roles p where pg_has_role(session_user,p.oid,'MEMBER') and (p.rolsuper or p.rolbypassrls or p.rolcreatedb or p.rolcreaterole or p.rolreplication)) as safe
    from pg_roles where rolname=session_user`);
  requireFact(result.rows[0]?.safe === true, "binding-management-login-required");
}

export type BindingMappingPin = { identityId: string; versionId: string; casVersion: number };

export async function captureBindingMappingPins(client: pg.PoolClient, runId: string, manifest: ConversionManifest): Promise<BindingMappingPin[]> {
  const pins: BindingMappingPin[] = [];
  for (const assertion of [...manifest.mappings].sort((a,b) => a.legacyIdentityId.localeCompare(b.legacyIdentityId))) {
    const current = await readCurrentMappingHead({client,identityId:assertion.legacyIdentityId});
    requireFact(current.ok && current.value !== null, "binding-p7-mapping-absent");
    if (!current.ok || !current.value) throw new BindingProducerRefusal("binding-p7-mapping-absent");
    const head = current.value;
    requireFact(head.version.cutoverRunId === runId && head.version.targetId === assertion.targetId && head.version.targetKind === assertion.targetKind, "binding-p7-mapping-authority-mismatch");
    pins.push({identityId:head.legacyIdentityId,versionId:head.currentVersionId,casVersion:head.casVersion});
  }
  return pins;
}

type ProducerInput = {
  client: pg.PoolClient;
  runId: string;
  planDigest: string;
  intent: BindingImportIntent;
  graph: FrozenP0Graph;
  classification: ClassificationResult;
  conversion: ConversionManifest;
  bundle: CatalogReleaseBundle;
  p7Pins: readonly BindingMappingPin[];
  archive: Omit<ArchiveAdapterOptions,"client" | "failAfter">;
  operatorAuditRef: string;
  retainUntil: Date;
};

export type PreparedBindingArchives = ReadonlyMap<string,{archiveId:string;sourceChecksum:string}>;

async function assertSourceAndMappingPins(input: ProducerInput): Promise<Map<string,MappingHead>> {
  const run = await input.client.query("select plan_digest,source_snapshot_fingerprint,current_phase,state from parameter_catalog.parameter_catalog_cutover_runs where id=$1",[input.runId]);
  requireFact(run.rowCount === 1 && run.rows[0].plan_digest === input.planDigest && run.rows[0].source_snapshot_fingerprint === input.intent.sourceSnapshotFingerprint && ["P7","P8"].includes(run.rows[0].current_phase) && run.rows[0].state === "running", "binding-producer-run-mismatch");
  const prepared = await input.client.query("select 1 from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 and phase='P8'",[input.runId]);
  requireFact(prepared.rowCount === 0,"binding-producer-already-prepared");
  const checkpoints = await input.client.query("select phase,payload from parameter_catalog.parameter_catalog_cutover_checkpoints where cutover_run_id=$1 and phase in ('P0','P7')",[input.runId]);
  const p0 = checkpoints.rows.find(row => row.phase === "P0")?.payload;
  const p7 = checkpoints.rows.find(row => row.phase === "P7")?.payload;
  requireFact(p0?.bindingImportIntent && Array.isArray(p7?.bindingMappingPins),"binding-producer-checkpoints-missing");
  requireFact(p0?.bindingImportIntentDigest === bindingImportDigest(input.intent) && bindingImportDigest(p0?.bindingImportIntent) === bindingImportDigest(input.intent), "binding-producer-P0-pin-mismatch");
  requireFact(bindingImportDigest(p7?.bindingMappingPins) === bindingImportDigest(input.p7Pins), "binding-producer-P7-pin-mismatch");
  const observed = await captureBindingImportIntent(input.client, input.intent);
  requireFact(bindingImportDigest(observed) === bindingImportDigest(input.intent), "binding-p0-source-drift");
  const current = await captureBindingMappingPins(input.client,input.runId,input.conversion);
  requireFact(bindingImportDigest(current) === bindingImportDigest(input.p7Pins), "binding-p7-mapping-drift");
  const heads = new Map<string,MappingHead>();
  for (const pin of input.p7Pins) {
    const result = await readCurrentMappingHead({client:input.client,identityId:pin.identityId});
    if (!result.ok || !result.value) throw new BindingProducerRefusal("binding-p7-mapping-absent");
    heads.set(pin.identityId,result.value);
  }
  return heads;
}

/** Archive owns its own transaction. Call before opening the P8 mapping/registration transaction. */
export async function prepareBindingEvidenceArchives(input: ProducerInput): Promise<PreparedBindingArchives> {
  await assertSourceAndMappingPins(input);
  const result = new Map<string,{archiveId:string;sourceChecksum:string}>();
  const rootIds = input.classification.assignments.filter(a => a.rClass === "R2" && a.sourceKind === "parameter-spec").map(a => a.sourceId);
  for (const specId of [...new Set([...input.intent.bindings.map(b => b.sourceSpecId),...rootIds])].sort()) {
    const identity = input.graph.identities.filter(i => i.sourceKind === "parameter-spec" && i.sourceId === specId);
    requireFact(identity.length === 1, "binding-definition-identity-not-unique");
    const assignment = input.classification.assignments.find(a => a.identityId === identity[0].id);
    requireFact(assignment?.disposition === "mapped", "binding-definition-not-operational");
    if (!assignment) throw new BindingProducerRefusal("binding-definition-not-operational");
    const definitionSource = await captureDefinitionBindingImportSource(input.client,specId);
    const source = rootIds.includes(specId) ? {
      definition:definitionSource,
      schemas:(await input.client.query("select to_jsonb(s) as row from public.driver_schemas s where parameter_spec_id=$1 order by id",[specId])).rows.map(row => row.row),
      schemaVersions:(await input.client.query("select to_jsonb(v) as row from public.driver_schema_versions v join public.driver_schemas s on s.id=v.driver_schema_id where s.parameter_spec_id=$1 order by v.id",[specId])).rows.map(row => row.row),
    } : definitionSource;
    const sourceChecksum = bindingImportDigest(source);
    requireFact(input.intent.bindings.filter(b => b.sourceSpecId === specId).every(b => b.definitionSourceChecksum === sourceChecksum), "binding-definition-source-drift");
    const archived = await createArchiveAdapter({...input.archive,client:input.client}).persistEvidenceArchive({
      actor:{role:"cutover-operator",auditRef:input.operatorAuditRef},legacyIdentityId:identity[0].id,
      ownerScopeKind:assignment.ownerScopeKind,ownerScopeId:assignment.ownerScopeId,rClass:assignment.rClass,
      reason:"binding-history-import-evidence",sourceGraph:{sourcePayload:source as unknown as ContractJsonValue,relationGraph:{bindingIds:definitionSource.bindings.map(b => b.binding.id),sourceAuthorityDigest:input.intent.sourceAuthorityDigest}},
      protectedReferences:[{kind:"legacy-identity",id:identity[0].id},...definitionSource.bindings.map(b => ({kind:"legacy-binding",id:b.binding.id}))],cutoverRunId:input.runId,
      catalogReleaseId:input.bundle.targetReleaseId,successAuditRef:input.operatorAuditRef,retainUntil:input.retainUntil,
    });
    if (!archived.ok) throw new BindingProducerRefusal(archived.error.detail === "archive-commit-outcome-unknown" ? "binding-archive-commit-outcome-unknown":archived.error.code);
    result.set(specId,{archiveId:archived.value.archiveId,sourceChecksum});
  }
  return result;
}

/** Parent transaction is mandatory; mappings, registrations and the P8 checkpoint commit together. */
export async function produceBindingImportReceipt(input: ProducerInput, archives: PreparedBindingArchives): Promise<BindingImportManifest> {
  await input.client.query("savepoint s7_binding_receipt_scope");
  // Mapping's existing transaction adapter detects assigned transactions, not merely BEGIN.
  await input.client.query("select pg_catalog.pg_current_xact_id()");
  const heads = await assertSourceAndMappingPins(input);
  const attached = new Map<string,MappingHead>();
  for (const root of input.classification.assignments.filter(a => a.rClass === "R2" && a.sourceKind === "parameter-spec")) {
    const head = heads.get(root.identityId);
    const archive = archives.get(root.sourceId);
    requireFact(head?.version.targetKind === "catalog-subject" && archive,"binding-root-evidence-required");
    const mapped = await appendMappingVersion({client:input.client,cutoverRunId:input.runId,classification:input.classification,identityId:root.identityId,
      sourceChecksum:archive!.sourceChecksum,expectedHead:{casVersion:head!.casVersion,versionId:head!.currentVersionId},
      outcome:{kind:"operational",targetKind:"catalog-subject",targetId:head!.version.targetId!,evidenceArchiveId:archive!.archiveId}});
    if (!mapped.ok || mapped.value.status === "blocked") throw new BindingProducerRefusal("binding-root-evidence-map-failed");
    attached.set(root.identityId,mapped.value.head);
  }
  const target = input.bundle.releases.find(r => r.manifest.release.id === input.bundle.targetReleaseId);
  requireFact(target, "binding-target-release-unavailable");
  const entries: BindingImportEntry[] = [];
  for (const planned of input.intent.bindings) {
    const source = await captureBindingImportSource(input.client,planned.sourceBindingId);
    const definitionIdentity = input.graph.identities.filter(i => i.sourceKind === "parameter-spec" && i.sourceId === planned.sourceSpecId);
    requireFact(definitionIdentity.length === 1, "binding-definition-identity-not-unique");
    const identityId = definitionIdentity[0].id;
    const p7 = heads.get(identityId);
    const archive = archives.get(planned.sourceSpecId);
    requireFact(p7 && archive?.sourceChecksum === planned.definitionSourceChecksum, "binding-evidence-pin-mismatch");
    if (!p7 || !archive) throw new BindingProducerRefusal("binding-evidence-pin-mismatch");
    let definitionHead = attached.get(identityId);
    if (!definitionHead) {
      const mapped = await appendMappingVersion({client:input.client,cutoverRunId:input.runId,classification:input.classification,identityId,
        sourceChecksum:archive.sourceChecksum,expectedHead:{casVersion:p7.casVersion,versionId:p7.currentVersionId},
        outcome:{kind:"operational",targetKind:"parameter-definition",targetId:p7.version.targetId!,evidenceArchiveId:archive.archiveId}});
      if (!mapped.ok || mapped.value.status === "blocked") throw new BindingProducerRefusal("binding-evidence-mapping-refused");
      definitionHead = mapped.value.head;
      attached.set(identityId,definitionHead);
    }
    const definition = target!.documents.find(d => d.kind === "definition" && d.content.id === definitionHead!.version.targetId);
    requireFact(definition?.kind === "definition", "binding-definition-target-unavailable");
    if (!definition || definition.kind !== "definition") throw new BindingProducerRefusal("binding-definition-target-unavailable");
    const subject = target!.documents.find(d => d.kind === "subject" && d.content.id === definition.content.subjectId);
    requireFact(subject?.kind === "subject", "binding-subject-target-unavailable");
    if (!subject || subject.kind !== "subject") throw new BindingProducerRefusal("binding-subject-target-unavailable");
    // This producer currently supports proven driver placements only. Node-type placement needs its own authority.
    const legacySpec = input.graph.specs.find(s => s.id === planned.sourceSpecId);
    requireFact(subject.content.kind === "driver" && legacySpec?.attributionSubjectId, "binding-placement-producer-unavailable");
    const subjectRoots = input.classification.assignments.filter(a => a.rClass === "R2" && a.sourceKind === "parameter-spec" && input.graph.driverSchemas.some(s => s.parameterSpecId === a.sourceId && s.attributionSubjectId === legacySpec!.attributionSubjectId));
    requireFact(subjectRoots.length === 1 && heads.get(subjectRoots[0].identityId)?.version.targetKind === "catalog-subject" && heads.get(subjectRoots[0].identityId)?.version.targetId === subject.content.id, "binding-subject-source-map-mismatch");
    const actualRoot = await input.client.query("select id from public.driver_schemas where parameter_spec_id=$1 and attribution_subject_id=$2",[subjectRoots[0].sourceId,legacySpec!.attributionSubjectId]);
    requireFact(actualRoot.rowCount === 1,"binding-subject-root-source-mismatch");
    const placements = await input.client.query("select id from public.driver_registration_placements where organization_id=$1 and attribution_subject_id=$2 and driver_group_module_id=$3",[source.binding.organization_id,legacySpec!.attributionSubjectId,source.binding.module_id]);
    requireFact(placements.rowCount === 1, "binding-source-placement-unproved");
    const registered = await writeGuardedRegistration(input.client,{kind:"register",organizationId:source.binding.organization_id,
      subjectId:CatalogSubjectId(subject.content.id),subjectKind:subject.content.kind,
      expectedRelease:{id:CatalogReleaseId(target!.manifest.release.id),digest:CatalogReleaseDigest(target!.manifest.release.digest)},
      placement:{mode:"use-default"},destinationModuleId:source.binding.module_id,method:"automatic",
      proof:{cutoverRunId:input.runId,planDigest:input.planDigest,sourcePlacementId:placements.rows[0].id,intentDigest:bindingImportDigest(input.intent)},
      idempotencyKey:`s7-import:${input.runId}:${source.binding.organization_id}:${subject.content.id}`,
      context:{actorKind:"trusted-system",principalId:"catalog-cutover-binding-import"}});
    if (!registered.ok) throw new BindingProducerRefusal(`binding-registration-${registered.error.kind}`);
    const revisions: BindingImportEntry["revisions"][number][] = [];
    for (const revision of source.revisions) {
      const identities = input.graph.identities.filter(i => i.sourceKind === "parameter-spec-version" && i.sourceId === revision.parameter_spec_version_id);
      requireFact(identities.length === 1, "binding-revision-identity-not-unique");
      const assertion = input.conversion.mappings.find(m => m.legacyIdentityId === identities[0].id);
      const head = heads.get(identities[0].id);
      requireFact(assertion?.retainedReleaseId && head?.version.targetKind === "definition-revision", "binding-historical-release-authority-required");
      const retained = input.bundle.releases.find(r => r.manifest.release.id === assertion!.retainedReleaseId);
      requireFact(retained?.documents.some(d => d.kind === "definition" && d.content.id === definition.content.id && d.content.revision.id === head!.version.targetId && d.source.digest === assertion!.targetSourceDigest), "binding-historical-release-authority-mismatch");
      const audits = source.auditEvents.filter(a => a.organization_id === source.binding.organization_id && a.project_id === source.binding.project_id && a.target_id === revision.id && typeof a.id === "string");
      requireFact(audits.length === 1, "binding-source-audit-not-unique");
      revisions.push({sourceRevisionId:revision.id,revisionMappingVersionId:head!.currentVersionId,retainedReleaseId:assertion!.retainedReleaseId!,sourceAuditRef:audits[0].id as string});
    }
    entries.push({sourceBindingId:planned.sourceBindingId,sourceChecksum:planned.sourceChecksum,sourceTipRevisionId:planned.sourceTipRevisionId,
      archiveId:archive.archiveId,definitionMappingVersionId:definitionHead.currentVersionId,registrationId:registered.value.registrationId,revisions});
  }
  await input.client.query("release savepoint s7_binding_receipt_scope");
  return {version:"s6-binding-import-v2",intentDigest:bindingImportDigest(input.intent),runId:input.runId,planDigest:input.planDigest,
    sourceSnapshotFingerprint:input.intent.sourceSnapshotFingerprint,sourceInventoryFingerprint:input.intent.sourceInventoryFingerprint,mappingPins:await captureBindingMappingPins(input.client,input.runId,input.conversion),bindings:entries};
}
