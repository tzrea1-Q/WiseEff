import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import { getCanonicalValueChangeRequest, getCanonicalValueChangeRequestForUpdate, type CanonicalValueChangeRequestRow } from "../parameter-bindings/drafts/changeRepository";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { canEditParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { assertPinnedCanonicalSensitiveNodeWriteAllowed, lockCanonicalSourceCohort, loadCanonicalSourceCohort, loadCanonicalSourceSnapshot, requireCanonicalUserInvocation, recordCanonicalPermissionRefusal, validatePinnedDtsSourceChange, validatePinnedDtsSourceDeletion, type CanonicalSourceBindingPin, type CanonicalSourceManifest, type CanonicalSourceSecurityContext } from "./canonicalSource";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { MAX_PARAMETER_SOURCE_BYTES, deleteJsonSourceMember, parseJsonSource, proveJsonSourceMemberAbsent, readJsonSourceValue } from "./jsonSource";
import { insertFileVersion } from "./repository";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import { asValueClient, dtsValueToPayload, listObservedProperties, rawTextToPayload } from "../parameter-bindings/catalogProjectValueSync";
import { appendProjectValue, loadOwnedProjectValueSourcePin, type ProjectValuePayload } from "../parameter-bindings/values";
import { lockExactSourceRevisionsForProof, rethrowSourceTransactionError } from "./sourceVersion";
import { deriveHistoryEventId, loadBindingById, loadDeletedSourceAnchors, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { CatalogSubjectId, DefinitionRevisionId, ParameterBindingId, ParameterDefinitionId, ProjectValueId, SubjectRegistrationId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import type { ParsedIndex } from "./types";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import type { DtsValue } from "../dts/types";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";

type SourceRequest = CanonicalValueChangeRequestRow & {
  source_pin_id: string; candidate_id: string; candidate_base_digest: string; candidate_proposed_digest: string;
  candidate_diff_digest: string; candidate_member_manifest: unknown; candidate_binding_manifest: CanonicalSourceBindingPin[];
};
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sourceDigest = (value: string) => value.startsWith("sha256:") ? value : `sha256:${value}`;
const same = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function conflict(message: string): never { throw new ApiError("CONFLICT", message); }

async function assertDeletedAnchorsRemainAbsent(
  db: Queryable,
  input: { configSetId: string; revisionId: string; manifest: CanonicalSourceManifest; baseFiles: Array<{ content: string }>; candidateFileId: string; candidateAfter: string },
) {
  const deleted = await loadDeletedSourceAnchors(db, { organizationId: input.manifest.organizationId, projectId: input.manifest.projectId, configSetId: input.configSetId });
  for (const anchor of deleted) {
    if (anchor.format === "json") {
      if (anchor.locator.kind !== "json-delete" || typeof anchor.locator.pointer !== "string" || typeof anchor.locator.rootPointer !== "string") conflict("Deleted JSON anchor has invalid proof.");
      const member = input.manifest.members.find((candidate) => candidate.fileId === anchor.fileId);
      if (!member) conflict("Deleted JSON anchor is outside the source member set.");
      const fileIndex = input.manifest.members.indexOf(member);
      const content = anchor.fileId === input.candidateFileId ? input.candidateAfter : input.baseFiles[fileIndex]!.content;
      proveJsonSourceMemberAbsent(content, anchor.locator.pointer, anchor.locator.rootPointer);
    } else {
      if (!anchor.logicalNodeId || anchor.locator.kind !== "dts-delete" || typeof anchor.locator.propertyName !== "string") conflict("Deleted DTS anchor has invalid proof.");
      const member = (await db.query<{ file_version_id: string }>(
        `select file_version_id from dts_config_revision_members where config_revision_id=$1 and file_id=$2`,
        [input.revisionId,anchor.fileId],
      )).rows;
      if (member.length !== 1) conflict("Deleted DTS anchor is outside the exact source manifest.");
      await loadFinalDtsDeleteProof(db, { configRevisionId: input.revisionId, logicalNodeId: anchor.logicalNodeId,
        fileVersionId: member[0]!.file_version_id, propertyName: anchor.locator.propertyName });
    }
  }
}

async function loadFinalDtsDeleteProof(
  db: Queryable,
  input: { configRevisionId: string; logicalNodeId: string; nodeOccurrenceId?: string; fileVersionId: string; propertyName: string },
) {
  const result = await db.query<{ node_occurrence_id: string }>(
    `select effect.node_occurrence_id
       from dts_occurrence_effects effect
       join dts_logical_node_revisions logical
         on logical.id = effect.logical_node_revision_id
        and logical.config_revision_id = effect.config_revision_id
       join dts_node_occurrences node
         on node.id = effect.node_occurrence_id
        and node.config_revision_id = effect.config_revision_id
        and node.file_version_id = $4
      where effect.config_revision_id = $1
        and logical.logical_node_id = $2
        and effect.property_name = $5
        and effect.effect_kind = 'delete'
        and effect.property_occurrence_id is null
        and ($3::text is null or effect.node_occurrence_id = $3)
        and not exists (
          select 1
            from dts_occurrence_effects later
           where later.config_revision_id = effect.config_revision_id
             and later.logical_node_revision_id = effect.logical_node_revision_id
             and later.property_name = effect.property_name
             and (later.source_order > effect.source_order
               or (later.source_order = effect.source_order and later.id <> effect.id))
        )`,
    [input.configRevisionId, input.logicalNodeId, input.nodeOccurrenceId, input.fileVersionId, input.propertyName],
  );
  if (result.rows.length !== 1) conflict("Approved DTS deletion lacks one exact final delete effect.");
  return result.rows[0]!;
}

async function revalidateApprovedDeleteReplay(
  db: Queryable,
  storage: ObjectStore,
  request: SourceRequest,
) {
  if (request.action !== "delete") return;
  if (!request.applied_value_id || !request.source_pin_id || !request.applied_source_result) {
    conflict("Approved deletion has no complete recorded source result.");
  }
  const baseValue = await loadProjectValueById(asValueClient(db),request.base_current_value_id);
  const basePin = await loadOwnedProjectValueSourcePin(db,{
    organizationId: request.organization_id,projectId: request.project_id,bindingId: request.binding_id,projectValueId: request.base_current_value_id,
  });
  const appliedPin = await loadOwnedProjectValueSourcePin(db,{
    organizationId: request.organization_id,projectId: request.project_id,bindingId: request.binding_id,projectValueId: request.applied_value_id,
  });
  if (!baseValue || !basePin || basePin.sourcePinId !== request.source_pin_id || basePin.valueState !== "present"
    || !appliedPin || appliedPin.valueState !== "deleted" || appliedPin.baseSourcePinId !== request.source_pin_id
    || appliedPin.deleteRequestId !== request.id || appliedPin.format !== basePin.format) {
    conflict("Approved deletion no longer has its exact immutable base and tombstone pins.");
  }
  await lockExactSourceRevisionsForProof(db,[basePin,appliedPin]);
  const base = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: request.organization_id,projectId: request.project_id,bindingId: request.binding_id,projectValueId: request.base_current_value_id });
  const applied = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: request.organization_id,projectId: request.project_id,bindingId: request.binding_id,projectValueId: request.applied_value_id });
  const baseMember = base.manifest.members.find((member) => member.fileId === basePin.fileId && member.fileVersionId === basePin.fileVersionId);
  const appliedMember = applied.manifest.members.find((member) => member.fileId === appliedPin.fileId && member.fileVersionId === appliedPin.fileVersionId);
  if (!baseMember || !appliedMember || !appliedPin.deleteProof) conflict("Approved deletion source members are incomplete.");
  const appliedFile = applied.files[applied.manifest.members.indexOf(appliedMember)]!;
  const baseFile = base.files[base.manifest.members.indexOf(baseMember)]!;
  const proof = appliedPin.deleteProof as Record<string, unknown>;
  if (proof.beforeValueDigest !== sourceDigest(baseValue.value_digest)
    || proof.beforeSourceDigest !== sourceDigest(baseMember.checksum)
    || proof.afterSourceDigest !== sourceDigest(appliedMember.checksum)) {
    conflict("Approved deletion proof no longer matches its immutable source bytes.");
  }
  if (appliedPin.format === "json") {
    const locator = appliedPin.locator;
    if (locator.kind !== "json-delete" || typeof locator.pointer !== "string" || typeof locator.rootPointer !== "string"
      || proof.kind !== "json-delete-v1" || proof.scannerVersion !== "json-span-v1"
      || proof.rootPointer !== locator.rootPointer || proof.pointer !== locator.pointer
      || proof.parentPointer !== locator.parentPointer || proof.memberKey !== locator.memberKey) {
      conflict("Approved JSON deletion proof is not exact.");
    }
    proveJsonSourceMemberAbsent(appliedFile.content,locator.pointer,locator.rootPointer);
    if (basePin.locator.kind !== "json-pointer" || basePin.locator.pointer !== locator.pointer
      || deleteJsonSourceMember(baseFile.content,locator.pointer,locator.rootPointer).bytes.toString("utf8") !== appliedFile.content) {
      conflict("Approved JSON deletion changed non-target source bytes.");
    }
  } else {
    const locator = appliedPin.locator;
    if (locator.kind !== "dts-delete" || typeof locator.nodeOccurrenceId !== "string" || typeof locator.propertyName !== "string"
      || appliedPin.logicalNodeId === null || proof.kind !== "dts-delete-v1" || proof.scannerVersion !== "dts-cst-v1"
      || proof.nodeOccurrenceId !== locator.nodeOccurrenceId || proof.propertyName !== locator.propertyName) {
      conflict("Approved DTS deletion proof is not exact.");
    }
    const deleted = await loadFinalDtsDeleteProof(db,{ configRevisionId: appliedPin.configRevisionId,logicalNodeId: appliedPin.logicalNodeId!,nodeOccurrenceId: locator.nodeOccurrenceId,fileVersionId: appliedPin.fileVersionId,propertyName: locator.propertyName });
    if (deleted.node_occurrence_id !== locator.nodeOccurrenceId) conflict("Approved DTS deletion lost its exact final delete effect.");
    await validatePinnedDtsSourceDeletion(db,base.manifest,baseFile.content,appliedFile.content);
  }
  const result = request.applied_source_result as { bindings?: unknown };
  const bindings = Array.isArray(result.bindings) ? result.bindings : [];
  const target = bindings.find((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && (entry as Record<string, unknown>).bindingId === request.binding_id));
  if (!target || target.newValueId !== request.applied_value_id || target.sourcePinId !== appliedPin.sourcePinId
    || target.action !== "delete" || target.valueState !== "deleted" || target.fileVersionId !== appliedPin.fileVersionId
    || target.configRevisionId !== appliedPin.configRevisionId || target.historyEventId !== request.applied_history_event_id) {
    conflict("Approved deletion source result no longer matches its tombstone.");
  }
}

/** Caller-owned audited transaction; this is the canonical source apply boundary. */
export async function commitCanonicalSourceRevision(
  db: Queryable, storage: ObjectStore, auth: AuthContext, snapshot: CatalogSnapshot,
  input: { projectId: string; requestId: string; invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink; note?: string | null },
): Promise<CanonicalValueChangeRequestRow> {
  try {
  const security: CanonicalSourceSecurityContext = { invocation: input.invocation, requestId: input.traceId, refusalSink: input.refusalSink };
  const invocation = await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical source apply", targetType: "project-parameter-value-change-request", targetId: input.requestId
  });
  if (!canEditParameters(auth,input.projectId) || !canReviewParameters(auth) || !canReviewParameterStage(auth,input.projectId,"software_review")) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical source apply", targetType: "project-parameter-value-change-request", targetId: input.requestId,
      details: { permission: !canEditParameters(auth,input.projectId) ? "parameter:edit" : "parameter:review" }
    });
    throw new ApiError("FORBIDDEN", "Project software review authorization is required.");
  }
  if (!await hasCurrentCanonicalReviewRole(db, {
    organizationId: auth.organization.id,
    projectId: input.projectId,
    userId: auth.user.id
  })) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId,
      operation: "canonical source apply",
      targetType: "project-parameter-value-change-request",
      targetId: input.requestId,
      details: { reason: "current-review-role-required" }
    });
    throw new ApiError("FORBIDDEN", "Project software review authorization is required.");
  }
  const readRequest = (lock = false) => (lock ? getCanonicalValueChangeRequestForUpdate : getCanonicalValueChangeRequest)(db,
    { requestId: input.requestId,organizationId: auth.organization.id,projectId: input.projectId }) as Promise<SourceRequest | null>;
  const initial = await readRequest();
  if (!initial) throw new ApiError("NOT_FOUND", "Source change request was not found.");
  if (initial.submitter_user_id === auth.user.id) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId,
      operation: "canonical source apply",
      targetType: "project-parameter-value-change-request",
      targetId: input.requestId,
      details: { reason: "submitter-self-review" }
    });
    throw new ApiError("FORBIDDEN", "The submitter cannot approve their own parameter change.");
  }
  if (initial.status === "approved") {
    await revalidateApprovedDeleteReplay(db,storage,initial);
    return initial;
  }
  if (initial.status !== "pending" || !["set", "delete"].includes(initial.action) || !initial.source_pin_id || !initial.candidate_id) conflict("A pending prepared source request is required.");
  const sourceIdentity = await loadOwnedProjectValueSourcePin(db, {
    organizationId: auth.organization.id,projectId: input.projectId,bindingId: initial.binding_id,projectValueId: initial.base_current_value_id,
  });
  if (!sourceIdentity) conflict("Source value has no exact owned pin.");
  await lockCanonicalSourceCohort(db,sourceIdentity);
  const base = await loadCanonicalSourceSnapshot(db,storage, {
    organizationId: auth.organization.id,projectId: input.projectId,bindingId: initial.binding_id,projectValueId: initial.base_current_value_id,
  });
  const manifest = base.manifest;
  await assertPinnedCanonicalSensitiveNodeWriteAllowed(db, auth, manifest, security);
  const current = await db.query<{ id: string; current_version_id: string; config_set_role: string; config_set_sort_order: number; format: string }>(
    `select id,current_version_id,config_set_role,config_set_sort_order,format from project_parameter_files where config_set_id=$1 order by id for update nowait`, [manifest.configSetId]);
  const cohort = await loadCanonicalSourceCohort(db,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId: manifest.configSetId });
  const request = await readRequest(true);
  if (!request) conflict("Source request disappeared.");
  if (request.status === "approved") {
    await revalidateApprovedDeleteReplay(db,storage,request);
    return request;
  }
  if (cohort.find((entry) => entry.bindingId === request.binding_id)?.oldValueId !== request.base_current_value_id) {
    throw new ApiError("CONFLICT", "Source request base value is stale.", { reason: "stale-base-value" });
  }
  if (request.status !== "pending" || !same(request.candidate_binding_manifest,cohort)) conflict("Source Binding cohort is stale; prepare and review again.");
  if (current.rows.length !== manifest.members.length || current.rows.some((file) => !manifest.members.some((member) =>
    member.fileId === file.id && member.fileVersionId === file.current_version_id && member.role === file.config_set_role && member.sortOrder === file.config_set_sort_order && member.format === file.format))) {
    conflict("Source member set or file versions are stale; prepare and review again.");
  }
  const frozenMembers = manifest.members.map((member) => ({ ...member,configSetId: manifest.configSetId,isCandidateFile: member.fileId === manifest.fileId }))
    .sort((left,right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0);
  if (request.source_pin_id !== manifest.sourcePinId || request.config_revision_id !== manifest.configRevisionId
    || !same(request.candidate_member_manifest,frozenMembers)) conflict("Submitted source provenance disagrees with its immutable base.");
  const candidate = (await db.query<{
    id: string; file_id: string; format: string; base_version_id: string; storage_key: string; checksum: string;
    size_bytes: number; parsed_index: ParsedIndex; status: string; base_digest: string; proposed_digest: string; diff_digest: string;
    frozen_member_manifest: unknown; frozen_binding_manifest: unknown;
  }>(`select *,size_bytes::float8 as size_bytes from project_parameter_file_candidates where id=$1 and organization_id=$2 and project_id=$3`,
  [request.candidate_id,auth.organization.id,input.projectId])).rows[0];
  if (!candidate || candidate.status !== "ready" || candidate.file_id !== manifest.fileId || candidate.base_version_id !== manifest.fileVersionId
    || candidate.format !== manifest.format || candidate.base_digest !== request.candidate_base_digest
    || candidate.proposed_digest !== request.candidate_proposed_digest || candidate.diff_digest !== request.candidate_diff_digest
    || !same(candidate.frozen_member_manifest,frozenMembers) || !same(candidate.frozen_binding_manifest,cohort)) conflict("Prepared source artifact is stale or inconsistent.");
  if (!storage.getBounded || !Number.isSafeInteger(candidate.size_bytes) || candidate.size_bytes < 0 || candidate.size_bytes > MAX_PARAMETER_SOURCE_BYTES) conflict("Bounded source storage is required.");
  const bytes = await storage.getBounded(candidate.storage_key,MAX_PARAMETER_SOURCE_BYTES);
  if (bytes.length !== candidate.size_bytes || digest(bytes) !== candidate.proposed_digest || digest(bytes) !== candidate.checksum.replace(/^sha256:/,"")) conflict("Prepared source bytes failed integrity verification.");
  const after = new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(bytes);
  const sourceIndex = manifest.members.findIndex((member) => member.fileId === manifest.fileId);
  const before = base.files[sourceIndex]!.content;
  if (digest(before) !== candidate.base_digest || digest(serializeContract({ before,after,sourcePinId: manifest.sourcePinId,bindings: cohort })) !== candidate.diff_digest) conflict("Reviewed source diff no longer matches the candidate.");
  if (manifest.format === "json") {
    parseJsonSource(bytes);
    if (request.action === "delete") {
      if (manifest.locator.kind !== "json-pointer" || typeof manifest.locator.pointer !== "string" || manifest.rootPointer === null) conflict("JSON deletion target has no exact object-member pin.");
      const deletion = deleteJsonSourceMember(before, manifest.locator.pointer, manifest.rootPointer);
      if (deletion.bytes.toString("utf8") !== after) conflict("Prepared JSON deletion does not match the scanner proof.");
    }
  } else if (request.action === "delete") await validatePinnedDtsSourceDeletion(db, manifest, before, after);
  else await validatePinnedDtsSourceChange(db, manifest, before, after);
  const attribution = trustedDomainAttribution(invocation);
  const version = await insertFileVersion(db,{ id: randomUUID(),fileId: manifest.fileId,versionNumber: 0,storageKey: candidate.storage_key,
    checksum: candidate.checksum,sizeBytes: bytes.length,parsedIndex: candidate.parsed_index,origin: "writeback",attribution });
  const members = manifest.members.map((member,index) => ({
    fileId: member.fileId,fileVersionId: member.fileId === manifest.fileId ? version.id : member.fileVersionId,fileName: base.files[index]!.name,sourceName: member.sourceName,
    format: member.format,role: member.role as ConfigRevisionMemberRole,sortOrder: member.sortOrder,content: member.fileId === manifest.fileId ? after : base.files[index]!.content,
  }));
  let revisionId: string;
  if (members.some((member) => member.format === "dts")) {
    const previous = (await db.query<{ entry_file: string; include_search_paths: string[]; overlay_order: string[] }>(
      `select entry_file,include_search_paths,overlay_order from dts_config_revisions where id=$1`, [manifest.configRevisionId])).rows[0];
    if (!previous?.entry_file) conflict("DTS source revision has no complete entry manifest.");
    const revision = await ingestConfigRevisionInTransaction(db,{
      organizationId: auth.organization.id,projectId: input.projectId,configSetId: manifest.configSetId,
      entryFile: previous.entry_file,includeSearchPaths: previous.include_search_paths,overlayOrder: previous.overlay_order,members,
    },auth,{ createdByUserId: attribution.userId,domain: attribution },{ sourceCommit: { baseConfigRevisionId: manifest.configRevisionId } });
    if (revision.status !== "resolved") conflict("Prepared DTS revision has unresolved syntax or source identity.");
    revisionId = revision.id;
  } else {
    revisionId = randomUUID();
    await insertConfigRevision(db,{ id: revisionId,organizationId: auth.organization.id,projectId: input.projectId,configSetId: manifest.configSetId,
      revisionNumber: await nextConfigRevisionNumber(db,manifest.configSetId),status: "resolved",attribution });
    await insertConfigRevisionMembers(db,revisionId,members);
  }
  await assertDeletedAnchorsRemainAbsent(db, {
    configSetId: manifest.configSetId,
    revisionId,
    manifest,
    baseFiles: base.files,
    candidateFileId: manifest.fileId,
    candidateAfter: after,
  });
  const observed = members.some((member) => member.format === "dts") ? await listObservedProperties(asValueClient(db),revisionId) : [];
  let targetDeleteNodeOccurrenceId: string | null = null;
  if (request.action === "delete" && manifest.format === "dts") {
    if (!manifest.logicalNodeId || manifest.locator.kind !== "dts-property"
      || typeof manifest.locator.propertyName !== "string") {
      throw new ApiError("VALIDATION_FAILED", "Canonical property deletion requires an exact DTS property pin.");
    }
    const deleted = await loadFinalDtsDeleteProof(db, {
      configRevisionId: revisionId,
      logicalNodeId: manifest.logicalNodeId,
      fileVersionId: version.id,
      propertyName: manifest.locator.propertyName,
    });
    targetDeleteNodeOccurrenceId = deleted.node_occurrence_id;
  }
  const preparedValues = [];
  for (const entry of cohort) {
    const stored = await loadBindingById(asValueClient(db),entry.bindingId,"none");
    const old = await loadProjectValueById(asValueClient(db),entry.oldValueId);
    if (!stored || !old || stored.catalog_release_id !== snapshot.release.id) conflict("Binding release is stale or unavailable.");
    const registration = await readSourceRegistrationAgreement(db,{ organizationId: auth.organization.id,subjectId: stored.subject_id });
    if (registration?.id !== stored.registration_id) conflict("Binding registration is no longer active.");
    const revision = snapshot.getDefinitionRevision({ definitionId: ParameterDefinitionId(stored.definition_id),revisionId: DefinitionRevisionId(stored.effective_revision_id) });
    if (revision.status !== "found") conflict("Binding Definition revision is unavailable.");
    // ponytail: bounded owner reads per sibling; cache verified immutable objects if large cohorts make this costly.
    const sibling = await loadCanonicalSourceSnapshot(db,storage,{ organizationId: auth.organization.id,projectId: input.projectId,bindingId: entry.bindingId,projectValueId: entry.oldValueId });
    const pin = sibling.manifest;
    if (pin.configRevisionId !== manifest.configRevisionId) conflict("Source cohort spans different historical revisions.");
    if (pin.members.length !== manifest.members.length || pin.members.some((member) => !manifest.members.some((baseMember) => baseMember.fileId === member.fileId && baseMember.fileVersionId === member.fileVersionId
      && baseMember.sourceName === member.sourceName && baseMember.role === member.role && baseMember.sortOrder === member.sortOrder && baseMember.format === member.format))) conflict("Sibling source provenance is stale or unsupported.");
    const fileIndex = manifest.members.findIndex((member) => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId);
    if (fileIndex < 0) conflict("Sibling source is outside the prepared member set.");
    const target = entry.bindingId === request.binding_id;
    let payload: ProjectValuePayload;
    let locator = pin.locator;
    if (target && request.action === "delete") {
      if (pin.format === "json") {
        if (pin.locator.kind !== "json-pointer" || typeof pin.locator.pointer !== "string" || pin.rootPointer === null) conflict("JSON deletion target has no exact base member pin.");
        const deletion = deleteJsonSourceMember(base.files[fileIndex]!.content, pin.locator.pointer, pin.rootPointer);
        payload = { kind: "json",value: readJsonSourceValue(base.files[fileIndex]!.content,pin.locator.pointer,pin.rootPointer) as ContractJsonValue };
        const { rootPointer, pointer, parentPointer, memberKey } = deletion.proof;
        locator = { kind: "json-delete", rootPointer, pointer, parentPointer, memberKey, fileVersionId: version.id };
      } else {
        if (!pin.logicalNodeId || pin.locator.kind !== "dts-property" || typeof pin.locator.propertyName !== "string") conflict("DTS deletion target has no exact base property pin.");
        const baseValue = await validatePinnedDtsSourceChange(db, pin, base.files[fileIndex]!.content, base.files[fileIndex]!.content);
        payload = dtsValueToPayload(baseValue);
        locator = { kind: "dts-delete", nodeOccurrenceId: targetDeleteNodeOccurrenceId!, fileVersionId: version.id, propertyName: pin.locator.propertyName };
      }
    } else if (pin.format === "json") {
      if (pin.rootPointer === null || pin.locator.kind !== "json-pointer" || typeof pin.locator.pointer !== "string") conflict("JSON parameter locator is invalid.");
      payload = { kind: "json",value: readJsonSourceValue(pin.fileId === manifest.fileId ? bytes : base.files[fileIndex]!.content,pin.locator.pointer,pin.rootPointer) as ContractJsonValue };
    } else {
      if (pin.locator.kind !== "dts-property" || !pin.logicalNodeId || typeof pin.locator.propertyName !== "string") conflict("DTS parameter locator is invalid.");
      const matches = observed.filter((property) => property.logicalNodeId === pin.logicalNodeId && property.fileId === pin.fileId && property.propertyKey === pin.locator.propertyName);
      if (matches.length !== 1) conflict("DTS parameter disappeared or has ambiguous source ownership.");
      const property = matches[0]!;
      payload = rawTextToPayload(property.propertyKey,property.rawText);
      locator = { kind: "dts-property",propertyOccurrenceId: property.propertyOccurrenceId,nodeOccurrenceId: property.nodeOccurrenceId,
        fileVersionId: property.fileVersionId,propertyName: property.propertyKey };
    }
    if (target && request.action === "delete") {
      const expected = pin.format === "json"
        ? { kind: "json", value: readJsonSourceValue(base.files[fileIndex]!.content, pin.locator.pointer as string, pin.rootPointer as string) }
        : dtsValueToPayload(await validatePinnedDtsSourceChange(db, pin, base.files[fileIndex]!.content, base.files[fileIndex]!.content));
      if (!same(expected, payload)) conflict("Prepared deletion target disagrees with its immutable base value.");
    } else if (target) {
      const desired = request.target_value as { kind?: string; value?: unknown };
      const expected = pin.format === "json" && desired?.kind === "json-source" ? { kind: "json",value: desired.value }
        : pin.format === "dts" && desired?.kind !== "json-source" ? dtsValueToPayload(request.target_value as DtsValue) : null;
      if (!expected || !same(expected,payload)) conflict("Prepared source target disagrees with the reviewed typed value.");
    } else if (old.value_kind !== payload.kind || !same(old.value,payload.value)) conflict("Source patch unexpectedly changes a sibling business value.");
    preparedValues.push({ entry,stored,old,pin,payload,locator,target,fileIndex });
  }
  const auditRef = randomUUID();
  const results = [];
  for (const item of preparedValues) {
    const { entry,stored,old,pin,payload,locator,target,fileIndex } = item;
    const appended = await appendProjectValue(asValueClient(db),{
      snapshot,binding: { id: ParameterBindingId(stored.id),organizationId: stored.organization_id,projectId: stored.project_id,logicalNodeId: stored.logical_node_id,
        sourceOccurrenceId: stored.source_occurrence_id,registrationId: SubjectRegistrationId(stored.registration_id),subjectId: CatalogSubjectId(stored.subject_id),
        definitionId: ParameterDefinitionId(stored.definition_id),effectiveRevisionId: DefinitionRevisionId(stored.effective_revision_id),catalogRelease: snapshot.release,currentValueId: ProjectValueId(stored.current_value_id) },
      definitionRevisionId: DefinitionRevisionId(stored.effective_revision_id),expectedTip: ProjectValueId(entry.oldValueId),
      source: { sourceRef: old.source_ref,configRevisionId: revisionId },payload, valueState: target && request.action === "delete" ? "deleted" : "present",
      sourceCommit: { requestId: request.id,auditRef,derived: !target },
    });
    if (!appended.ok) conflict(`Canonical source append refused: ${appended.error.kind}`);
    const valueId = appended.value.currentTip;
    const pinId = randomUUID();
    const fileVersionId = pin.fileId === manifest.fileId ? version.id : pin.fileVersionId;
    const deleted = target && request.action === "delete";
    const locatorDigest = deleted && pin.format === "dts"
      ? ((await db.query<{ digest: string }>(`select parameter_catalog.canonical_dts_delete_locator_digest($1::jsonb) as digest`, [JSON.stringify(locator)])).rows[0]?.digest ?? `sha256:${digest(serializeContract(locator))}`)
      : `sha256:${digest(serializeContract(locator))}`;
    const baseMember = manifest.members.find((member) => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId);
    if (deleted && !baseMember) conflict("Deleted source pin is outside the immutable member manifest.");
    const deleteProof = deleted ? pin.format === "dts"
      ? { kind: "dts-delete-v1", scannerVersion: "dts-cst-v1", nodeOccurrenceId: String(locator.nodeOccurrenceId), propertyName: String(locator.propertyName), beforeValueDigest: sourceDigest(old.value_digest), beforeSourceDigest: sourceDigest(baseMember!.checksum), afterSourceDigest: sourceDigest(candidate.checksum) }
      : { kind: "json-delete-v1", scannerVersion: "json-span-v1", rootPointer: String(locator.rootPointer), pointer: String(locator.pointer), parentPointer: String(locator.parentPointer), memberKey: String(locator.memberKey), beforeValueDigest: sourceDigest(old.value_digest), beforeSourceDigest: sourceDigest(baseMember!.checksum), afterSourceDigest: sourceDigest(candidate.checksum) }
      : null;
    await db.query(`insert into parameter_catalog.project_value_source_pins
      (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,locator,locator_digest,property_occurrence_id,value_state,base_source_pin_id,delete_request_id,delete_proof)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18::jsonb)`,
    [pinId,valueId,entry.bindingId,entry.definitionId,auth.organization.id,input.projectId,entry.sourceOccurrenceId,revisionId,pin.fileId,fileVersionId,pin.format,JSON.stringify(locator),locatorDigest,pin.format === "dts" && !deleted ? locator.propertyOccurrenceId : null,
      deleted ? "deleted" : "present", deleted ? pin.sourcePinId : null, deleted ? request.id : null,
      deleted ? JSON.stringify(deleteProof) : null]);
    results.push({ ordinal: results.length,bindingId: entry.bindingId,oldValueId: entry.oldValueId,newValueId: valueId,sourcePinId: pinId,configRevisionId: revisionId,fileVersionId,
      historyEventId: deriveHistoryEventId({ bindingId: entry.bindingId,oldCurrentValueId: entry.oldValueId,newCurrentValueId: valueId }),kind: target ? "target" : "sibling-derived",action: deleted ? "delete" : "set",valueState: deleted ? "deleted" : "present" });
  }
  const moved = await db.query(`update project_parameter_files set current_version_id=$2,updated_at=now() where id=$1 and current_version_id=$3`, [manifest.fileId,version.id,manifest.fileVersionId]);
  if (moved.rowCount !== 1) conflict("Current source file lost its compare-and-swap.");
  const result = { bindings: results };
  const target = results.find((entry) => entry.kind === "target");
  if (!target) conflict("Source result has no target Binding.");
  await writeTrustedAuditEventInTx(asAuditTx(db),{ id: auditRef,invocation,app: "parameters",kind: "parameter-topology-governance",action: "value-change-applied",severity: "Medium",
    projectId: input.projectId,targetType: "project-parameter-value-change-request",targetId: request.id,
    metadata: { requestId: request.id,targetBindingId: request.binding_id,configRevisionId: revisionId,bindingCount: results.length,
      cohortDigest: digest(serializeContract(cohort)),resultDigest: digest(serializeContract(result)),result },traceId: input.traceId });
  await db.query(`update project_parameter_file_candidates set status='active',activated_at=now(),activated_by_user_id=$2,activated_version_id=$3 where id=$1`, [candidate.id,auth.user.id,version.id]);
  const applied = await db.query<SourceRequest>(`update project_parameter_value_change_requests set status='approved',reviewer_user_id=$2,reviewer_note=$3,
    applied_value_id=$4,apply_outcome='committed',applied_at=now(),updated_at=now(),applied_history_event_id=$5,applied_audit_ref=$6,
    applied_file_version_ids=$7::jsonb,applied_source_result=$8::jsonb where id=$1 and status='pending' returning *`,
  [request.id,auth.user.id,input.note ?? null,target.newValueId,target.historyEventId,auditRef,JSON.stringify([...new Set(results.map((entry) => entry.fileVersionId))]),JSON.stringify(result)]);
  if (applied.rows.length !== 1) conflict("Source request lost its pending transition.");
  const hydrated = await readRequest();
  if (!hydrated) conflict("Applied source request disappeared.");
  return hydrated;
  } catch (error) { rethrowSourceTransactionError(error); }
}
