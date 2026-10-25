import { parameterOrganizationId } from "../parameters/operatingScope";
import { randomUUID } from "node:crypto";

import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import type { ObjectStore } from "../logs/objectStore";
import { asValueClient, listObservedProperties, rawTextToPayload, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { appendProjectValue, readOwnedCurrentBinding, readOwnedProjectValueIdentity,
  lockSourceConfigurationBindings, loadCreatedSourceBindingReceipt } from "../parameter-bindings/values";
import { deriveHistoryEventId } from "../parameter-bindings/values/repositories";
import { ProjectValueId } from "../parameter-catalog-contract";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import { getParameterFileCandidateByIdForUpdate } from "./candidateRepository";
import { MAX_PARAMETER_SOURCE_BYTES } from "./jsonSource";
import { insertFileVersion } from "./repository";
import { ingestDtsFileVersion } from "./structuralIngest";
import { requireCanonicalUserInvocation } from "./canonicalSource";
import { assertSourceRevisionWriteAllowed, freezeSourceRevisionRequest, inspectSourceRevision, isSourceRevisionReviewer,
  loadSnapshot, loadSourceRevisionCatalogSnapshots, requireCurrentSourceAdministrator, sameSourceRevision, sourceRevisionDigest, type SourceRevisionProof } from "./sourceRevisionService";
import type { CanonicalSourceSecurityContext } from "./canonicalSource";
import { applySourceRestoration } from "./sourceRestoration";
import type { DtsToolchainRunner } from "./dtsToolchain";

function conflict(message: string): never { throw new ApiError("CONFLICT", message, { reason: "source-revision-stale" }); }

type SourceRevisionResult = { bindingId: string; oldValueId: string; newValueId: string; sourcePinId: string;
  historyEventId: string; kind: "changed" | "derived" | "deleted" | "created" };
type RequestRow = { id: string; status: string; submitter_user_id: string; assigned_to_user_id: string | null;
  source_revision_application_mode: "separate_review" | "administrator_direct";
  source_revision_context: SourceRevisionProof; source_revision_proof_digest: string;
  applied_source_result: { requestId: string; configRevisionId: string; fileVersionId: string;
    sourceRevisionProofDigest: string; results: SourceRevisionResult[] } | null; applied_audit_ref: string | null };

/** No object writes: the staged immutable candidate owns bytes before this transaction. */
export async function commitSourceRevision(tx: Database, storage: ObjectStore, auth: AuthContext, snapshot: CatalogSnapshot | null,
  input: { projectId: string; requestId: string; invocation: TrustedInvocationContext; traceId: string;
    refusalSink: TrustedRefusalAuditSink; note?: string | null; catalogSnapshots?: ReadonlyMap<string, CatalogSnapshot>;
    applicationMode?: "administrator_direct"; toolchain?: DtsToolchainRunner }
): Promise<{ requestId: string; status: "approved"; sourceRevisionProofDigest: string }> {
  const security = { invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink };
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "whole DTS source revision apply",
    targetType: "project-parameter-value-change-request", targetId: input.requestId });
  let visible = (await tx.query<RequestRow>(`select * from public.project_parameter_value_change_requests
    where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision'`,
    [input.requestId, parameterOrganizationId(auth), input.projectId])).rows[0];
  if (!visible) throw new ApiError("NOT_FOUND", "Whole-source request was not found.");
  const direct = input.applicationMode === "administrator_direct";
  if (direct) auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
  if (direct ? visible.source_revision_application_mode !== "administrator_direct" || visible.submitter_user_id !== auth.user.id
    || visible.assigned_to_user_id !== null
    : visible.source_revision_application_mode !== "separate_review" || !await isSourceRevisionReviewer(tx, auth, input.projectId)
    || visible.assigned_to_user_id !== auth.user.id || visible.submitter_user_id === auth.user.id) {
    throw new ApiError("FORBIDDEN", "The assigned software reviewer with file administration permission is required.");
  }
  // Concurrent retries can wait on the reviewer fence while the first apply
  // commits. Re-read its receipt before inspecting a now superseded source base.
  visible = (await tx.query<RequestRow>(`select * from public.project_parameter_value_change_requests
    where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision'`,
    [input.requestId, parameterOrganizationId(auth), input.projectId])).rows[0];
  if (!visible || (direct ? visible.source_revision_application_mode !== "administrator_direct"
    || visible.submitter_user_id !== auth.user.id || visible.assigned_to_user_id !== null
    : visible.assigned_to_user_id !== auth.user.id || visible.submitter_user_id === auth.user.id)) {
    throw new ApiError("FORBIDDEN", "The assigned reviewer changed.");
  }
  if (visible.status === "approved") {
    const receipt = visible.applied_source_result;
    const verified = receipt && (await tx.query(`select request.id from public.project_parameter_value_change_requests request
      join public.project_parameter_file_candidates candidate on candidate.id=request.candidate_id and candidate.status='active'
      join public.project_parameter_file_versions version on version.id=$4 and version.file_id=candidate.file_id
      join public.audit_events audit on audit.id=request.applied_audit_ref and audit.organization_id=request.organization_id
        and audit.project_id=request.project_id and audit.target_id=request.id and audit.action='value-change-applied'
      where request.id=$1 and request.organization_id=$2 and request.project_id=$3
        and audit.metadata->'result'=request.applied_source_result`,
      [visible.id, parameterOrganizationId(auth), input.projectId, receipt.fileVersionId])).rows.length === 1;
    if (!receipt || !verified || receipt.sourceRevisionProofDigest !== visible.source_revision_proof_digest) conflict("Approved source request has no complete immutable receipt.");
    return { requestId: visible.id, status: "approved", sourceRevisionProofDigest: visible.source_revision_proof_digest };
  }
  if (visible.status !== "pending") conflict("Source revision request is already closed.");
  const frozen = visible.source_revision_context;
  const inspected = await inspectSourceRevision(tx, storage, auth, { projectId: input.projectId, candidateId: frozen.candidateId }, snapshot,
    { lock: true, snapshots: input.catalogSnapshots, toolchain: input.toolchain });
  await assertSourceRevisionWriteAllowed(tx, auth, inspected.proof, security);
  if (!sameSourceRevision(inspected.proof, frozen) || inspected.proof.proofDigest !== visible.source_revision_proof_digest) {
    conflict("Source, definitions, registrations or current parameter values changed after review submission.");
  }
  const request = (await tx.query<RequestRow>(`select * from public.project_parameter_value_change_requests
    where id=$1 and organization_id=$2 and project_id=$3 and request_kind='source_revision' for update`,
    [input.requestId, parameterOrganizationId(auth), input.projectId])).rows[0];
  if (!request || request.status !== "pending" || request.source_revision_application_mode !== visible.source_revision_application_mode
    || request.assigned_to_user_id !== visible.assigned_to_user_id || request.submitter_user_id !== visible.submitter_user_id
    || !sameSourceRevision(request.source_revision_context, frozen)) conflict("Source revision lost its pending review transition.");
  // Freeze the complete source cohort, not only parameters with changed business values.
  await lockSourceConfigurationBindings(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: frozen.configSetId });
  const candidate = await getParameterFileCandidateByIdForUpdate(tx, { organizationId: parameterOrganizationId(auth),
    projectId: input.projectId, candidateId: frozen.candidateId });
  if (!candidate || candidate.status !== "ready" || !candidate.storageKey || !candidate.checksum || !storage.getBounded) conflict("Whole-source candidate is no longer immutable and ready.");
  const candidateBytes = await storage.getBounded(candidate.storageKey, MAX_PARAMETER_SOURCE_BYTES);
  if (sourceRevisionDigest(candidateBytes) !== frozen.proposedDigest) conflict("Whole-source candidate digest changed.");
  const attribution = trustedDomainAttribution(input.invocation);
  const version = await insertFileVersion(tx, { id: randomUUID(), fileId: frozen.fileId, versionNumber: 0,
    storageKey: candidate.storageKey, checksum: candidate.checksum, sizeBytes: candidateBytes.length,
    parsedIndex: candidate.parsedIndex, origin: "writeback", attribution });
  await ingestDtsFileVersion(tx, version.id, inspected.after,
    inspected.preprocessing?.originalDocuments.get(frozen.members.find(member => member.fileId === frozen.fileId)!.sourceName));
  const members = [];
  for (const member of frozen.members) {
    let content = inspected.after;
    if (member.fileId !== frozen.fileId) {
      const stored = (await tx.query<{ storage_key: string }>("select storage_key from public.project_parameter_file_versions where id=$1 and file_id=$2",
        [member.fileVersionId, member.fileId])).rows[0];
      if (!stored) conflict("Frozen source member disappeared.");
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await storage.getBounded(stored.storage_key, MAX_PARAMETER_SOURCE_BYTES));
    }
    members.push({ fileId: member.fileId, fileVersionId: member.fileId === frozen.fileId ? version.id : member.fileVersionId,
      fileName: member.sourceName, sourceName: member.sourceName, format: member.format,
      role: member.role as ConfigRevisionMemberRole, sortOrder: member.sortOrder, content });
  }
  const revision = await ingestConfigRevisionInTransaction(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId,
    preprocessing: frozen.preprocessing, declaredBuildInputs: frozen.declaredBuildInputs,
    configSetId: frozen.configSetId, entryFile: frozen.entryFile, includeSearchPaths: frozen.includeSearchPaths,
    overlayOrder: frozen.overlayOrder, members }, auth, { createdByUserId: attribution.userId, domain: attribution },
    { reviewedSource: frozen.continuity });
  if (revision.status !== "resolved") conflict("Whole-source revision did not resolve with its reviewed identity plan.");
  const observed = await listObservedProperties(asValueClient(tx), revision.id);
  const results: SourceRevisionResult[] = [];
  const auditRef = randomUUID();
  for (const entry of frozen.cohort) {
    const pinnedSnapshot = input.catalogSnapshots?.get(entry.catalogReleaseId)
      ?? (snapshot?.release.id === entry.catalogReleaseId ? snapshot : null);
    if (!pinnedSnapshot) conflict("Reviewed source values require their pinned Catalog.");
    const restoration = frozen.restorations?.find((row) => row.bindingId === entry.bindingId);
    if (restoration) {
      const property = observed.find((row) => row.fileId === restoration.fileId && row.logicalNodeId === restoration.logicalNodeId && row.propertyKey === restoration.propertyName);
      if (!property) conflict("恢复参数缺少实际生效来源，所有变更已回滚。");
      const restored = await applySourceRestoration(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: frozen.configSetId },
        restoration, { requestId: request.id, configRevisionId: revision.id, auditRef }, pinnedSnapshot, property);
      results.push({ ...restored, kind: "changed" });
      await tx.query(`update public.project_parameter_value_change_targets set applied_value_id=$3,applied_history_event_id=$4,
        applied_source_pin_id=$5,applied_file_version_id=$6 where request_id=$1 and binding_id=$2 and applied_value_id is null`,
      [request.id,entry.bindingId,restored.newValueId,restored.historyEventId,restored.sourcePinId,restored.fileVersionId]);
      continue;
    }
    const current = await readOwnedCurrentBinding(tx, { organizationId: parameterOrganizationId(auth),
      projectId: input.projectId, bindingId: entry.bindingId, lock: true });
    const old = await readOwnedProjectValueIdentity(tx, { organizationId: parameterOrganizationId(auth),
      projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (current.status !== "current" || !old || current.binding.currentValueId !== entry.oldValueId
      || current.binding.sourceOccurrenceId !== entry.sourceOccurrenceId || current.binding.definitionId !== entry.definitionId
      || current.binding.effectiveRevisionId !== entry.effectiveRevisionId) conflict("Reviewed Binding base is stale.");
    const binding = current.binding;
    const target = frozen.targets.find((row) => row.bindingId === entry.bindingId);
    if (entry.format === "json" && target) conflict("A DTS source edit cannot mutate an unchanged JSON parameter.");
    const deleted = target?.action === "delete";
    const property = observed.find((row) => row.logicalNodeId === entry.logicalNodeId && row.propertyKey === entry.propertyName && row.fileId === entry.fileId);
    if (entry.format !== "json" && !deleted && !property) conflict("Reviewed source property disappeared during ingest.");
    const payload = entry.format === "json" ? old.value.payload : deleted ? target.payload : rawTextToPayload(property!.propertyKey, property!.rawText);
    if (target && !sameSourceRevision(target.payload, payload)) conflict("Ingested source differs from its reviewed parameter value.");
    const appended = await appendProjectValue(asValueClient(tx), {
      snapshot: pinnedSnapshot, binding: { ...binding, catalogRelease: pinnedSnapshot.release },
      definitionRevisionId: binding.effectiveRevisionId, expectedTip: ProjectValueId(entry.oldValueId),
      source: { sourceRef: old.value.source.sourceRef, configRevisionId: revision.id }, payload, valueState: deleted ? "deleted" : "present",
      sourceCommit: { requestId: request.id, auditRef, derived: !target }
    });
    if (!appended.ok) conflict(`Whole-source value append refused: ${appended.error.kind}`);
    const fileVersionId = entry.fileId === frozen.fileId ? version.id : entry.fileVersionId;
    const locator = entry.format === "json" ? entry.locator : deleted ? { kind: "dts-source-absence", basePropertyOccurrenceId: entry.locator.propertyOccurrenceId,
      baseNodeOccurrenceId: entry.locator.nodeOccurrenceId, baseFileVersionId: entry.fileVersionId,
      fileVersionId, propertyName: entry.propertyName, logicalNodeId: entry.logicalNodeId }
      : { kind: "dts-property", propertyOccurrenceId: property!.propertyOccurrenceId,
        nodeOccurrenceId: property!.nodeOccurrenceId, fileVersionId, propertyName: entry.propertyName };
    const sourcePinId = randomUUID();
    const baseMember = frozen.members.find((row) => row.fileId === entry.fileId)!;
    const deletionProof = deleted ? { kind: "dts-source-absence-v1", scannerVersion: "dts-config-v1",
      beforeValueDigest: old.value.valueDigest.startsWith("sha256:") ? old.value.valueDigest : `sha256:${old.value.valueDigest}`,
      beforeSourceDigest: baseMember.checksum.startsWith("sha256:") ? baseMember.checksum : `sha256:${baseMember.checksum}`,
      afterSourceDigest: entry.fileId === frozen.fileId ? `sha256:${frozen.proposedDigest}` : baseMember.checksum.startsWith("sha256:") ? baseMember.checksum : `sha256:${baseMember.checksum}` } : null;
    await tx.query(`insert into parameter_catalog.project_value_source_pins
      (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,
       file_id,file_version_id,format,property_occurrence_id,locator,locator_digest,value_state,base_source_pin_id,delete_request_id,delete_proof)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$18,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb)`,
      [sourcePinId, appended.value.currentTip, entry.bindingId, entry.definitionId, parameterOrganizationId(auth), input.projectId,
        entry.sourceOccurrenceId, revision.id, entry.fileId, fileVersionId, deleted || entry.format === "json" ? null : property!.propertyOccurrenceId,
        JSON.stringify(locator), `sha256:${sourceRevisionDigest(locator)}`, deleted ? "deleted" : "present",
        deleted ? entry.sourcePinId : null, deleted ? request.id : null, deletionProof ? JSON.stringify(deletionProof) : null, entry.format ?? "dts"]);
    results.push({ bindingId: entry.bindingId, oldValueId: entry.oldValueId, newValueId: appended.value.currentTip, sourcePinId,
      historyEventId: deriveHistoryEventId({ bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: appended.value.currentTip }),
      kind: deleted ? "deleted" : target ? "changed" : "derived" });
    if (target) {
      const updated = await tx.query(`update public.project_parameter_value_change_targets
        set applied_value_id=$3,applied_history_event_id=$4,applied_source_pin_id=$5,applied_file_version_id=$6
        where request_id=$1 and binding_id=$2 and applied_value_id is null`,
        [request.id, entry.bindingId, appended.value.currentTip, results.at(-1)!.historyEventId, sourcePinId, fileVersionId]);
      if (updated.rowCount !== 1) conflict("Reviewed source target lost its result transition.");
    }
  }
  const moved = await tx.query(`update public.project_parameter_files set current_version_id=$2,updated_at=now()
    where id=$1 and organization_id=$4 and project_id=$5 and current_version_id=$3`,
    [frozen.fileId, version.id, frozen.baseVersionId, parameterOrganizationId(auth), input.projectId]);
  if (moved.rowCount !== 1) conflict("Source file lost its compare-and-swap.");
  if (frozen.newProperties.length) {
    if (!snapshot) conflict("New registered source properties require a Catalog.");
    const selected = frozen.newProperties.map((planned) => {
      const actual = observed.find((row) => row.fileId === planned.fileId && row.logicalNodeId === planned.logicalNodeId && row.propertyKey === planned.propertyName);
      if (!actual || !sameSourceRevision(rawTextToPayload(actual.propertyKey, actual.rawText), planned.payload)) conflict("New source occurrence differs from its reviewed match.");
      return actual.propertyOccurrenceId;
    });
    await syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId: parameterOrganizationId(auth),
      projectId: input.projectId, configSetId: frozen.configSetId, configRevisionId: revision.id, propertyOccurrenceIds: selected });
    for (const planned of frozen.newProperties) {
      const created = await loadCreatedSourceBindingReceipt(tx, { organizationId: parameterOrganizationId(auth),
        projectId: input.projectId, configSetId: frozen.configSetId, fileId: planned.fileId,
        logicalNodeId: planned.logicalNodeId, definitionId: planned.definitionId, configRevisionId: revision.id });
      if (!created) conflict("New registered source Binding has no complete owner receipt.");
      results.push({ ...created, kind: "created" });
    }
  }
  const result = { requestId: request.id, configRevisionId: revision.id, fileVersionId: version.id,
    sourceRevisionProofDigest: frozen.proofDigest, results };
  await writeTrustedAuditEventInTx(asAuditTx(tx), { id: auditRef, invocation: input.invocation, app: "parameters",
    kind: "parameter-topology-governance", action: "value-change-applied", severity: "Medium", projectId: input.projectId,
    targetType: "project-parameter-value-change-request", targetId: request.id,
    metadata: { requestId: request.id, requestKind: "source_revision", applicationMode: request.source_revision_application_mode,
      appliedByUserId: auth.user.id, sourceRevisionProofDigest: frozen.proofDigest, restoredParameters: frozen.restorations?.length ?? 0, result }, traceId: input.traceId });
  await tx.query(`update public.project_parameter_file_candidates set status='active',activated_at=now(),activated_by_user_id=$2,activated_version_id=$3 where id=$1`,
    [candidate.id, auth.user.id, version.id]);
  const approved = await tx.query(`update public.project_parameter_value_change_requests set status='approved',reviewer_user_id=$2,
    reviewer_note=$3,apply_outcome='committed',applied_at=now(),applied_audit_ref=$4,applied_file_version_ids=$5::jsonb,
    applied_source_result=$6::jsonb,updated_at=now() where id=$1 and status='pending'`,
    [request.id, direct ? null : auth.user.id, input.note ?? null, auditRef, JSON.stringify([version.id]), JSON.stringify(result)]);
  if (approved.rowCount !== 1) conflict("Whole-source review lost its approval transition.");
  return { requestId: request.id, status: "approved", sourceRevisionProofDigest: frozen.proofDigest };
}

/** Preview, freeze and apply in one transaction; the durable record honestly has no second reviewer. */
export async function applySourceRevisionCandidate(db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; candidateId: string; expectedCurrentVersionId: string; expectedProofToken: string;
    reason: string; clientMutationId: string }, security: CanonicalSourceSecurityContext,
  options: { toolchain?: DtsToolchainRunner } = {}
): Promise<{ requestId: string }> {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "administrator direct DTS source application",
    targetType: "project-parameter-file-candidate", targetId: input.candidateId });
  if (!input.reason.trim() || !input.clientMutationId.trim() || input.clientMutationId.length > 160) {
    throw new ApiError("VALIDATION_FAILED", "A reason and mutation key are required.");
  }
  const snapshot = await loadSnapshot(db);
  const snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  const mutationDigest = sourceRevisionDigest({ ...input, applicationMode: "administrator_direct" });
  return db.transaction(async (tx) => {
    auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `source-revision-submit:${parameterOrganizationId(auth)}:${input.projectId}:${auth.user.id}:${input.clientMutationId}`
    ]);
    const replay = (await tx.query<{ id: string; source_revision_mutation_digest: string; source_revision_application_mode: string }>(
      `select id,source_revision_mutation_digest,source_revision_application_mode from public.project_parameter_value_change_requests
       where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and source_revision_mutation_id=$4`,
      [parameterOrganizationId(auth), input.projectId, auth.user.id, input.clientMutationId])).rows[0];
    let requestId: string;
    if (replay) {
      if (replay.source_revision_mutation_digest !== mutationDigest || replay.source_revision_application_mode !== "administrator_direct") {
        conflict("Source application mutation key was reused for different input.");
      }
      requestId = replay.id;
    } else {
      const { proof, before, after } = await inspectSourceRevision(tx, storage, auth, input, snapshot, { lock: true, snapshots, toolchain: options.toolchain });
      await assertSourceRevisionWriteAllowed(tx, auth, proof, security);
      if (proof.baseVersionId !== input.expectedCurrentVersionId || proof.proofDigest !== input.expectedProofToken) {
        conflict("Source revision no longer matches the confirmed preview.");
      }
      if (before === after) throw new ApiError("VALIDATION_FAILED", "Source has no changes.");
      requestId = await freezeSourceRevisionRequest(tx, auth, proof, { ...input, assignedToUserId: null }, mutationDigest, "administrator_direct");
    }
    await commitSourceRevision(tx, storage, auth, snapshot, { projectId: input.projectId, requestId,
      invocation: security.invocation, traceId: security.requestId, refusalSink: security.refusalSink,
      catalogSnapshots: snapshots, applicationMode: "administrator_direct", toolchain: options.toolchain });
    return { requestId };
  });
}
