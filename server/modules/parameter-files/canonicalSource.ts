import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { ObjectStore } from "../logs/objectStore";
import { MAX_PARAMETER_SOURCE_BYTES, deleteJsonSourceMember, parseJsonSource, patchJsonSource, proveJsonSourceMemberAbsent } from "./jsonSource";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationMatchesAuth, assertTrustedMutationInvocation, TrustedInvocationContextError, trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { canEditParameters } from "../parameter-kernel/policy";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { assertTrustedRefusalAuditSink, type TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { parseDts, parseDtsValue, renderDtsValue, type DtsDocument, type DtsPropertyCst } from "../dts";
import { resolveDtsConfigSet } from "../dts/configSetResolver";
import { ensureOverlayProperty } from "../parameter-topology/overlayWriteback";
import { insertParameterFileCandidate } from "./candidateRepository";
import { buildDtsParsedIndex, buildJsonParsedIndex } from "./parseIndex";
import { serializeContract, type ContractJsonValue } from "../parameter-catalog-contract/index";
import { loadExactSourceRevisionForProof, lockExactSourceRevisionsForProof, rethrowSourceTransactionError } from "./sourceVersion";
import { discoverCurrentSourceRevisionPins, discoverDeletedSourceRevisionPins, loadDeletedSourceAnchors, loadSourceBindingCohort, loadOwnedProjectValueSourcePin, isCurrentGovernedSourceValue,
  type CanonicalValueSourcePin, type CanonicalSourceBindingPin } from "../parameter-bindings/values";
import type { ConfigSetRole } from "./types";
export type { CanonicalSourceBindingPin } from "../parameter-bindings/values";

export type CanonicalSourceManifest = CanonicalValueSourcePin & {
  members: Array<{
    memberId: string; fileId: string; fileVersionId: string; sourceName: string;
    format: "dts" | "json"; role: string; sortOrder: number; checksum: string; sizeBytes: number;
  }>;
};

export type CanonicalSourceCurrentMember = {
  id: string;
  current_version_id: string | null;
  config_set_role: string | null;
  config_set_sort_order: number;
  format: string;
};

/** Map only the DTS revision include role to its persisted config-set role. */
export function canonicalSourceConfigSetRole(role: string): ConfigSetRole {
  if (role === "include") return "misc";
  if (role === "base" || role === "overlay" || role === "charging" || role === "thermal" || role === "misc") {
    return role;
  }
  throw new ApiError("CONFLICT", "Canonical source member has an unsupported role.", { role });
}

export function canonicalSourceMemberMatchesCurrentFile(
  member: Pick<CanonicalSourceManifest["members"][number], "fileId" | "fileVersionId" | "role" | "sortOrder" | "format">,
  current: CanonicalSourceCurrentMember,
): boolean {
  return member.fileId === current.id
    && member.fileVersionId === current.current_version_id
    && canonicalSourceConfigSetRole(member.role) === current.config_set_role
    && member.sortOrder === current.config_set_sort_order
    && member.format === current.format;
}

/** Fence the whole current cohort before any Binding lock or authoritative source read. */
export async function lockCanonicalSourceCohort(db: Queryable, source: CanonicalValueSourcePin) {
  const scope = { organizationId: source.organizationId,projectId: source.projectId,configSetId: source.configSetId };
  const before = await discoverCurrentSourceRevisionPins(db,scope);
  const deleted = await discoverDeletedSourceRevisionPins(db,scope);
  if (new Set(before.map((pin) => pin.configRevisionId)).size > 1) {
    throw new ApiError("CONFLICT", "Source cohort spans different historical revisions.", { reason: "mixed-source-revisions" });
  }
  if (before.some((pin) => pin.configRevisionId !== source.configRevisionId)) {
    throw new ApiError("CONFLICT", "Source request base value is stale.", { reason: "stale-base-value" });
  }
  await lockExactSourceRevisionsForProof(db,[source,...before,...deleted]);
  if (JSON.stringify(await discoverCurrentSourceRevisionPins(db,scope)) !== JSON.stringify(before)
    || JSON.stringify(await discoverDeletedSourceRevisionPins(db,scope)) !== JSON.stringify(deleted)) {
    throw new ApiError("CONFLICT", "Source cohort changed during lock acquisition.", { reason: "source-proof-busy" });
  }
}

export type CanonicalSourceSecurityContext = {
  invocation: TrustedInvocationContext;
  requestId: string;
  refusalSink: TrustedRefusalAuditSink;
};

/** Validate the private invocation/refusal seam before any canonical-source read or write. */
export async function requireCanonicalUserInvocation(
  auth: AuthContext,
  context: CanonicalSourceSecurityContext,
  input: { projectId: string; operation: string; targetType: string; targetId: string }
): Promise<TrustedInvocationContext> {
  if (!context.requestId.trim()) {
    throw new TrustedInvocationContextError(`${input.operation} requires a non-empty requestId`);
  }
  assertTrustedRefusalAuditSink(context.refusalSink);
  const invocation = assertTrustedMutationInvocation(
    assertTrustedInvocationMatchesAuth(auth, context.invocation, input.operation),
    input.operation,
  );
  if (invocation.initiator === "user") return invocation;
  await context.refusalSink.write({
    invocation,
    ...(invocation.initiator === "system" ? { organizationId: auth.organization.id } : {}),
    projectId: input.projectId,
    app: "parameter-management",
    kind: "parameter-source-user-required",
    action: "deny",
    severity: "High",
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: {
      code: "parameter-source-user-required",
      operation: input.operation,
      initiator: invocation.initiator,
      requireHuman: true
    },
    traceId: context.requestId.trim()
  });
  throw new ApiError("FORBIDDEN", "Canonical source changes require a user-initiated invocation.", {
    code: "parameter-source-user-required",
    initiator: invocation.initiator,
    requireHuman: true
  });
}

/** Durable audit for user permission refusals, including guards reached in a transaction. */
export async function recordCanonicalPermissionRefusal(
  context: CanonicalSourceSecurityContext,
  input: { projectId: string; operation: string; targetType: string; targetId: string; details?: Record<string, unknown> }
) {
  assertTrustedRefusalAuditSink(context.refusalSink);
  await context.refusalSink.write({
    invocation: context.invocation,
    projectId: input.projectId,
    app: "parameter-management",
    kind: "parameter-source-permission-denied",
    action: "deny",
    severity: "High",
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: {
      code: "parameter-source-permission-denied",
      operation: input.operation,
      ...input.details
    },
    traceId: context.requestId.trim()
  });
}

/** The caller holds config-set/member locks before locking this complete cohort. */
export async function loadCanonicalSourceCohort(db: Queryable, input: { organizationId: string; projectId: string; configSetId: string }) {
  const rows = await loadSourceBindingCohort(db,input);
  if (rows.some((row) => !row.sourcePinId || !row.locator || !row.valueDigest)) throw new ApiError("CONFLICT", "Source cohort contains an unpinned Binding.");
  return rows;
}

/** Owner-side read: IDs select immutable provenance, never source_ref or current file tips. */
export async function loadCanonicalSourceSnapshot(
  db: Queryable,
  objectStore: ObjectStore,
  input: { organizationId: string; projectId: string; bindingId: string; projectValueId: string },
) {
  const pin = await loadOwnedProjectValueSourcePin(db,input);
  if (!pin) throw new ApiError("CONFLICT", "Project value is missing an exact owned source pin.");
  const source = await loadExactSourceRevisionForProof(db, objectStore, pin);
  const files: Array<{ name: string; format: "dts" | "json"; versionNumber: number; content: string }> = [];
  const manifest: CanonicalSourceManifest = { ...pin, members: [] };
  for (const member of source.members) {
    if (member.format === "json") parseJsonSource(member.bytes);
    files.push({ name: member.sourceName, format: member.format, versionNumber: member.versionNumber, content: member.content });
    const { id, fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes } = member;
    manifest.members.push({ memberId: id, fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes });
  }
  return { manifest, files };
}

function dtsProperties(document: DtsDocument): DtsPropertyCst[] {
  const properties: DtsPropertyCst[] = [];
  const visit = (nodes: DtsDocument["topLevel"]) => {
    for (const node of nodes) for (const child of node.children) {
      if (child.kind === "property") properties.push(child);
      else if (child.kind === "node") visit([child]);
    }
  };
  visit(document.topLevel);
  return properties;
}

function dtsNonTargetShape(document: DtsDocument, targetIndex: number): string {
  let index = 0;
  return JSON.stringify({ directives: document.directives, nodes: document.topLevel }, (key, value) => {
    if (key === "span") return undefined;
    if (value?.kind === "property" && index++ === targetIndex) {
      return { ...value, rawText: null, normalizedValue: null, value: null, valueType: null };
    }
    return value;
  });
}

/** Prepare-time proof for terminal deleted anchors; ingest repeats the exact effect check. */
async function assertPreparedDeletedAnchorsRemainAbsent(
  db: Queryable,
  input: { manifest: CanonicalSourceManifest; files: Array<{ content: string }>; candidateFileId: string; candidateAfter: string },
) {
  const deleted = await loadDeletedSourceAnchors(db,input.manifest);
  const members = input.manifest.members;
  const resolved = deleted.some((anchor) => anchor.format === "dts") ? resolveDtsConfigSet({
    entryFile: input.manifest.entryFile!, includeSearchPaths: input.manifest.includeSearchPaths,
    overlayOrder: input.manifest.overlayOrder, requireExactOrigins: true,
    files: new Map(members.flatMap((member, index) => member.format === "dts" ? [[member.sourceName, {
      fileVersionId: member.fileVersionId,
      content: member.fileId === input.candidateFileId ? input.candidateAfter : input.files[index]!.content,
    }] as const] : [])),
  }) : null;
  if (resolved?.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new ApiError("CONFLICT", "Deleted DTS anchors require an exactly resolved source manifest.");
  }
  for (const anchor of deleted) {
    const member = members.find((entry) => entry.fileId === anchor.fileId);
    if (!member) throw new ApiError("CONFLICT", "Deleted source anchor is outside the prepared member set.");
    const index = members.indexOf(member);
    const content = anchor.fileId === input.candidateFileId ? input.candidateAfter : input.files[index]!.content;
    if (anchor.format === "json") {
      if (anchor.locator.kind !== "json-delete" || typeof anchor.locator.pointer !== "string" || typeof anchor.locator.rootPointer !== "string") {
        throw new ApiError("CONFLICT", "Deleted JSON anchor has no exact absence proof.");
      }
      proveJsonSourceMemberAbsent(content,anchor.locator.pointer,anchor.locator.rootPointer);
      continue;
    }
    if (anchor.locator.kind !== "dts-delete" || typeof anchor.locator.propertyName !== "string" || !anchor.nodeLocator) {
      throw new ApiError("CONFLICT", "Deleted DTS anchor has no exact absence proof.");
    }
    const node = resolved?.effective.nodesByLocator.get(anchor.nodeLocator);
    const property = node?.properties.get(anchor.locator.propertyName);
    const last = property?.sourceChain.at(-1);
    if (!node || node.deleted || !property?.deleted || last?.effect !== "delete" || last.fileName !== member.sourceName) {
      throw new ApiError("CONFLICT", "Deleted DTS anchor is not retained at its exact node and source file.");
    }
  }
}

export async function loadPinnedDtsProperty(db: Queryable, manifest: CanonicalSourceManifest) {
  const property = await db.query<{ start_offset: number; end_offset: number; raw_text: string; property_name: string; node_locator: string; compatible: string | null }>(
    `select property.start_offset,property.end_offset,property.raw_text,property.property_name,coalesce(nullif(node.ref_target,''),node.node_path) as node_locator,logical.compatible
     from dts_property_occurrences property join dts_node_occurrences node on node.id=property.node_occurrence_id
     join dts_occurrence_effects effect on effect.property_occurrence_id=property.id
       and effect.node_occurrence_id=node.id and effect.config_revision_id=property.config_revision_id
     join dts_logical_node_revisions logical on logical.id=effect.logical_node_revision_id
       and logical.config_revision_id=property.config_revision_id and logical.logical_node_id=$5
     where property.id=$1 and property.config_revision_id=$2 and property.file_version_id=$3
       and node.id=$4 and node.config_revision_id=property.config_revision_id and node.file_version_id=property.file_version_id
       and property.property_name=$6 and effect.property_name=property.property_name and effect.effect_kind in ('set','override')
       and not exists (select 1 from dts_occurrence_effects later where later.config_revision_id=effect.config_revision_id
         and later.logical_node_revision_id=effect.logical_node_revision_id and later.property_name=effect.property_name
         and later.source_order>effect.source_order)`,
    [manifest.locator.propertyOccurrenceId, manifest.configRevisionId, manifest.fileVersionId, manifest.locator.nodeOccurrenceId, manifest.logicalNodeId, manifest.locator.propertyName],
  );
  if (property.rows.length !== 1) throw new ApiError("CONFLICT", "DTS property pin is missing.");
  return property.rows[0]!;
}

/** Exact DTS pin guard shared by prepare, approval and direct owner callers. */
export async function assertPinnedCanonicalSensitiveNodeWriteAllowed(
  db: Queryable,
  auth: AuthContext,
  manifest: CanonicalSourceManifest,
  context: CanonicalSourceSecurityContext,
) {
  if (manifest.format !== "dts") return;
  const row = await loadPinnedDtsProperty(db, manifest);
  try {
    await assertTrustedSensitiveNodeWriteAllowed(db, auth, {
      organizationId: manifest.organizationId,
      projectId: manifest.projectId,
      nodePath: row.node_locator,
      sourcePath: { kind: "node-locator", value: row.node_locator },
      compatible: row.compatible,
      compatibleIsAuthoritative: true,
      invocation: context.invocation,
      requestId: context.requestId,
      refusalSink: context.refusalSink
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "FORBIDDEN" && context.invocation.initiator === "user") {
      await recordCanonicalPermissionRefusal(context, {
        projectId: manifest.projectId,
        operation: "parameter-sensitive-node-write",
        targetType: "sensitive-node",
        targetId: manifest.sourcePinId,
        details: { ...error.details, nodePath: row.node_locator }
      });
    }
    throw error;
  }
}

/** Return the exact target token after proving every non-target DTS semantic is unchanged. */
export async function readPinnedDtsSourceChange(
  db: Queryable,
  manifest: CanonicalSourceManifest,
  beforeText: string,
  afterText: string,
) {
  const row = await loadPinnedDtsProperty(db, manifest);
  const before = parseDts(beforeText);
  const properties = dtsProperties(before);
  const targetIndex = properties.findIndex((entry) => entry.name === row.property_name && entry.span.start === row.start_offset && entry.span.end === row.end_offset);
  if (targetIndex < 0 || properties[targetIndex]!.rawText !== row.raw_text) throw new ApiError("CONFLICT", "DTS property span is stale.");
  const after = parseDts(afterText);
  const target = dtsProperties(after)[targetIndex];
  if (!target || dtsNonTargetShape(before, targetIndex) !== dtsNonTargetShape(after, targetIndex)) {
    throw new ApiError("CONFLICT", "DTS patch changed non-target semantics.");
  }
  return { rawText: target.rawText, value: parseDtsValue(target.name, target.rawText).value };
}

/** Repeat the immutable-base patch proof at preparation and at actual apply. */
export async function validatePinnedDtsSourceChange(db: Queryable, manifest: CanonicalSourceManifest, beforeText: string, afterText: string) {
  return (await readPinnedDtsSourceChange(db, manifest, beforeText, afterText)).value;
}

/** Reproduce the exact pinned-span removal, preserving all non-target bytes. */
export async function validatePinnedDtsSourceDeletion(db: Queryable, manifest: CanonicalSourceManifest, beforeText: string, afterText: string) {
  const row = await loadPinnedDtsProperty(db, manifest);
  const before = parseDts(beforeText);
  const properties = dtsProperties(before);
  const targetIndex = properties.findIndex((entry) => entry.name === row.property_name && entry.span.start === row.start_offset && entry.span.end === row.end_offset);
  if (targetIndex < 0 || properties[targetIndex]!.rawText !== row.raw_text) throw new ApiError("CONFLICT", "DTS property span is stale.");
  const expected = ensureOverlayProperty(beforeText, {
    propertyKey: row.property_name, rawText: "", action: "delete", targetRef: row.node_locator,
    expectedChecksum: createHash("sha256").update(beforeText).digest("hex"),
    occurrenceSpan: { start: row.start_offset, end: row.end_offset },
  });
  if (afterText !== expected) throw new ApiError("CONFLICT", "DTS deletion changed bytes outside its exact pinned property.");
  parseDts(afterText);
}

/** Prepare only. The caller owns the audited transaction; no current pointer moves. */
export async function preparePinnedSourceChange(
  db: Queryable,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    projectId: string; bindingId: string; expectedValueId: string;
    target: { format: "dts" | "json"; sourceText: string };
    action?: "set" | "delete";
    invocation: TrustedInvocationContext; requestId: string; refusalSink: TrustedRefusalAuditSink;
  },
) {
  try {
  const security = { invocation: input.invocation, requestId: input.requestId, refusalSink: input.refusalSink } satisfies CanonicalSourceSecurityContext;
  const invocation = await requireCanonicalUserInvocation(auth, security, {
    projectId: input.projectId, operation: "canonical source prepare", targetType: "project-parameter-binding", targetId: input.bindingId
  });
  if (!canEditParameters(auth, input.projectId)) {
    await recordCanonicalPermissionRefusal(security, {
      projectId: input.projectId, operation: "canonical source prepare", targetType: "project-parameter-binding", targetId: input.bindingId,
      details: { permission: "parameter:edit" }
    });
    throw new ApiError("FORBIDDEN", "Project parameter editor authorization is required.");
  }
  const action = input.action ?? "set";
  if (!input.requestId.trim() || Buffer.byteLength(input.target.sourceText) > MAX_PARAMETER_SOURCE_BYTES) {
    throw new ApiError("VALIDATION_FAILED", "A bounded source target and request identity are required.");
  }
  if (!await isCurrentGovernedSourceValue(db,{ organizationId: auth.organization.id,projectId: input.projectId,
    bindingId: input.bindingId,projectValueId: input.expectedValueId })) throw new ApiError("CONFLICT", "Canonical source base is stale or unavailable.");
  const sourceIdentity = await loadOwnedProjectValueSourcePin(db,{ organizationId: auth.organization.id,projectId: input.projectId,
    bindingId: input.bindingId,projectValueId: input.expectedValueId });
  if (!sourceIdentity) throw new ApiError("CONFLICT", "Source value has no exact owned pin.");
  await lockCanonicalSourceCohort(db,sourceIdentity);
  const { manifest, files } = await loadCanonicalSourceSnapshot(db, objectStore, {
    organizationId: auth.organization.id, projectId: input.projectId, bindingId: input.bindingId, projectValueId: input.expectedValueId,
  });
  if (manifest.format !== input.target.format) throw new ApiError("VALIDATION_FAILED", "Source target format disagrees with its pin.");
  await assertPinnedCanonicalSensitiveNodeWriteAllowed(db, auth, manifest, security);
  const currentMembers = await db.query<CanonicalSourceCurrentMember>(
    `select id,current_version_id,config_set_role,config_set_sort_order,format from project_parameter_files where config_set_id=$1 order by id for update nowait`, [manifest.configSetId],
  );
  if (currentMembers.rows.length !== manifest.members.length || currentMembers.rows.some((current) =>
    !manifest.members.some((member) => canonicalSourceMemberMatchesCurrentFile(member, current)))) {
    throw new ApiError("CONFLICT", "Configuration membership or file versions changed; prepare from the current source.");
  }
  const bindings = await loadCanonicalSourceCohort(db, { organizationId: auth.organization.id, projectId: input.projectId, configSetId: manifest.configSetId });
  if (!bindings.some((entry) => entry.bindingId === input.bindingId && entry.oldValueId === input.expectedValueId && entry.sourcePinId === manifest.sourcePinId)) {
    throw new ApiError("CONFLICT", "Source cohort changed during preparation.");
  }
  const sourceIndex = manifest.members.findIndex((member) => member.fileId === manifest.fileId && member.fileVersionId === manifest.fileVersionId);
  const source = files[sourceIndex]!;
  const base = Buffer.from(source.content);
  let patched: Buffer;
  if (manifest.format === "json") {
    if (manifest.locator.kind !== "json-pointer" || typeof manifest.locator.pointer !== "string" || manifest.rootPointer === null) {
      throw new ApiError("CONFLICT", "JSON source locator is invalid.");
    }
    patched = action === "delete"
      ? deleteJsonSourceMember(base, manifest.locator.pointer, manifest.rootPointer).bytes
      : patchJsonSource(base, manifest.locator.pointer, input.target.sourceText, manifest.rootPointer);
  } else {
    const row = await loadPinnedDtsProperty(db, manifest);
    const targetValue = action === "set" ? parseDtsValue(row.property_name, input.target.sourceText).value : null;
    const content = ensureOverlayProperty(source.content, {
      propertyKey: row.property_name, rawText: input.target.sourceText, action, targetRef: row.node_locator,
      expectedChecksum: manifest.members[sourceIndex]!.checksum.replace(/^sha256:/, ""),
      occurrenceSpan: { start: row.start_offset, end: row.end_offset },
    });
    if (action === "set" && renderDtsValue(await validatePinnedDtsSourceChange(db, manifest, source.content, content)) !== renderDtsValue(targetValue!)) {
      throw new ApiError("CONFLICT", "DTS patch changed non-target semantics or failed target readback.");
    }
    if (action === "delete") await validatePinnedDtsSourceDeletion(db, manifest, source.content, content);
    patched = Buffer.from(content);
  }
  await assertPreparedDeletedAnchorsRemainAbsent(db, {
    manifest,
    files,
    candidateFileId: manifest.fileId,
    candidateAfter: patched.toString(),
  });
  if (patched.length > MAX_PARAMETER_SOURCE_BYTES) throw new ApiError("VALIDATION_FAILED", "Patched source exceeds the size limit.");
  const parsedIndex = manifest.format === "json" ? buildJsonParsedIndex(patched) : buildDtsParsedIndex(patched.toString());
  const baseDigest = createHash("sha256").update(base).digest("hex");
  const proposedDigest = createHash("sha256").update(patched).digest("hex");
  const diff = { before: source.content, after: patched.toString(), sourcePinId: manifest.sourcePinId, bindings };
  const diffDigest = createHash("sha256").update(serializeContract(diff)).digest("hex");
  const stored = await objectStore.put({ organizationId: auth.organization.id, fileName: source.name, contentType: manifest.format === "json" ? "application/json" : "text/plain", bytes: patched });
  if (stored.checksumSha256 !== proposedDigest || stored.fileSizeBytes !== patched.length) throw new ApiError("CONFLICT", "Prepared object metadata disagrees with the source.");
  const candidate = await insertParameterFileCandidate(db, {
    id: randomUUID(), organizationId: auth.organization.id, projectId: input.projectId,
    fileId: manifest.fileId, fileName: source.name, format: manifest.format, status: "ready",
    baseVersionId: manifest.fileVersionId, storageKey: stored.storageKey, checksum: proposedDigest,
    sizeBytes: patched.length, parsedIndex, attribution: trustedDomainAttribution(invocation),
  });
  const members = manifest.members.map((member) => ({ ...member, configSetId: manifest.configSetId,isCandidateFile: member.fileId === manifest.fileId }))
    .sort((left,right) => left.fileId < right.fileId ? -1 : left.fileId > right.fileId ? 1 : 0);
  await db.query(`update project_parameter_file_candidates set base_digest=$2,proposed_digest=$3,diff_digest=$4,frozen_member_manifest=$5::jsonb,frozen_binding_manifest=$6::jsonb where id=$1`,
    [candidate.id, baseDigest, proposedDigest, diffDigest, JSON.stringify(members), JSON.stringify(bindings)]);
  await writeTrustedAuditEventInTx(asAuditTx(db), {
    invocation, app: "parameters", kind: "parameter-file-candidate-create", action: "create", severity: "Medium",
    projectId: input.projectId, targetType: "project-parameter-file-candidate", targetId: candidate.id,
    metadata: { bindingId: input.bindingId, sourcePinId: manifest.sourcePinId, baseDigest, proposedDigest, diffDigest }, traceId: input.requestId,
  });
  return { candidateId: candidate.id, sourcePinId: manifest.sourcePinId, baseDigest, proposedDigest, diffDigest, members, bindings, diff };
  } catch (error) { rethrowSourceTransactionError(error); }
}
