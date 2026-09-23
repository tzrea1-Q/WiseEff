import { createHash, randomUUID } from "node:crypto";

import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import type { ObjectStore } from "../logs/objectStore";
import { CatalogSubjectId, DefinitionRevisionId, ParameterBindingId, ParameterDefinitionId, ProjectValueId, SubjectRegistrationId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { canEditParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { asValueClient } from "../parameter-bindings/catalogProjectValueSync";
import { appendProjectValue } from "../parameter-bindings/values";
import { deriveHistoryEventId, loadBindingById, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import { loadCanonicalSourceSnapshot, recordCanonicalPermissionRefusal, requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { assertDeletedAnchorsRemainAbsent } from "./canonicalSourceCommit";
import { recheckCanonicalCandidateBatchForReviewInTransaction } from "./canonicalFileWorkflow";
import { deleteJsonSourceMember, MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, proveJsonSourceMemberAbsent, readJsonSourceValue } from "./jsonSource";
import { insertFileVersion } from "./repository";
import { rethrowSourceTransactionError } from "./sourceVersion";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import type { ParsedIndex } from "./types";

const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const same = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function conflict(message: string): never { throw new ApiError("CONFLICT", message); }

type Request = {
  id: string; organization_id: string; project_id: string; request_kind: string; status: string;
  submitter_user_id: string | null; candidate_id: string; batch_file_id: string;
  batch_base_version_id: string; batch_config_set_id: string; batch_proof_digest: string;
  batch_target_count: number; batch_cohort_count: number; batch_source_proof_token: string;
  batch_cohort_proof_token: string; candidate_base_digest: string; candidate_proposed_digest: string;
  candidate_diff_digest: string; candidate_member_manifest: unknown; candidate_binding_manifest: unknown;
  applied_source_result: unknown; applied_audit_ref: string | null;
};
type Target = {
  id: string; ordinal: number; binding_id: string; definition_id: string;
  definition_revision_id: string; catalog_release_id: string; base_current_value_id: string;
  config_revision_id: string; source_ref: string; source_pin_id: string;
  action: "set" | "delete"; target_value: unknown; target_text: string | null;
  base_digest: string; proposed_digest: string;
};
type AppliedResult = {
  ordinal: number; bindingId: string; oldValueId: string; newValueId: string;
  sourcePinId: string; configRevisionId: string; fileVersionId: string;
  historyEventId: string; kind: "target" | "sibling-derived";
  action: "set" | "delete"; valueState: "present" | "deleted";
};

/** Caller owns the transaction. All target Values, pins, history, version and audit commit together. */
export async function commitCanonicalSourceBatchRevision(
  tx: Database,
  storage: ObjectStore,
  auth: AuthContext,
  snapshot: CatalogSnapshot,
  input: { projectId: string; requestId: string; invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink; note?: string | null }
): Promise<{ requestId: string; status: "approved"; batchProofDigest: string }> {
  try {
    const security: CanonicalSourceSecurityContext = {
      invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink
    };
    const invocation = await requireCanonicalUserInvocation(auth, security, {
      projectId: input.projectId, operation: "canonical batch source apply",
      targetType: "project-parameter-value-change-request", targetId: input.requestId
    });
    if (!canEditParameters(auth, input.projectId) || !canReviewParameters(auth)
      || !canReviewParameterStage(auth, input.projectId, "software_review")
      || !await hasCurrentCanonicalReviewRole(tx, {
        organizationId: auth.organization.id, projectId: input.projectId, userId: auth.user.id
      })) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: input.projectId, operation: "canonical batch source apply",
        targetType: "project-parameter-value-change-request", targetId: input.requestId,
        details: { reason: "current-review-role-required" }
      });
      throw new ApiError("FORBIDDEN", "Project software review authorization is required.");
    }
    const initial = (await tx.query<Request>(`select * from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='batch'`,
    [input.requestId, auth.organization.id, input.projectId])).rows[0];
    if (!initial) throw new ApiError("NOT_FOUND", "Canonical batch request was not found.");
    if (initial.submitter_user_id === auth.user.id) throw new ApiError("FORBIDDEN", "The submitter cannot approve their own parameter change.");
    if (initial.status === "approved") {
      const replay = (await tx.query<{
        target_count: number; complete_count: number; candidate_status: string;
        audit_result: unknown; audit_proof: string;
      }>(`select (select count(*)::int from public.project_parameter_value_change_targets
                   where request_id=request.id) as target_count,
                (select count(*)::int from public.project_parameter_value_change_targets
                   where request_id=request.id and applied_value_id is not null
                     and applied_history_event_id is not null and applied_source_pin_id is not null
                     and applied_file_version_id is not null) as complete_count,
                candidate.status as candidate_status,
                audit.metadata->'result' as audit_result,
                audit.metadata->>'batchProofDigest' as audit_proof
           from public.project_parameter_value_change_requests request
           join public.project_parameter_file_candidates candidate on candidate.id=request.candidate_id
             and candidate.organization_id=request.organization_id and candidate.project_id=request.project_id
           join public.audit_events audit on audit.id=request.applied_audit_ref
             and audit.organization_id=request.organization_id and audit.project_id=request.project_id
             and audit.target_id=request.id and audit.action='value-change-applied'
          where request.id=$1 and request.organization_id=$2 and request.project_id=$3`,
        [initial.id, auth.organization.id, input.projectId])).rows[0];
      if (!replay || replay.target_count !== initial.batch_target_count
        || replay.complete_count !== initial.batch_target_count
        || replay.candidate_status !== "active"
        || replay.audit_proof !== initial.batch_proof_digest
        || !same(replay.audit_result, initial.applied_source_result)) {
        conflict("Approved batch has no complete immutable source receipt.");
      }
      return { requestId: initial.id, status: "approved", batchProofDigest: initial.batch_proof_digest };
    }
    if (initial.status !== "pending") conflict("A pending canonical batch request is required.");
    const proof = await recheckCanonicalCandidateBatchForReviewInTransaction(tx, storage, auth, {
      projectId: input.projectId, candidateId: initial.candidate_id,
      expectedProofToken: initial.batch_source_proof_token
    });
    if (proof.format !== "json") conflict("DTS batch source commit is not available.");
    const request = (await tx.query<Request>(`select * from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='batch' for update`,
      [input.requestId, auth.organization.id, input.projectId])).rows[0];
    if (!request || request.status !== "pending" || request.submitter_user_id === auth.user.id
      || request.candidate_id !== proof.candidateId || request.batch_file_id !== proof.fileId
      || request.batch_base_version_id !== proof.baseVersionId || request.batch_config_set_id !== proof.configSetId
      || request.batch_proof_digest !== proof.batchProofDigest
      || request.batch_source_proof_token !== proof.proofToken
      || request.batch_cohort_proof_token !== proof.cohortProofToken
      || request.batch_target_count !== proof.targets.length
      || request.batch_cohort_count !== proof.cohort.length
      || request.candidate_base_digest !== proof.baseDigest
      || request.candidate_proposed_digest !== proof.proposedDigest
      || request.candidate_diff_digest !== proof.batchProofDigest
      || !same(request.candidate_member_manifest, proof.members)
      || !same(request.candidate_binding_manifest, proof.cohort)) conflict("Batch request no longer matches the locked source proof.");
    const targets = (await tx.query<Target>(`select * from public.project_parameter_value_change_targets
      where request_id=$1 and organization_id=$2 and project_id=$3 order by ordinal for update`,
      [request.id, auth.organization.id, input.projectId])).rows;
    if (targets.length !== proof.targets.length || targets.some((target, ordinal) => {
      const frozen = proof.targets[ordinal];
      return !frozen || target.ordinal !== ordinal || target.binding_id !== frozen.bindingId
        || target.definition_id !== frozen.definitionId
        || target.base_current_value_id !== frozen.baseCurrentValueId
        || target.config_revision_id !== frozen.configRevisionId
        || target.source_pin_id !== frozen.sourcePinId
        || target.action !== frozen.action || target.target_text !== (frozen.targetText ?? null)
        || target.base_digest !== proof.baseDigest || target.proposed_digest !== proof.proposedDigest;
    })) conflict("Batch targets no longer match the locked source proof.");
    const candidate = (await tx.query<{
      id: string; status: string; storage_key: string; checksum: string; size_bytes: number;
      parsed_index: ParsedIndex; base_digest: string; proposed_digest: string; diff_digest: string;
      frozen_member_manifest: unknown; frozen_binding_manifest: unknown;
    }>(`select *,size_bytes::float8 as size_bytes from public.project_parameter_file_candidates
      where id=$1 and organization_id=$2 and project_id=$3 for update`,
      [proof.candidateId, auth.organization.id, input.projectId])).rows[0];
    if (!candidate || candidate.status !== "ready" || candidate.base_digest !== proof.baseDigest
      || candidate.proposed_digest !== proof.proposedDigest || candidate.diff_digest !== proof.batchProofDigest
      || !same(candidate.frozen_member_manifest, proof.members)
      || !same(candidate.frozen_binding_manifest, proof.cohort)
      || !storage.getBounded || !Number.isSafeInteger(candidate.size_bytes)
      || candidate.size_bytes < 0 || candidate.size_bytes > MAX_PARAMETER_SOURCE_BYTES) conflict("Frozen batch candidate is incomplete.");
    const getBounded = storage.getBounded;
    if (!getBounded) conflict("Bounded source storage is required.");
    const bytes = await getBounded(candidate.storage_key, MAX_PARAMETER_SOURCE_BYTES);
    if (bytes.length !== candidate.size_bytes || digest(bytes) !== proof.proposedDigest
      || digest(bytes) !== candidate.checksum.replace(/^sha256:/, "")) conflict("Batch candidate bytes failed integrity verification.");
    parseJsonSource(bytes);
    const first = proof.cohort[0];
    if (!first) conflict("Batch has no source cohort.");
    const base = await loadCanonicalSourceSnapshot(tx, storage, {
      organizationId: auth.organization.id, projectId: input.projectId,
      bindingId: first.bindingId, projectValueId: first.oldValueId
    });
    const manifest = base.manifest;
    const sourceIndex = manifest.members.findIndex((member) => member.fileId === proof.fileId && member.fileVersionId === proof.baseVersionId);
    if (sourceIndex < 0 || manifest.configSetId !== proof.configSetId
      || digest(base.files[sourceIndex]!.content) !== proof.baseDigest) conflict("Batch base source no longer matches its exact member.");
    const attribution = trustedDomainAttribution(invocation);
    const version = await insertFileVersion(tx, {
      id: randomUUID(), fileId: proof.fileId, versionNumber: 0,
      storageKey: candidate.storage_key, checksum: candidate.checksum,
      sizeBytes: bytes.length, parsedIndex: candidate.parsed_index,
      origin: "writeback", attribution
    });
    const after = bytes.toString("utf8");
    const members = manifest.members.map((member, index) => ({
      fileId: member.fileId, fileVersionId: member.fileId === proof.fileId ? version.id : member.fileVersionId,
      fileName: base.files[index]!.name, sourceName: member.sourceName,
      format: member.format, role: member.role as ConfigRevisionMemberRole, sortOrder: member.sortOrder,
      content: member.fileId === proof.fileId ? after : base.files[index]!.content
    }));
    const revisionId = randomUUID();
    await insertConfigRevision(tx, {
      id: revisionId, organizationId: auth.organization.id, projectId: input.projectId,
      configSetId: proof.configSetId, revisionNumber: await nextConfigRevisionNumber(tx, proof.configSetId),
      status: "resolved", attribution
    });
    await insertConfigRevisionMembers(tx, revisionId, members);
    await assertDeletedAnchorsRemainAbsent(tx, {
      configSetId: proof.configSetId, revisionId, manifest, baseFiles: base.files,
      candidateFileId: proof.fileId, candidateAfter: after
    });
    const auditRef = randomUUID();
    const targetByBinding = new Map(targets.map((target) => [target.binding_id, target]));
    const results: AppliedResult[] = [];
    for (const entry of proof.cohort) {
      const stored = await loadBindingById(asValueClient(tx), entry.bindingId, "none");
      const old = await loadProjectValueById(asValueClient(tx), entry.oldValueId);
      if (!stored || !old || stored.current_value_id !== entry.oldValueId
        || stored.catalog_release_id !== snapshot.release.id
        || stored.definition_id !== entry.definitionId
        || stored.effective_revision_id !== entry.effectiveRevisionId) conflict("Batch Binding base is stale.");
      const registration = await readSourceRegistrationAgreement(tx, {
        organizationId: auth.organization.id, subjectId: stored.subject_id
      });
      if (registration?.id !== stored.registration_id
        || snapshot.getDefinitionRevision({
          definitionId: ParameterDefinitionId(stored.definition_id),
          revisionId: DefinitionRevisionId(stored.effective_revision_id)
        }).status !== "found") conflict("Batch Binding definition or registration is unavailable.");
      const sibling = await loadCanonicalSourceSnapshot(tx, storage, {
        organizationId: auth.organization.id, projectId: input.projectId,
        bindingId: entry.bindingId, projectValueId: entry.oldValueId
      });
      const pin = sibling.manifest;
      if (pin.configRevisionId !== manifest.configRevisionId
        || pin.sourcePinId !== entry.sourcePinId
        || !same(pin.members, manifest.members)) conflict("Batch sibling source provenance changed.");
      const target = targetByBinding.get(entry.bindingId);
      const memberIndex = manifest.members.findIndex((member) => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId);
      if (memberIndex < 0 || pin.format !== "json" || pin.rootPointer === null
        || pin.locator.kind !== "json-pointer" || typeof pin.locator.pointer !== "string") conflict("Batch JSON locator is invalid.");
      const pointer = pin.locator.pointer as string;
      const rootPointer = pin.rootPointer as string;
      const beforeMember = base.files[memberIndex]!.content;
      const deleted = target?.action === "delete";
      const payload = { kind: "json" as const,
        value: readJsonSourceValue(deleted ? beforeMember : pin.fileId === proof.fileId ? after : beforeMember,
          pointer, rootPointer) as ContractJsonValue };
      if (target && !deleted) {
        const desired = target.target_value as { kind?: string; value?: unknown };
        if (desired?.kind !== "json-source" || !same(desired.value, payload.value)) conflict("Reviewed batch target differs from candidate bytes.");
      } else if (!target && (old.value_kind !== payload.kind || !same(old.value, payload.value))) {
        conflict("Batch candidate changed a sibling business value.");
      }
      let locator: Record<string, unknown> = pin.locator;
      if (deleted) {
        const deletion = deleteJsonSourceMember(beforeMember, pointer, rootPointer);
        if (pin.fileId !== proof.fileId) conflict("Batch deletion is outside the candidate file.");
        proveJsonSourceMemberAbsent(after, pointer, rootPointer);
        locator = { kind: "json-delete", ...deletionProof(deletion.proof), fileVersionId: version.id };
      }
      const appended = await appendProjectValue(asValueClient(tx), {
        snapshot,
        binding: {
          id: ParameterBindingId(stored.id), organizationId: stored.organization_id, projectId: stored.project_id,
          logicalNodeId: stored.logical_node_id, sourceOccurrenceId: stored.source_occurrence_id,
          registrationId: SubjectRegistrationId(stored.registration_id), subjectId: CatalogSubjectId(stored.subject_id),
          definitionId: ParameterDefinitionId(stored.definition_id),
          effectiveRevisionId: DefinitionRevisionId(stored.effective_revision_id),
          catalogRelease: snapshot.release, currentValueId: ProjectValueId(stored.current_value_id)
        },
        definitionRevisionId: DefinitionRevisionId(stored.effective_revision_id),
        expectedTip: ProjectValueId(entry.oldValueId),
        source: { sourceRef: old.source_ref, configRevisionId: revisionId },
        payload, valueState: deleted ? "deleted" : "present",
        sourceCommit: { requestId: request.id, auditRef, derived: !target }
      });
      if (!appended.ok) conflict(`Batch source append refused: ${appended.error.kind}`);
      const valueId = appended.value.currentTip;
      const pinId = randomUUID();
      const fileVersionId = pin.fileId === proof.fileId ? version.id : pin.fileVersionId;
      const deleteProof = deleted ? {
        kind: "json-delete-v1", scannerVersion: "json-span-v1", ...deletionProof(locator),
        beforeValueDigest: sourceDigest(old.value_digest),
        beforeSourceDigest: sourceDigest(manifest.members[memberIndex]!.checksum),
        afterSourceDigest: sourceDigest(candidate.checksum)
      } : null;
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,
         config_revision_id,file_id,file_version_id,format,locator,locator_digest,property_occurrence_id,
         value_state,base_source_pin_id,delete_request_id,delete_proof)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'json',$11::jsonb,$12,null,$13,$14,$15,$16::jsonb)`,
      [pinId, valueId, entry.bindingId, entry.definitionId, auth.organization.id, input.projectId,
        entry.sourceOccurrenceId, revisionId, pin.fileId, fileVersionId,
        JSON.stringify(locator), `sha256:${digest(serializeContract(locator as ContractJsonValue))}`,
        deleted ? "deleted" : "present", deleted ? pin.sourcePinId : null,
        deleted ? request.id : null, deleted ? JSON.stringify(deleteProof) : null]);
      const historyEventId = deriveHistoryEventId({
        bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: valueId
      });
      const result: AppliedResult = {
        ordinal: results.length, bindingId: entry.bindingId, oldValueId: entry.oldValueId,
        newValueId: valueId, sourcePinId: pinId, configRevisionId: revisionId,
        fileVersionId, historyEventId, kind: target ? "target" : "sibling-derived",
        action: deleted ? "delete" : "set", valueState: deleted ? "deleted" : "present"
      };
      results.push(result);
      if (target) {
        const updated = await tx.query(`update public.project_parameter_value_change_targets
          set applied_value_id=$2,applied_history_event_id=$3,applied_source_pin_id=$4,applied_file_version_id=$5
          where id=$1 and applied_value_id is null`,
          [target.id, valueId, historyEventId, pinId, fileVersionId]);
        if (updated.rowCount !== 1) conflict("Batch target lost its pending result transition.");
      }
    }
    const moved = await tx.query(`update public.project_parameter_files
      set current_version_id=$2,updated_at=now() where id=$1 and current_version_id=$3`,
      [proof.fileId, version.id, proof.baseVersionId]);
    if (moved.rowCount !== 1) conflict("Batch source file lost its compare-and-swap.");
    const result = { bindings: results };
    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      id: auditRef, invocation, app: "parameters", kind: "parameter-topology-governance",
      action: "value-change-applied", severity: "Medium", projectId: input.projectId,
      targetType: "project-parameter-value-change-request", targetId: request.id,
      metadata: {
        requestId: request.id, batchProofDigest: proof.batchProofDigest,
        configRevisionId: revisionId, bindingCount: results.length,
        cohortDigest: digest(serializeContract(proof.cohort)),
        resultDigest: digest(serializeContract(result)), result
      }, traceId: input.traceId
    });
    await tx.query(`update public.project_parameter_file_candidates
      set status='active',activated_at=now(),activated_by_user_id=$2,activated_version_id=$3 where id=$1`,
      [candidate.id, auth.user.id, version.id]);
    const approved = await tx.query(`update public.project_parameter_value_change_requests
      set status='approved',reviewer_user_id=$2,reviewer_note=$3,apply_outcome='committed',
          applied_at=now(),updated_at=now(),applied_audit_ref=$4,
          applied_file_version_ids=$5::jsonb,applied_source_result=$6::jsonb
      where id=$1 and status='pending' returning id`,
      [request.id, auth.user.id, input.note ?? null, auditRef,
        JSON.stringify([...new Set(results.map((item) => item.fileVersionId))]), JSON.stringify(result)]);
    if (approved.rowCount !== 1) conflict("Batch request lost its pending transition.");
    return { requestId: request.id, status: "approved", batchProofDigest: proof.batchProofDigest };
  } catch (error) { rethrowSourceTransactionError(error); }
}

function sourceDigest(value: string) { return value.startsWith("sha256:") ? value : `sha256:${value}`; }
function deletionProof(locator: Record<string, unknown>) {
  return {
    rootPointer: String(locator.rootPointer), pointer: String(locator.pointer),
    parentPointer: String(locator.parentPointer), memberKey: String(locator.memberKey)
  };
}
