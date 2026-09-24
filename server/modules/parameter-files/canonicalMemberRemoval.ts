import { createHash, randomUUID } from "node:crypto";

import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import { PARAMETER_GOVERNANCE_WRITER_ROLE, quoteIdent } from "../catalog-kernel/security/catalogRoleManifest";
import type { ObjectStore } from "../logs/objectStore";
import { DefinitionRevisionId, ParameterDefinitionId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { asValueClient } from "../parameter-bindings/catalogProjectValueSync";
import { digestProjectValuePayload, deriveHistoryEventId, deriveProjectValueId,
  insertBindingHistoryEvent, insertProjectValue, loadBindingById, loadProjectValueById,
  loadOwnedProjectValueSourcePin } from "../parameter-bindings/values/repositories";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import { canonicalSourceMemberMatchesCurrentFile, loadCanonicalSourceCohort,
  loadCanonicalSourceSnapshot, lockCanonicalSourceCohort, recordCanonicalPermissionRefusal,
  requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { readJsonSourceValue } from "./jsonSource";
import { rethrowSourceTransactionError } from "./sourceVersion";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const same = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function conflict(reason: string): never { throw new ApiError("CONFLICT", reason); }

export type CanonicalMemberRemovalProof = Readonly<{
  kind: "canonical-member-removal";
  organizationId: string;
  projectId: string;
  configSetId: string;
  fileId: string;
  fileVersionId: string;
  configRevisionId: string;
  members: readonly Readonly<{
    fileId: string; fileVersionId: string; sourceName: string; format: "json";
    role: string; sortOrder: number; checksum: string; sizeBytes: number;
  }>[];
  cohort: readonly Readonly<{
    bindingId: string; oldValueId: string; sourcePinId: string;
    sourceOccurrenceId: string; definitionId: string; effectiveRevisionId: string;
    catalogReleaseId: string; fileId: string; fileVersionId: string;
    locator: Record<string, ContractJsonValue>; valueDigest: string;
  }>[];
  proofDigest: string;
}>;

/** C owns submission/assignment. The database row, never this DTO, is the review authority. */
export type ReviewedCanonicalMemberRemoval = Readonly<{
  requestId: string;
  submitterUserId: string;
  reviewerUserId: string;
  decision: "approve";
  frozen: CanonicalMemberRemovalProof;
}>;

type MemberFile = {
  id: string; current_version_id: string | null; config_set_role: string | null;
  config_set_sort_order: number; format: string;
};

async function inspectMemberRemoval(
  tx: Database, storage: ObjectStore, organizationId: string,
  input: { projectId: string; configSetId: string; fileId: string }
): Promise<{ proof: CanonicalMemberRemovalProof; files: Array<{ name: string; content: string }> }> {
  const set = await tx.query(`select id from public.dts_config_set
    where id=$1 and organization_id=$2 and project_id=$3 for update nowait`,
  [input.configSetId, organizationId, input.projectId]);
  if (set.rows.length !== 1) throw new ApiError("NOT_FOUND", "Configuration set is unavailable.");
  const files = (await tx.query<MemberFile>(`select id,current_version_id,config_set_role,config_set_sort_order,format
    from public.project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3
    order by id for update nowait`, [organizationId, input.projectId, input.configSetId])).rows;
  if (!files.some((file) => file.id === input.fileId) || files.length < 2) {
    throw new ApiError("CONFLICT", "A current member with a surviving source file is required.");
  }
  await tx.query(`select version.id from public.project_parameter_file_versions version
    join public.project_parameter_files file on file.id=version.file_id and file.current_version_id=version.id
    where file.organization_id=$1 and file.project_id=$2 and file.config_set_id=$3
    order by version.id for update of version nowait`, [organizationId, input.projectId, input.configSetId]);
  const seed = (await tx.query<{ binding_id: string; value_id: string }>(`
    select binding.id as binding_id,binding.current_value_id as value_id
    from parameter_catalog.current_project_parameter_bindings binding
    join parameter_catalog.project_parameter_source_occurrences occurrence
      on occurrence.id=binding.source_occurrence_id
    where binding.organization_id=$1 and binding.project_id=$2
      and occurrence.config_set_id=$3 and occurrence.file_id=$4 order by binding.id limit 1`,
  [organizationId, input.projectId, input.configSetId, input.fileId])).rows[0];
  if (!seed) conflict("Removed source member has no current Binding cohort.");
  const sourcePin = await loadOwnedProjectValueSourcePin(tx, {
    organizationId, projectId: input.projectId, bindingId: seed.binding_id, projectValueId: seed.value_id
  });
  if (!sourcePin) conflict("Removed source member has no exact source pin.");
  await lockCanonicalSourceCohort(tx, sourcePin);
  const cohort = await loadCanonicalSourceCohort(tx, {
    organizationId, projectId: input.projectId, configSetId: input.configSetId
  });
  const snapshot = await loadCanonicalSourceSnapshot(tx, storage, {
    organizationId, projectId: input.projectId, bindingId: seed.binding_id, projectValueId: seed.value_id
  });
  if (snapshot.manifest.configSetId !== input.configSetId
    || snapshot.manifest.members.length !== files.length
    || snapshot.manifest.members.some((member) => {
      const current = files.find((file) => file.id === member.fileId);
      return !current || member.format !== "json" || !canonicalSourceMemberMatchesCurrentFile(member,current);
    })) conflict("Current source members differ from the exact pinned revision.");
  const frozenCohort: CanonicalMemberRemovalProof["cohort"][number][] = [];
  for (const entry of cohort) {
    const pin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId, projectId: input.projectId,
      bindingId: entry.bindingId, projectValueId: entry.oldValueId
    });
    if (!pin || pin.configRevisionId !== snapshot.manifest.configRevisionId
      || pin.sourcePinId !== entry.sourcePinId || pin.configSetId !== input.configSetId
      || pin.valueState !== "present" || pin.format !== "json"
      || !snapshot.manifest.members.some((member) => member.fileId === pin.fileId
        && member.fileVersionId === pin.fileVersionId)) conflict("Source cohort has an unpinned or stale member.");
    frozenCohort.push({
      bindingId: entry.bindingId, oldValueId: entry.oldValueId, sourcePinId: pin.sourcePinId,
      sourceOccurrenceId: entry.sourceOccurrenceId, definitionId: entry.definitionId,
      effectiveRevisionId: entry.effectiveRevisionId, catalogReleaseId: entry.catalogReleaseId,
      fileId: pin.fileId, fileVersionId: pin.fileVersionId,
      locator: pin.locator, valueDigest: entry.valueDigest
    });
  }
  if (!frozenCohort.some((entry) => entry.fileId === input.fileId)
    || !frozenCohort.some((entry) => entry.fileId !== input.fileId)) {
    conflict("Both removed and surviving members need an exact current Binding.");
  }
  const removedFile = snapshot.manifest.members.find((member) => member.fileId === input.fileId)!;
  const base = {
    kind: "canonical-member-removal" as const,
    organizationId, projectId: input.projectId, configSetId: input.configSetId,
    fileId: input.fileId, fileVersionId: removedFile.fileVersionId,
    configRevisionId: snapshot.manifest.configRevisionId,
    members: snapshot.manifest.members.map(({ fileId, fileVersionId, sourceName, format,
      role, sortOrder, checksum, sizeBytes }) => ({
      fileId, fileVersionId, sourceName, format: format as "json", role, sortOrder, checksum, sizeBytes
    })),
    cohort: frozenCohort
  };
  return { proof: { ...base, proofDigest: digest(serializeContract(base)) }, files: snapshot.files };
}

/** Read and lock one exact source cohort; C persists this DTO in its pending request. */
export async function prepareCanonicalMemberRemoval(
  tx: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; configSetId: string; fileId: string;
    invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<CanonicalMemberRemovalProof> {
  const security: CanonicalSourceSecurityContext = {
    invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink
  };
  await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical member removal prepare",
    targetType: "project-parameter-file", targetId: input.fileId
  });
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical member removal prepare",
      targetType: "project-parameter-file", targetId: input.fileId
    });
    throw new ApiError("FORBIDDEN", "Parameter file administration is required.");
  }
  try {
    return (await inspectMemberRemoval(tx, storage, auth.organization.id, input)).proof;
  } catch (error) { rethrowSourceTransactionError(error); }
}

/** C calls this inside its reviewed request transaction; all D writes share that COMMIT. */
export async function applyReviewedCanonicalMemberRemoval(
  tx: Database, storage: ObjectStore, auth: AuthContext, snapshot: CatalogSnapshot,
  review: ReviewedCanonicalMemberRemoval,
  context: { invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink }
): Promise<{ requestId: string; tombstoneId: string; successorConfigRevisionId: string; replayed: boolean }> {
  const frozen = review.frozen;
  const security: CanonicalSourceSecurityContext = {
    invocation: context.invocation, requestId: context.traceId, refusalSink: context.refusalSink
  };
  try {
    const request = (await tx.query<{
      status: string; submitter_user_id: string | null; assigned_to_user_id: string | null;
      reviewer_user_id: string | null; member_proof_digest: string;
      member_frozen_proof: CanonicalMemberRemovalProof; applied_source_result: {
        tombstoneId: string; successorConfigRevisionId: string
      } | null; applied_audit_ref: string | null;
    }>(`select status,submitter_user_id,assigned_to_user_id,reviewer_user_id,
        member_proof_digest,member_frozen_proof,applied_source_result,applied_audit_ref
      from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='member-removal'
        and member_file_id=$4 and member_config_set_id=$5 and member_file_version_id=$6
      for update`, [review.requestId, auth.organization.id, frozen.projectId,
      frozen.fileId, frozen.configSetId, frozen.fileVersionId])).rows[0];
    if (!request) throw new ApiError("NOT_FOUND", "Member removal review request is unavailable.");
    if (request.member_proof_digest !== frozen.proofDigest
      || !same(request.member_frozen_proof, frozen)
      || request.submitter_user_id !== review.submitterUserId
      || request.assigned_to_user_id !== review.reviewerUserId
      || !['pending', 'approved'].includes(request.status)) {
      throw new ApiError("CONFLICT", "Member removal has no matching frozen review request.");
    }
    const invocation = await requireCanonicalUserInvocation(auth, security, {
      projectId: frozen.projectId, operation: "canonical member removal apply",
      targetType: "project-parameter-file", targetId: frozen.fileId
    });
    if (!review.requestId.trim() || review.reviewerUserId !== auth.user.id
      || review.submitterUserId === auth.user.id
      || frozen.organizationId !== auth.organization.id
      || !canEditParameters(auth, frozen.projectId) || !canReviewParameters(auth)
      || !canReviewParameterStage(auth, frozen.projectId, "software_review")
      || !await hasCurrentCanonicalReviewRole(tx, {
        organizationId: auth.organization.id, projectId: frozen.projectId, userId: auth.user.id
      })) {
      await recordCanonicalPermissionRefusal(security, {
        projectId: frozen.projectId, operation: "canonical member removal apply",
        targetType: "project-parameter-file", targetId: frozen.fileId
      });
      throw new ApiError("FORBIDDEN", "A separate current project reviewer is required.");
    }
    const existing = (await tx.query<{ id: string; successor_config_revision_id: string; metadata: unknown }>(`
      select tombstone.id,tombstone.successor_config_revision_id,audit.metadata
      from parameter_catalog.project_source_member_tombstones tombstone
      join public.audit_events audit on audit.id=tombstone.audit_event_id
      where tombstone.organization_id=$1 and tombstone.project_id=$2
        and tombstone.config_set_id=$3 and tombstone.file_id=$4`,
    [auth.organization.id, frozen.projectId, frozen.configSetId, frozen.fileId])).rows[0];
    if (existing) {
      const metadata = existing.metadata as Record<string, unknown>;
      if (metadata.reviewRequestId !== review.requestId || metadata.proofDigest !== frozen.proofDigest
        || metadata.submitterUserId !== review.submitterUserId
        || !existing.successor_config_revision_id || request.status !== 'approved'
        || request.reviewer_user_id !== auth.user.id
        || request.applied_source_result?.tombstoneId !== existing.id
        || request.applied_source_result?.successorConfigRevisionId !== existing.successor_config_revision_id
        || !request.applied_audit_ref) conflict("Removed member has a different reviewed receipt.");
      return { requestId: review.requestId, tombstoneId: existing.id,
        successorConfigRevisionId: existing.successor_config_revision_id, replayed: true };
    }
    if (request.status !== 'pending') conflict("Member removal request is not pending.");
    const inspected = await inspectMemberRemoval(tx, storage, auth.organization.id, frozen);
    if (!same(inspected.proof, frozen)) conflict("Member removal source proof is stale.");
    const attribution = trustedDomainAttribution(invocation);
    const successorConfigRevisionId = randomUUID();
    await insertConfigRevision(tx, {
      id: successorConfigRevisionId, organizationId: auth.organization.id,
      projectId: frozen.projectId, configSetId: frozen.configSetId,
      revisionNumber: await nextConfigRevisionNumber(tx, frozen.configSetId),
      status: "resolved", attribution
    });
    await insertConfigRevisionMembers(tx, successorConfigRevisionId,
      frozen.members.filter((member) => member.fileId !== frozen.fileId).map((member) => ({
        fileId: member.fileId, fileVersionId: member.fileVersionId,
        fileName: member.sourceName, sourceName: member.sourceName,
        format: member.format, role: member.role as ConfigRevisionMemberRole,
        sortOrder: member.sortOrder, content: ""
      })));
    const auditEventId = randomUUID();
    const successorBindings: Array<{
      bindingId: string; oldValueId: string; newValueId: string; sourcePinId: string;
      historyEventId: string; fileId: string; fileVersionId: string;
    }> = [];
    for (const entry of frozen.cohort.filter((row) => row.fileId !== frozen.fileId)) {
      const binding = await loadBindingById(asValueClient(tx), entry.bindingId, "update");
      const old = await loadProjectValueById(asValueClient(tx), entry.oldValueId);
      if (!binding || !old || binding.organization_id !== auth.organization.id
        || binding.project_id !== frozen.projectId || binding.current_value_id !== entry.oldValueId
        || binding.source_occurrence_id !== entry.sourceOccurrenceId
        || binding.catalog_release_id !== snapshot.release.id
        || binding.definition_id !== entry.definitionId
        || binding.effective_revision_id !== entry.effectiveRevisionId
        || old.value_kind !== "json" || old.value_state !== "present"
        || old.value_digest !== entry.valueDigest) conflict("Surviving Binding base is stale.");
      const registration = await readSourceRegistrationAgreement(tx, {
        organizationId: auth.organization.id, subjectId: binding.subject_id
      });
      if (registration?.id !== binding.registration_id
        || snapshot.getDefinitionRevision({
          definitionId: ParameterDefinitionId(binding.definition_id),
          revisionId: DefinitionRevisionId(binding.effective_revision_id)
        }).status !== "found") conflict("Surviving Binding registration or Definition is unavailable.");
      const memberIndex = frozen.members.findIndex((member) => member.fileId === entry.fileId);
      const ownPin = await loadOwnedProjectValueSourcePin(tx, {
        organizationId: auth.organization.id, projectId: frozen.projectId,
        bindingId: entry.bindingId, projectValueId: entry.oldValueId
      });
      if (memberIndex < 0 || !ownPin || ownPin.sourcePinId !== entry.sourcePinId
        || ownPin.configRevisionId !== frozen.configRevisionId
        || ownPin.locator.kind !== "json-pointer"
        || typeof ownPin.locator.pointer !== "string" || ownPin.rootPointer === null) {
        conflict("Surviving Binding has no exact JSON source locator.");
      }
      const sourceValue = readJsonSourceValue(inspected.files[memberIndex]!.content,
        ownPin.locator.pointer as string, ownPin.rootPointer);
      const payload = { kind: "json" as const, value: old.value as ContractJsonValue };
      const valueDigest = digestProjectValuePayload(payload);
      if (old.value_digest !== valueDigest || !same(sourceValue, payload.value)) {
        conflict("Surviving JSON value differs from its exact source bytes.");
      }
      const newValueId = deriveProjectValueId({
        bindingId: entry.bindingId, definitionRevisionId: DefinitionRevisionId(entry.effectiveRevisionId),
        sourceRef: old.source_ref, configRevisionId: successorConfigRevisionId,
        valueKind: "json", valueDigest, expectedTip: entry.oldValueId
      });
      const inserted = await insertProjectValue(asValueClient(tx), {
        id: newValueId, bindingId: entry.bindingId, definitionId: entry.definitionId,
        definitionRevisionId: entry.effectiveRevisionId, sourceRef: old.source_ref,
        configRevisionId: successorConfigRevisionId, valueDigest, valueKind: "json",
        valueJson: JSON.stringify(payload.value), valueState: "present"
      });
      if (!inserted) conflict("Surviving Value revision already exists.");
      const moved = await tx.query(`update parameter_catalog.project_parameter_bindings
        set current_value_id=$3,updated_at=now() where id=$1 and current_value_id=$2
          and organization_id=$4 and project_id=$5 and source_occurrence_id=$6
          and not parameter_catalog.is_replaced_current_binding(id)`,
      [entry.bindingId, entry.oldValueId, newValueId,
        auth.organization.id, frozen.projectId, entry.sourceOccurrenceId]);
      if (moved.rowCount !== 1) conflict("Surviving Binding lost its exact Value tip.");
      const sourcePinId = randomUUID();
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,
         config_revision_id,file_id,file_version_id,format,locator,locator_digest)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'json',$11::jsonb,$12)`,
      [sourcePinId, newValueId, entry.bindingId, entry.definitionId,
        auth.organization.id, frozen.projectId, entry.sourceOccurrenceId,
        successorConfigRevisionId, entry.fileId, entry.fileVersionId,
        JSON.stringify(entry.locator), `sha256:${digest(serializeContract(entry.locator))}`]);
      const historyEventId = deriveHistoryEventId({
        bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: newValueId
      });
      await insertBindingHistoryEvent(asValueClient(tx), {
        id: historyEventId, bindingId: entry.bindingId,
        effectiveRevisionId: entry.effectiveRevisionId,
        oldCurrentValueId: entry.oldValueId, newCurrentValueId: newValueId,
        successAuditRef: auditEventId, catalogReleaseId: entry.catalogReleaseId,
        reason: "source-revision-propagation"
      });
      successorBindings.push({ bindingId: entry.bindingId, oldValueId: entry.oldValueId,
        newValueId, sourcePinId, historyEventId, fileId: entry.fileId,
        fileVersionId: entry.fileVersionId });
    }
    const removedBindings = frozen.cohort.filter((row) => row.fileId === frozen.fileId)
      .map((row) => ({ bindingId: row.bindingId, valueId: row.oldValueId, sourcePinId: row.sourcePinId }));
    const tombstoneId = randomUUID();
    await writeTrustedAuditEventInTx(asAuditTx(tx), {
      id: auditEventId, invocation, app: "parameters", kind: "parameter-topology-governance",
      action: "source-member-removed", severity: "Medium", projectId: frozen.projectId,
      targetType: "project-parameter-file", targetId: frozen.fileId,
      metadata: {
        tombstoneId, configSetId: frozen.configSetId, configRevisionId: frozen.configRevisionId,
        fileVersionId: frozen.fileVersionId, bindings: removedBindings,
        successorConfigRevisionId, successorBindings,
        reviewRequestId: review.requestId, submitterUserId: review.submitterUserId,
        proofDigest: frozen.proofDigest
      }, traceId: context.traceId
    });
    await tx.query(`set local role ${quoteIdent(PARAMETER_GOVERNANCE_WRITER_ROLE)}`);
    await tx.query(`select parameter_catalog.insert_reviewed_member_tombstone(
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
    [tombstoneId, auth.organization.id, frozen.projectId, frozen.configSetId,
      frozen.fileId, frozen.configRevisionId, frozen.fileVersionId,
      JSON.stringify(removedBindings), successorConfigRevisionId,
      JSON.stringify(successorBindings), auditEventId]);
    await tx.query("reset role");
    const detached = await tx.query(`update public.project_parameter_files
      set config_set_id=null,config_set_role=null,config_set_sort_order=0,updated_at=now()
      where id=$1 and organization_id=$2 and project_id=$3
        and config_set_id=$4 and current_version_id=$5`,
    [frozen.fileId, auth.organization.id, frozen.projectId,
      frozen.configSetId, frozen.fileVersionId]);
    if (detached.rowCount !== 1) conflict("Removed file lost its exact membership or version.");
    const approved = await tx.query(`update public.project_parameter_value_change_requests
      set status='approved',reviewer_user_id=$2,applied_at=now(),apply_outcome='committed',
        applied_audit_ref=$3,applied_file_version_ids='[]'::jsonb,
        applied_source_result=$4::jsonb,updated_at=now()
      where id=$1 and status='pending' and assigned_to_user_id=$2`,
    [review.requestId, auth.user.id, auditEventId,
      JSON.stringify({ tombstoneId, successorConfigRevisionId })]);
    if (approved.rowCount !== 1) conflict("Member removal review decision changed.");
    return { requestId: review.requestId, tombstoneId, successorConfigRevisionId, replayed: false };
  } catch (error) { rethrowSourceTransactionError(error); }
}
