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
import { assertPinnedCanonicalSensitiveNodeWriteAllowed, lockCanonicalSourceCohort, loadCanonicalSourceCohort, loadCanonicalSourceSnapshot, requireCanonicalUserInvocation, recordCanonicalPermissionRefusal, validatePinnedDtsSourceChange, type CanonicalSourceBindingPin, type CanonicalSourceSecurityContext } from "./canonicalSource";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, readJsonSourceValue } from "./jsonSource";
import { insertFileVersion } from "./repository";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import { asValueClient, dtsValueToPayload, listObservedProperties, rawTextToPayload } from "../parameter-bindings/catalogProjectValueSync";
import { appendProjectValue, loadOwnedProjectValueSourcePin, type ProjectValuePayload } from "../parameter-bindings/values";
import { rethrowSourceTransactionError } from "./sourceVersion";
import { deriveHistoryEventId, loadBindingById, loadProjectValueById } from "../parameter-bindings/values/repositories";
import { CatalogSubjectId, DefinitionRevisionId, ParameterBindingId, ParameterDefinitionId, ProjectValueId, SubjectRegistrationId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import type { ParsedIndex } from "./types";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import type { DtsValue } from "../dts/types";

type SourceRequest = CanonicalValueChangeRequestRow & {
  source_pin_id: string; candidate_id: string; candidate_base_digest: string; candidate_proposed_digest: string;
  candidate_diff_digest: string; candidate_member_manifest: unknown; candidate_binding_manifest: CanonicalSourceBindingPin[];
};
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const same = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function conflict(message: string): never { throw new ApiError("CONFLICT", message); }

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
  if (initial.status === "approved") return initial;
  if (initial.status !== "pending" || initial.action !== "set" || !initial.source_pin_id || !initial.candidate_id) conflict("A pending prepared source request is required.");
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
  if (request.status === "approved") return request;
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
  if (manifest.format === "json") parseJsonSource(bytes);
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
  const observed = members.some((member) => member.format === "dts") ? await listObservedProperties(asValueClient(db),revisionId) : [];
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
    let payload: ProjectValuePayload;
    let locator = pin.locator;
    if (pin.format === "json") {
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
    const target = entry.bindingId === request.binding_id;
    if (target) {
      const desired = request.target_value as { kind?: string; value?: unknown };
      const expected = pin.format === "json" && desired?.kind === "json-source" ? { kind: "json",value: desired.value }
        : pin.format === "dts" && desired?.kind !== "json-source" ? dtsValueToPayload(request.target_value as DtsValue) : null;
      if (!expected || !same(expected,payload)) conflict("Prepared source target disagrees with the reviewed typed value.");
    } else if (old.value_kind !== payload.kind || !same(old.value,payload.value)) conflict("Source patch unexpectedly changes a sibling business value.");
    preparedValues.push({ entry,stored,old,pin,payload,locator,target });
  }
  const auditRef = randomUUID();
  const results = [];
  for (const item of preparedValues) {
    const { entry,stored,old,pin,payload,locator,target } = item;
    const appended = await appendProjectValue(asValueClient(db),{
      snapshot,binding: { id: ParameterBindingId(stored.id),organizationId: stored.organization_id,projectId: stored.project_id,logicalNodeId: stored.logical_node_id,
        sourceOccurrenceId: stored.source_occurrence_id,registrationId: SubjectRegistrationId(stored.registration_id),subjectId: CatalogSubjectId(stored.subject_id),
        definitionId: ParameterDefinitionId(stored.definition_id),effectiveRevisionId: DefinitionRevisionId(stored.effective_revision_id),catalogRelease: snapshot.release,currentValueId: ProjectValueId(stored.current_value_id) },
      definitionRevisionId: DefinitionRevisionId(stored.effective_revision_id),expectedTip: ProjectValueId(entry.oldValueId),
      source: { sourceRef: old.source_ref,configRevisionId: revisionId },payload,
      sourceCommit: { requestId: request.id,auditRef,derived: !target },
    });
    if (!appended.ok) conflict(`Canonical source append refused: ${appended.error.kind}`);
    const valueId = appended.value.currentTip;
    const pinId = randomUUID();
    const fileVersionId = pin.fileId === manifest.fileId ? version.id : pin.fileVersionId;
    await db.query(`insert into parameter_catalog.project_value_source_pins
      (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,format,locator,locator_digest,property_occurrence_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
    [pinId,valueId,entry.bindingId,entry.definitionId,auth.organization.id,input.projectId,entry.sourceOccurrenceId,revisionId,pin.fileId,fileVersionId,pin.format,JSON.stringify(locator),`sha256:${digest(serializeContract(locator))}`,pin.format === "dts" ? locator.propertyOccurrenceId : null]);
    results.push({ ordinal: results.length,bindingId: entry.bindingId,oldValueId: entry.oldValueId,newValueId: valueId,sourcePinId: pinId,configRevisionId: revisionId,fileVersionId,
      historyEventId: deriveHistoryEventId({ bindingId: entry.bindingId,oldCurrentValueId: entry.oldValueId,newCurrentValueId: valueId }),kind: target ? "target" : "sibling-derived" });
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
  return applied.rows[0]!;
  } catch (error) { rethrowSourceTransactionError(error); }
}
