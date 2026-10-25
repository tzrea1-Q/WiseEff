import { parameterOrganizationId, parameterInvocation, withParameterAccess } from "../parameters/operatingScope";
import { canOperateInOrganization } from "../auth/policy";
import { createHash, randomUUID } from "node:crypto";

import { getRootPostgresPool, type Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { getAuthContext } from "../auth/repository";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { createCatalogKernel, PropertyKey, type CatalogSnapshot } from "../catalog-kernel/interface";
import { loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import { resolveDtsConfigSetAsync } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import { loadPublishedCatalog, rawTextToPayload, resolveObservedSubject, parseCompatibles,
  lockSourceCatalogGovernance, loadActiveOrganizationSourceRegistrations } from "../parameter-bindings/catalogProjectValueSync";
import { loadSourceBindingCohortReadOnly, loadOwnedProjectValueSourcePin,
  loadProjectBindingCatalogReleaseIds, readOwnedCurrentBinding, readOwnedProjectValueIdentity,
  hasSourceConfigurationDrafts } from "../parameter-bindings/values";
import type { ProjectValuePayload } from "../parameter-bindings/values";
import { assertCanonicalValueConstraints } from "../parameter-bindings/values/service";
import { CatalogReleaseId, CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage, canViewParameters } from "../parameter-kernel/policy";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { canonicalizeLogicalNodeCompatible } from "../parameter-topology/writeLock";
import { prepareReviewedSourceContinuity, type ReviewedSourceContinuity } from "../parameter-topology/ingestService";
import { isStructuralPropertyKey } from "../parameter-topology/parameterSurface";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { getParameterFileCandidateById } from "./candidateRepository";
import { createDtsToolchainRunner, type DtsToolchainRunner } from "./dtsToolchain";
import { loadFormerRootOverlayFiles } from "./configSetSnapshot";
import { MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, readJsonSourceValue } from "./jsonSource";
import { requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { matchingDeletedSourceAnchors, prepareSourceRestorations, sourceRestorationNodes, type SourceRestoration } from "./sourceRestoration";

export const sourceRevisionDigest = (input: string | Buffer | object) => createHash("sha256")
  .update(typeof input === "string" || Buffer.isBuffer(input) ? input : serializeContract(input as ContractJsonValue)).digest("hex");
export const sameSourceRevision = (left: unknown, right: unknown) => serializeContract(left as ContractJsonValue) === serializeContract(right as ContractJsonValue);
function conflict(message: string, reason = "source-revision-stale"): never { throw new ApiError("CONFLICT", message, { reason }); }

export type SourceRevisionMember = {
  memberId: string; fileId: string; fileVersionId: string; sourceName: string; format: "dts" | "json";
  role: string; sortOrder: number; checksum: string; sizeBytes: number;
};
export type SourceRevisionCohort = {
  bindingId: string; oldValueId: string; sourcePinId: string; sourceOccurrenceId: string;
  definitionId: string; effectiveRevisionId: string; catalogReleaseId: string; valueDigest: string;
  fileId: string; fileVersionId: string; logicalNodeId: string | null; propertyName: string; format?: "json";
  valueState: "present" | "deleted"; locator: Record<string, ContractJsonValue>;
};
export type SourceRevisionTarget = {
  bindingId: string; action: "set" | "delete"; payload: ProjectValuePayload;
  afterFileId: string; propertyName: string;
};
export type SourceRevisionNewProperty = {
  logicalNodeId: string; nodeLocator: string; propertyName: string; fileId: string;
  definitionId: string; definitionRevisionId: string; registrationId: string; subjectId: string;
  payload: ProjectValuePayload;
};
export type SourceRevisionProof = {
  kind: "source_revision"; organizationId: string; projectId: string; candidateId: string;
  fileId: string; configSetId: string; baseVersionId: string; baseConfigRevisionId: string;
  baseDigest: string; proposedDigest: string; members: SourceRevisionMember[];
  cohort: SourceRevisionCohort[]; continuity: ReviewedSourceContinuity;
  entryFile: string; includeSearchPaths: string[]; overlayOrder: string[];
  preprocessing?: import("../dts/cppSources").DtsPreprocessingReceipt;
  catalogRelease: { id: string; digest: string } | null;
  pinnedCatalogReleases: Array<{ id: string; digest: string }>;
  registrations: Array<{ id: string; subjectId: string }>;
  targets: SourceRevisionTarget[]; newProperties: SourceRevisionNewProperty[];
  restorations?: SourceRestoration[];
  proofDigest: string;
};
export type SourceRevisionDiagnostic = { severity: "error" | "warning"; code: string; message: string; file?: string; line?: number; column?: number };
export type SourceRevisionPreview = {
  kind: "source_revision"; format: "dts"; candidateId: string; fileId: string; configSetId: string;
  baseVersionId: string; configRevisionId: string; before: string; after: string;
  proofToken: string; baseDigest: string; proposedDigest: string; canSubmit: boolean; reason?: string;
  diagnostics: SourceRevisionDiagnostic[];
  impact: { parameterChanges: number; nodeAdditions: number; nodeRemovals: number; restoredParameters?: number };
  reviewers: Array<{ userId: string; name: string }>;
  request?: { id: string; status: "pending" | "approved" | "rejected" | "withdrawn"; kind: "source_revision" };
};

export async function isSourceRevisionReviewer(tx: Database, auth: AuthContext, projectId: string): Promise<boolean> {
  if (!await hasCurrentCanonicalReviewRole(tx, { organizationId: parameterOrganizationId(auth), projectId, userId: auth.user.id })) return false;
  // Role mutation uses the same user-row fence. Re-read every capability after
  // that fence; a remaining software role must not conceal a revoked admin role.
  const current = await getAuthContext(tx, auth.user.id);
  return current.organization.id === auth.organization.id && canAdminParameters(current) && canEditParameters(current, projectId)
    && canReviewParameters(current) && canReviewParameterStage(current, projectId, "software_review");
}

export async function loadSnapshot(db: Database, provided?: CatalogSnapshot): Promise<CatalogSnapshot | null> {
  if (provided) return provided;
  const pool = getRootPostgresPool(db);
  if (!pool) throw new ApiError("INTERNAL_ERROR", "Source inspection requires a root database or an explicit catalog snapshot.");
  return loadPublishedCatalog(pool);
}

/** Role updates take this same user fence; never authorize a commit from an old request context. */
function hasSourceAdministration(auth: AuthContext, projectId: string): boolean {
  return canAdminParameters(auth) && canEditParameters(auth,projectId)
    && auth.roles.some((role) => role.roleId === "admin" || role.roleId === "platform-admin");
}

export async function isCurrentSourceAdministrator(tx: Database, auth: AuthContext, projectId: string): Promise<boolean> {
  try {
    const current = await getAuthContext(tx,auth.user.id);
    return current.organization.id === auth.organization.id && canOperateInOrganization(current, parameterOrganizationId(auth)) && hasSourceAdministration(current,projectId);
  } catch (error) {
    if (error instanceof ApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return false;
    throw error;
  }
}

export async function requireCurrentSourceAdministrator(tx: Database, auth: AuthContext, projectId: string): Promise<AuthContext> {
  const user = (await tx.query<{ id: string }>(
    "select id from public.users where id=$1 and organization_id=$2 and is_active for no key update",
    [auth.user.id, auth.organization.id])).rows[0];
  if (!user) throw new ApiError("FORBIDDEN", "A current active file administrator is required.");
  const current = await getAuthContext(tx, auth.user.id);
  if (current.organization.id !== auth.organization.id || !canOperateInOrganization(current, parameterOrganizationId(auth)) || !hasSourceAdministration(current,projectId)) {
    throw new ApiError("FORBIDDEN", "Current file administration and project edit permission are required.");
  }
  const invocation = parameterInvocation(auth);
  return invocation ? withParameterAccess(current, invocation) : current;
}

export async function loadSourceRevisionCatalogSnapshots(db: Database, projectId: string,
  organizationId: string, current: CatalogSnapshot | null, includeRetained = true): Promise<ReadonlyMap<string, CatalogSnapshot>> {
  const snapshots = new Map<string, CatalogSnapshot>(current ? [[current.release.id, current]] : []);
  const releases = await loadProjectBindingCatalogReleaseIds(db, { organizationId, projectId,includeRetained });
  const pool = getRootPostgresPool(db);
  for (const releaseId of releases) {
    if (snapshots.has(releaseId)) continue;
    if (!pool) conflict("A pinned Catalog snapshot is unavailable.");
    const kernel = createCatalogKernel(pool);
    const pin = await kernel.resolveCatalogReleasePin(CatalogReleaseId(releaseId));
    if (!pin.ok) conflict("A Binding's historical Catalog release is unavailable.");
    const loaded = await kernel.loadPinnedCatalog(pin.value);
    if (!loaded.ok) conflict("A Binding's historical Catalog snapshot is unavailable.");
    snapshots.set(releaseId, loaded.value);
  }
  return snapshots;
}

export async function sourceRevisionReviewers(tx: Database, auth: AuthContext, projectId: string, excludedUserId: string | null = auth.user.id) {
  const candidates = (await tx.query<{ userId: string; name: string }>(
    `select distinct users.id as "userId",users.name from public.users
     join public.user_role_bindings role on role.user_id=users.id and role.organization_id=users.organization_id
     where users.organization_id=$1 and users.is_active and users.id is distinct from $2 and role.role_id in ('admin','platform-admin') order by users.id`,
    [parameterOrganizationId(auth), excludedUserId])).rows;
  const eligible = [];
  for (const candidate of candidates) {
    const current = await getAuthContext(tx, candidate.userId);
    if (await isSourceRevisionReviewer(tx, current, projectId)) eligible.push(candidate);
  }
  return eligible;
}

/** Exact config/file/current-value fences are shared by prepare, submit and apply. */
export async function inspectSourceRevision(tx: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; candidateId: string }, snapshot: CatalogSnapshot | null,
  options: { lock?: boolean; toolchain?: DtsToolchainRunner; snapshots?: ReadonlyMap<string, CatalogSnapshot> } = {}
): Promise<{ proof: SourceRevisionProof; before: string; after: string; diagnostics: SourceRevisionDiagnostic[];
  preprocessing?: import("../dts/cppSources").PreparedDtsSources }> {
  const candidate = await getParameterFileCandidateById(tx, { organizationId: parameterOrganizationId(auth), ...input });
  const context = candidate?.sourceRevisionContext;
  if (!candidate || !context || !candidate.fileId || candidate.format !== "dts") throw new ApiError("NOT_FOUND", "Whole-source candidate was not found.");
  if (candidate.status === "failed") throw new ApiError("VALIDATION_FAILED", "DTS source parsing failed.", { diagnostics: candidate.diagnostics });
  if (!["ready", "active"].includes(candidate.status) || !candidate.storageKey || !candidate.checksum
    || candidate.sizeBytes === undefined || !storage.getBounded) conflict("Whole-source candidate is incomplete.");
  if (options.lock) {
    const current = await lockSourceCatalogGovernance(tx, parameterOrganizationId(auth));
    if (snapshot ? current?.id !== snapshot.release.id || current.digest !== snapshot.release.digest : current) {
      conflict("The published Catalog advanced while preparing this source revision.");
    }
    await tx.query("select id from public.dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update nowait",
      [context.configSetId, parameterOrganizationId(auth), input.projectId]);
    await tx.query("select id from public.project_parameter_files where config_set_id=$1 and organization_id=$2 and project_id=$3 order by id for update nowait",
      [context.configSetId, parameterOrganizationId(auth), input.projectId]);
  }
  if (snapshot) snapshot = await loadOrganizationCatalogSnapshot(tx, parameterOrganizationId(auth), snapshot);
  const revision = (await tx.query<{ id: string; entry_file: string; include_search_paths: string[]; overlay_order: string[] }>(
    `select id,entry_file,include_search_paths,overlay_order from public.dts_config_revisions
     where config_set_id=$1 and organization_id=$2 and project_id=$3
       and status in ('resolved','validated','compiled','pending_approval') order by revision_number desc limit 1`,
    [context.configSetId, parameterOrganizationId(auth), input.projectId])).rows[0];
  if (!revision || revision.id !== context.baseConfigRevisionId || candidate.baseVersionId !== context.baseVersionId
    || !revision.entry_file) conflict("The source configuration advanced after editing started.");
  const rows = (await tx.query<SourceRevisionMember & { storageKey: string; currentVersionId: string; currentRole: string; currentOrder: number }>(
    `select member.id as "memberId",member.file_id as "fileId",member.file_version_id as "fileVersionId",
       member.source_name as "sourceName",file.format,member.role,member.sort_order as "sortOrder",
       version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey",
       file.current_version_id as "currentVersionId",file.config_set_role as "currentRole",file.config_set_sort_order as "currentOrder"
     from public.dts_config_revision_members member
     join public.project_parameter_files file on file.id=member.file_id
       and file.organization_id=$2 and file.project_id=$3 and file.config_set_id=$4
     join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=file.id
     where member.config_revision_id=$1 order by member.sort_order,member.id`,
    [revision.id, parameterOrganizationId(auth), input.projectId, context.configSetId])).rows;
  const currentCount = (await tx.query<{ count: number }>("select count(*)::int as count from public.project_parameter_files where config_set_id=$1 and organization_id=$2 and project_id=$3",
    [context.configSetId, parameterOrganizationId(auth), input.projectId])).rows[0]?.count;
  if (!rows.length || rows.length !== currentCount || rows.some((row) => !["dts", "json"].includes(row.format)
    || row.fileVersionId !== row.currentVersionId || !row.sourceName
    || (row.role === "include" ? "misc" : row.role) !== row.currentRole || row.sortOrder !== row.currentOrder)
    || !rows.some((row) => row.fileId === candidate.fileId && row.format === "dts" && row.fileVersionId === context.baseVersionId)) {
    conflict("Whole-source revision requires the exact current configuration members and an edited DTS file.");
  }
  const files = new Map<string, { content: string; fileVersionId: string }>();
  const memberContents = new Map<string, string>();
  let before = "";
  for (const member of rows) {
    const bytes = await storage.getBounded(member.storageKey, MAX_PARAMETER_SOURCE_BYTES);
    if (bytes.length !== member.sizeBytes || sourceRevisionDigest(bytes) !== member.checksum.replace(/^sha256:/, "")) conflict("Pinned source bytes failed integrity verification.");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    memberContents.set(member.fileId, content);
    if (member.format === "dts") files.set(member.sourceName, { content, fileVersionId: member.fileVersionId });
    else parseJsonSource(content);
    if (member.fileId === candidate.fileId) before = content;
  }
  const bytes = await storage.getBounded(candidate.storageKey, MAX_PARAMETER_SOURCE_BYTES);
  if (bytes.length !== candidate.sizeBytes || sourceRevisionDigest(bytes) !== candidate.checksum.replace(/^sha256:/, "")) conflict("Candidate source bytes failed integrity verification.");
  const after = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const changed = rows.find((row) => row.fileId === candidate.fileId)!;
  files.set(changed.sourceName, { content: after, fileVersionId: candidate.id });
  const resolved = await resolveDtsConfigSetAsync({ entryFile: revision.entry_file, includeSearchPaths: revision.include_search_paths,
    overlayOrder: revision.overlay_order, requireExactOrigins: true, files });
  const diagnostics: SourceRevisionDiagnostic[] = resolved.diagnostics.map((row) => ({
    severity: row.severity, code: row.code, message: row.message, file: row.fileName
  }));
  if (diagnostics.some((row) => row.severity === "error" || row.code.includes("dangling") || row.code.includes("unresolved"))) {
    throw new ApiError("VALIDATION_FAILED", "DTS configuration has unresolved source diagnostics.", { diagnostics });
  }
  const restorationScope = { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: context.configSetId };
  const anchors = await matchingDeletedSourceAnchors(tx, restorationScope, resolved.effective.nodesByLocator, rows);
  const toolchain = await (options.toolchain ?? createDtsToolchainRunner()).validate({
    entryFile: revision.entry_file, includeSearchPaths: revision.include_search_paths,
    overlayOrder: revision.overlay_order, files,
    formerRootOverlayFiles: await loadFormerRootOverlayFiles(tx, context.configSetId, rows, revision.overlay_order)
  }, { mode: "release" });
  diagnostics.push(...toolchain.diagnostics.map((row) => ({ ...row, code: row.code ?? "toolchain" })));
  if (!toolchain.ok || toolchain.mode !== "release") throw new ApiError("VALIDATION_FAILED", "The DTS toolchain did not validate this source revision.", {
    reason: toolchain.failureCode ?? "toolchain-not-validated", diagnostics
  });
  const continuity = await prepareReviewedSourceContinuity(tx, { organizationId: parameterOrganizationId(auth),
    projectId: input.projectId, configSetId: context.configSetId, baseConfigRevisionId: revision.id,
    effectiveNodes: resolved.effective.nodesByLocator, sourceDigest: sourceRevisionDigest(bytes),
    restorationNodes: sourceRestorationNodes(anchors) });
  const registrations = await loadActiveOrganizationSourceRegistrations(tx, { organizationId: parameterOrganizationId(auth) });
  const registered = new Map(registrations.map((row) => [row.subjectId, row.id]));
  const sourceProperties: SourceRevisionNewProperty[] = [];
  if (snapshot) for (const node of resolved.effective.nodesByLocator.values()) {
    if (node.deleted) continue;
    const compatible = node.properties.get("compatible");
    const subject = resolveObservedSubject(snapshot, { compatibles: parseCompatibles(compatible?.rawText ?? null), nodeName: node.name });
    if (!subject || !registered.has(subject.subjectId)) continue;
    const logical = continuity.nodes.find((row) => row.nodeLocator === node.nodeLocator)!;
    for (const [propertyName, property] of node.properties) {
      if (property.deleted || isStructuralPropertyKey(propertyName)) continue;
      const definition = snapshot.getDefinition({ subjectId: CatalogSubjectId(subject.subjectId), propertyKey: PropertyKey(propertyName) });
      if (definition.status !== "found") continue;
      const origin = property.sourceChain.at(-1);
      const member = rows.find((row) => row.sourceName === origin?.fileName);
      if (!member || !origin?.origin) conflict(`Property ${node.nodeLocator}/${propertyName} has no unambiguous source origin.`);
      const payload = rawTextToPayload(propertyName, property.rawText);
      sourceProperties.push({ logicalNodeId: logical.logicalNodeId, nodeLocator: node.nodeLocator,
        propertyName, fileId: member.fileId, definitionId: definition.definition.id,
        definitionRevisionId: definition.definition.selectedRevision.id, registrationId: registered.get(subject.subjectId)!,
        subjectId: subject.subjectId, payload });
    }
  }
  const cohort: SourceRevisionCohort[] = [];
  const targets: SourceRevisionTarget[] = [];
  const matchingSnapshots = new Map<string, CatalogSnapshot>(snapshot ? [[snapshot.release.id, snapshot]] : []);
  for (const entry of await loadSourceBindingCohortReadOnly(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: context.configSetId })) {
    const pin = await loadOwnedProjectValueSourcePin(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId,
      bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    const pinnedSnapshot = options.snapshots?.get(entry.catalogReleaseId) ?? (snapshot?.release.id === entry.catalogReleaseId ? snapshot : null);
    if (!pinnedSnapshot || !pin || pin.valueState !== "present" || pin.configRevisionId !== revision.id
      || !rows.some(member => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId && member.format === pin.format)) {
      conflict("A current source Binding has stale or unsupported provenance.");
    }
    const currentBinding = await readOwnedCurrentBinding(tx, { organizationId: parameterOrganizationId(auth),
      projectId: input.projectId, bindingId: entry.bindingId });
    if (currentBinding.status !== "current" || registered.get(currentBinding.binding.subjectId) !== currentBinding.binding.registrationId) {
      conflict("A current source Binding's organization registration is no longer active.");
    }
    const registration = currentBinding.binding;
    const definition = pinnedSnapshot.getDefinitionRevision({ definitionId: ParameterDefinitionId(entry.definitionId), revisionId: DefinitionRevisionId(entry.effectiveRevisionId) });
    if (definition.status !== "found") conflict("A pinned parameter Definition is unavailable.");
    const old = await readOwnedProjectValueIdentity(tx, { organizationId: parameterOrganizationId(auth),
      projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (!old) conflict("A current source value is unavailable.");
    if (pin.format === "json") {
      if (pin.locator.kind !== "json-pointer" || typeof pin.locator.pointer !== "string" || pin.rootPointer === null
        || !sameSourceRevision(old.value.payload, { kind: "json", value: readJsonSourceValue(memberContents.get(pin.fileId)!, pin.locator.pointer, pin.rootPointer) })) {
        conflict("An unchanged JSON parameter does not match its exact owned source.");
      }
      assertCanonicalValueConstraints(definition.revision, old.value.payload);
      cohort.push({ ...entry, fileId: pin.fileId, fileVersionId: pin.fileVersionId, logicalNodeId: null,
        propertyName: "", format: "json", valueState: "present", locator: pin.locator });
      continue;
    }
    if (!pin.logicalNodeId || typeof pin.locator.propertyName !== "string" || pin.locator.kind !== "dts-property") {
      conflict("A current DTS Binding has unsupported provenance.");
    }
    const logical = continuity.nodes.find((row) => row.logicalNodeId === pin.logicalNodeId);
    const node = logical ? resolved.effective.nodesByLocator.get(logical.nodeLocator) : undefined;
    const property = node?.properties.get(pin.locator.propertyName);
    const originMember = rows.find((row) => row.sourceName === property?.sourceChain.at(-1)?.fileName);
    let matchingSnapshot = matchingSnapshots.get(pinnedSnapshot.release.id);
    if (!matchingSnapshot) {
      matchingSnapshot = await loadOrganizationCatalogSnapshot(tx, parameterOrganizationId(auth), pinnedSnapshot);
      matchingSnapshots.set(pinnedSnapshot.release.id, matchingSnapshot);
    }
    const resolvedSubject = node ? resolveObservedSubject(matchingSnapshot, {
      compatibles: parseCompatibles(node.properties.get("compatible")?.rawText ?? null), nodeName: node.name
    }) : null;
    const source = node && !node.deleted && property && !property.deleted && originMember?.fileId === pin.fileId
      && resolvedSubject?.subjectId === registration.subjectId
      ? { payload: rawTextToPayload(pin.locator.propertyName, property.rawText), fileId: pin.fileId, propertyName: pin.locator.propertyName }
      : null;
    const frozen = { ...entry, fileId: pin.fileId, fileVersionId: pin.fileVersionId, logicalNodeId: pin.logicalNodeId,
      propertyName: pin.locator.propertyName, valueState: "present" as const, locator: pin.locator };
    cohort.push(frozen);
    if (source) {
      // Existing Bindings retain their pinned revision, never migrate to a newly selected Definition implicitly.
      assertCanonicalValueConstraints(definition.revision, source.payload, true);
      if (!sameSourceRevision(old.value.payload, source.payload)) targets.push({
        bindingId: entry.bindingId, action: "set", payload: source.payload, afterFileId: source.fileId, propertyName: source.propertyName
      });
      const registeredIndex = sourceProperties.findIndex((row) => row.logicalNodeId === pin.logicalNodeId
        && row.fileId === pin.fileId && row.propertyName === pin.locator.propertyName);
      if (registeredIndex >= 0) sourceProperties.splice(registeredIndex, 1);
    } else targets.push({ bindingId: entry.bindingId, action: "delete", payload: old.value.payload,
      afterFileId: pin.fileId, propertyName: pin.locator.propertyName });
  }
  const restorations = await prepareSourceRestorations(tx, restorationScope, sourceProperties, anchors,
    options.snapshots ?? new Map(snapshot ? [[snapshot.release.id, snapshot]] : []));
  for (const restored of restorations) {
    const { format: _format, ...identity } = restored;
    cohort.push({ ...identity, valueState: "deleted", locator: restored.locator as Record<string, ContractJsonValue> });
    targets.push({ bindingId: restored.bindingId, action: "set", payload: restored.payload, afterFileId: restored.fileId, propertyName: restored.propertyName });
  }
  for (const property of sourceProperties) {
    const definition = snapshot!.getDefinitionRevision({ definitionId: ParameterDefinitionId(property.definitionId),
      revisionId: DefinitionRevisionId(property.definitionRevisionId) });
    if (definition.status !== "found") conflict("New source property Definition is unavailable.");
    assertCanonicalValueConstraints(definition.revision, property.payload, true);
  }
  const members = rows.map(({ memberId, fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes }) =>
    ({ memberId, fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes }));
  const base = { kind: "source_revision" as const, organizationId: parameterOrganizationId(auth), projectId: input.projectId,
    candidateId: candidate.id, fileId: candidate.fileId, configSetId: context.configSetId, baseVersionId: context.baseVersionId,
    baseConfigRevisionId: revision.id, baseDigest: sourceRevisionDigest(Buffer.from(before)), proposedDigest: sourceRevisionDigest(bytes),
    entryFile: revision.entry_file, includeSearchPaths: revision.include_search_paths, overlayOrder: revision.overlay_order,
    ...(resolved.preprocessing ? { preprocessing: resolved.preprocessing.receipt } : {}),
    members, cohort, continuity, catalogRelease: snapshot ? { id: snapshot.release.id, digest: snapshot.release.digest } : null,
    pinnedCatalogReleases: [...new Set(cohort.map((row) => row.catalogReleaseId))].sort().map((id) => {
      const pinned = options.snapshots?.get(id) ?? snapshot!;
      return { id, digest: pinned.release.digest };
    }), registrations, targets, newProperties: sourceProperties, ...(restorations.length ? { restorations } : {}) };
  return { proof: { ...base, proofDigest: sourceRevisionDigest(base) }, before, after, diagnostics, preprocessing: resolved.preprocessing };
}

export async function assertSourceRevisionWriteAllowed(tx: Database, auth: AuthContext, proof: SourceRevisionProof,
  security: CanonicalSourceSecurityContext) {
  await requireCanonicalUserInvocation(auth, security, { projectId: proof.projectId, operation: "whole DTS source revision",
    targetType: "project-parameter-file", targetId: proof.fileId });
  if (!canAdminParameters(auth) || !canEditParameters(auth, proof.projectId)) throw new ApiError("FORBIDDEN", "File administration and project edit permission are required.");
  // Check every effective before/after node: unregistered source is still subject to sensitive-node policy.
  const before = (await tx.query<{ node_locator: string; compatible: string | null }>(
    "select node_locator,compatible from dts_logical_node_revisions where config_revision_id=$1", [proof.baseConfigRevisionId])).rows;
  const nodes = [...before.map((row) => [row.node_locator, row.compatible] as const),
    ...proof.continuity.nodes.map((row) => [row.nodeLocator, row.compatible ?? null] as const)];
  for (const [nodePath, compatible] of nodes) await assertTrustedSensitiveNodeWriteAllowed(tx, auth, {
    organizationId: parameterOrganizationId(auth), projectId: proof.projectId, nodePath,
    sourcePath: { kind: "node-locator", value: nodePath }, compatible: canonicalizeLogicalNodeCompatible(compatible),
    compatibleIsAuthoritative: true, invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink
  });
}

export async function previewSourceRevisionCandidate(db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; candidateId: string }, options: { snapshot?: CatalogSnapshot; toolchain?: DtsToolchainRunner } = {}
): Promise<SourceRevisionPreview> {
  if (!canViewParameters(auth) && !canAdminParameters(auth)) throw new ApiError("FORBIDDEN", "Parameter view permission is required.");
  const candidate = await getParameterFileCandidateById(db, { organizationId: parameterOrganizationId(auth), ...input });
  const context = candidate?.sourceRevisionContext;
  if (!candidate?.fileId || !context) throw new ApiError("NOT_FOUND", "Whole-source candidate was not found.");
  const request = (await db.query<{ requestId: string; status: "pending" | "approved" | "rejected" | "withdrawn" }>(
    `select id as "requestId",status from public.project_parameter_value_change_requests where organization_id=$1 and project_id=$2
     and candidate_id=$3 and request_kind='source_revision' order by created_at desc limit 1`, [parameterOrganizationId(auth), input.projectId, input.candidateId])).rows[0];
  const snapshot = await loadSnapshot(db, options.snapshot);
  const snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  const inspected = await inspectSourceRevision(db, storage, auth, input, snapshot, { ...options, snapshots });
  const { proof, before, after, diagnostics } = inspected;
  const previousNodes = (await db.query<{ logical_node_id: string }>(
    "select logical_node_id from public.dts_logical_node_revisions where config_revision_id=$1", [proof.baseConfigRevisionId])).rows;
  const removed = previousNodes.filter((row) => !proof.continuity.nodes.some((node) => node.logicalNodeId === row.logical_node_id)).length;
  return { kind: "source_revision", format: "dts", candidateId: proof.candidateId, fileId: proof.fileId, configSetId: proof.configSetId,
    baseVersionId: proof.baseVersionId, configRevisionId: proof.baseConfigRevisionId, before, after, proofToken: proof.proofDigest,
    baseDigest: proof.baseDigest, proposedDigest: proof.proposedDigest, canSubmit: !request && before !== after,
    ...(!request && before === after ? { reason: "source-unchanged" } : {}), diagnostics,
    impact: { parameterChanges: proof.targets.length + proof.newProperties.length,
      nodeAdditions: proof.continuity.nodes.filter((node) => !previousNodes.some((row) => row.logical_node_id === node.logicalNodeId)).length, nodeRemovals: removed,
      restoredParameters: proof.restorations?.length ?? 0 },
    reviewers: await sourceRevisionReviewers(db, auth, input.projectId),
    ...(request ? { request: { id: request.requestId, status: request.status, kind: "source_revision" as const } } : {}) };
}

export async function submitSourceRevisionCandidate(db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; candidateId: string; expectedCurrentVersionId: string; expectedProofToken: string;
    reason: string; assignedToUserId: string; clientMutationId: string }, security: CanonicalSourceSecurityContext,
  options: { snapshot?: CatalogSnapshot; toolchain?: DtsToolchainRunner } = {}
): Promise<{ requestId: string; status: "pending" | "approved" | "rejected" | "withdrawn"; replayed: boolean }> {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "whole DTS source revision submit",
    targetType: "project-parameter-file-candidate", targetId: input.candidateId });
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) throw new ApiError("FORBIDDEN", "File administration and project edit permission are required.");
  if (!input.reason.trim() || !input.clientMutationId.trim() || input.clientMutationId.length > 160) throw new ApiError("VALIDATION_FAILED", "A reason and mutation key are required.");
  const snapshot = await loadSnapshot(db, options.snapshot);
  const snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  const mutationDigest = sourceRevisionDigest(input);
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
      `source-revision-submit:${parameterOrganizationId(auth)}:${input.projectId}:${auth.user.id}:${input.clientMutationId}`
    ]);
    const replay = (await tx.query<{ id: string; status: "pending" | "approved" | "rejected" | "withdrawn"; source_revision_mutation_digest: string }>(
      `select id,status,source_revision_mutation_digest from public.project_parameter_value_change_requests
       where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and source_revision_mutation_id=$4`,
      [parameterOrganizationId(auth), input.projectId, auth.user.id, input.clientMutationId])).rows[0];
    if (replay) {
      if (replay.source_revision_mutation_digest !== mutationDigest) conflict("Source review mutation key was reused for a different request.");
      return { requestId: replay.id, status: replay.status, replayed: true };
    }
    const assignee = await getAuthContext(tx, input.assignedToUserId).catch((error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
      throw error;
    });
    if (!assignee || assignee.organization.id !== parameterOrganizationId(auth) || input.assignedToUserId === auth.user.id
      || !await isSourceRevisionReviewer(tx, assignee, input.projectId)) {
      throw new ApiError("VALIDATION_FAILED", "Choose another software reviewer with file administration permission.");
    }
    const { proof, before, after } = await inspectSourceRevision(tx, storage, auth, input, snapshot, { ...options, lock: true, snapshots });
    await assertSourceRevisionWriteAllowed(tx, auth, proof, security);
    if (proof.baseVersionId !== input.expectedCurrentVersionId || proof.proofDigest !== input.expectedProofToken) conflict("Source revision no longer matches the reviewed preview.");
    if (before === after) throw new ApiError("VALIDATION_FAILED", "Source has no changes.");
    const requestId = await freezeSourceRevisionRequest(tx, auth, proof, input, mutationDigest);
    await writeTrustedAuditEventInTx(asAuditTx(tx), { invocation: security.invocation, app: "parameters",
      kind: "parameter-topology-governance", action: "value-change-submitted", severity: "Medium", projectId: input.projectId,
      targetType: "project-parameter-value-change-request", targetId: requestId,
      metadata: { requestId, requestKind: "source_revision", sourceRevisionProofDigest: proof.proofDigest,
        candidateId: proof.candidateId, configSetId: proof.configSetId, parameterChanges: proof.targets.length + proof.newProperties.length },
      traceId: security.requestId });
    return { requestId, status: "pending", replayed: false };
  });
}

export type FrozenSourceRequestProof = Pick<SourceRevisionProof, "configSetId" | "baseConfigRevisionId" | "baseDigest" | "proposedDigest" | "proofDigest" | "targets"> & {
  kind: "source_revision" | "member_addition" | "configuration_restore";
  candidateId: string | null;
  members: readonly unknown[];
  cohort: Array<Pick<SourceRevisionCohort, "bindingId" | "oldValueId" | "sourcePinId" | "definitionId" | "effectiveRevisionId" | "catalogReleaseId">>;
};

export async function freezeSourceRevisionRequest(tx: Database, auth: AuthContext, proof: FrozenSourceRequestProof,
  input: { projectId: string; reason: string; assignedToUserId: string | null; clientMutationId: string },
  mutationDigest: string, applicationMode: "separate_review" | "administrator_direct" = "separate_review"): Promise<string> {
  const pending = (await tx.query<{ id: string }>(`select id from public.project_parameter_value_change_requests
    where organization_id=$1 and project_id=$2 and status='pending' and (
      source_revision_config_set_id=$3 or batch_config_set_id=$3 or member_config_set_id=$3
      or config_revision_id=$4) limit 1`, [parameterOrganizationId(auth), input.projectId, proof.configSetId, proof.baseConfigRevisionId])).rows[0];
  if (pending) throw new ApiError("CONFLICT", "This configuration already has a pending change request.", { requestId: pending.id, reason: "source-review-pending" });
  if (await hasSourceConfigurationDrafts(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: proof.configSetId })) {
    conflict("Resolve existing parameter drafts before submitting a source revision.", "parameter-drafts-unresolved");
  }
  const requestId = `pvcr_${randomUUID()}`;
  await tx.query(`update public.project_parameter_file_candidates set base_digest=$2,proposed_digest=$3,diff_digest=$4,
    frozen_member_manifest=$5::jsonb,frozen_binding_manifest=$6::jsonb where id=$1 and status='ready'`,
    [proof.candidateId, proof.baseDigest, proof.proposedDigest, proof.proofDigest, JSON.stringify(proof.members), JSON.stringify(proof.cohort)]);
  await tx.query(`insert into public.project_parameter_value_change_requests
    (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,assigned_to_user_id,candidate_id,
     candidate_base_digest,candidate_proposed_digest,candidate_diff_digest,candidate_member_manifest,candidate_binding_manifest,
     source_revision_context,source_revision_proof_digest,source_revision_config_set_id,source_revision_mutation_id,source_revision_mutation_digest,source_revision_application_mode)
    values ($1,$2,$3,$18,$4,'pending',$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$10,$14,$15,$16,$17)`,
    [requestId, parameterOrganizationId(auth), input.projectId, input.reason.trim(), auth.user.id, input.assignedToUserId,
      proof.candidateId, proof.baseDigest, proof.proposedDigest, proof.proofDigest, JSON.stringify(proof.members),
      JSON.stringify(proof.cohort), JSON.stringify(proof), proof.configSetId, input.clientMutationId, mutationDigest, applicationMode, proof.kind]);
  for (const [ordinal, target] of proof.targets.entries()) {
    const entry = proof.cohort.find((row) => row.bindingId === target.bindingId)!;
    const source = await readOwnedProjectValueIdentity(tx, { organizationId: parameterOrganizationId(auth),
      projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (!source) conflict("Reviewed target has no current source value.");
    await tx.query(`insert into public.project_parameter_value_change_targets
      (id,request_id,organization_id,project_id,ordinal,binding_id,definition_id,definition_revision_id,catalog_release_id,
       base_current_value_id,config_revision_id,source_ref,source_pin_id,action,target_value,base_digest,proposed_digest)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)`,
      [`pvct_${randomUUID()}`, requestId, parameterOrganizationId(auth), input.projectId, ordinal, entry.bindingId,
        entry.definitionId, entry.effectiveRevisionId, entry.catalogReleaseId, entry.oldValueId, proof.baseConfigRevisionId,
        source.value.source.sourceRef, entry.sourcePinId, target.action, JSON.stringify(target.payload), proof.baseDigest, proof.proposedDigest]);
  }
  return requestId;
}
