import { parameterOrganizationId } from "../parameters/operatingScope";
import { createHash, randomUUID } from "node:crypto";

import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { TrustedRefusalAuditSink } from "../audit/trustedRefusalSink";
import { CatalogSubjectId, PropertyKey, type CatalogSnapshot } from "../catalog-kernel/interface";
import { loadOrganizationCatalogSnapshot } from "../parameter-modules/recognitionSettings";
import type { ObjectStore } from "../logs/objectStore";
import { DefinitionRevisionId, ParameterDefinitionId, serializeContract, type ContractJsonValue } from "../parameter-catalog-contract";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { asValueClient, listObservedProperties, rawTextToPayload, syncPublishedCatalogProjectValuesInTransaction,
  resolveObservedSubject, parseCompatibles, loadActiveOrganizationSourceRegistrations, lockSourceCatalogGovernance } from "../parameter-bindings/catalogProjectValueSync";
import { loadSourceBindingCohortReadOnly, hasSourceConfigurationDrafts, readOwnedCurrentBinding } from "../parameter-bindings/values";
import { assertCanonicalValueConstraints } from "../parameter-bindings/values/service";
import { digestProjectValuePayload, deriveHistoryEventId, deriveProjectValueId,
  casCurrentTip, insertBindingHistoryEvent, insertProjectValue, loadBindingById, loadProjectValueById,
  loadOwnedProjectValueSourcePin } from "../parameter-bindings/values/repositories";
import { canAdminParameters, canEditParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { hasCurrentCanonicalReviewRole } from "../parameters/reviewWorkflowRepository";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import { ingestConfigRevisionInTransaction, prepareReviewedSourceContinuity, type ReviewedSourceContinuity } from "../parameter-topology/ingestService";
import { resolveDtsConfigSet, resolveDtsConfigSetAsync } from "../dts";
import { stripDtsComments } from "../dts/preprocess";
import { canonicalizeLogicalNodeCompatible } from "../parameter-topology/writeLock";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { canonicalSourceMemberMatchesCurrentFile, loadCanonicalSourceCohort,
  loadCanonicalSourceSnapshot, lockCanonicalSourceCohort, recordCanonicalPermissionRefusal,
  requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, readJsonSourceValue } from "./jsonSource";
import { createDtsToolchainRunner, type DtsToolchainRunner } from "./dtsToolchain";
import { loadFormerRootOverlayFiles } from "./configSetSnapshot";
import { loadSnapshot, loadSourceRevisionCatalogSnapshots, requireCurrentSourceAdministrator, sourceRevisionDigest, type SourceRevisionNewProperty } from "./sourceRevisionService";
import { isStructuralPropertyKey } from "../parameter-topology/parameterSurface";
import { deriveDtsSourceRef } from "../dts/sourceRef";
import { rethrowSourceTransactionError } from "./sourceVersion";
import { applySourceRestoration, matchingDeletedSourceAnchors, prepareSourceRestorations, sourceRestorationNodes, type SourceRestoration } from "./sourceRestoration";

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
    fileId: string; fileVersionId: string; sourceName: string; format: "json" | "dts";
    role: string; sortOrder: number; checksum: string; sizeBytes: number;
  }>[];
  cohort: readonly Readonly<{
    bindingId: string; oldValueId: string; sourcePinId: string;
    sourceOccurrenceId: string; definitionId: string; effectiveRevisionId: string;
    catalogReleaseId: string; fileId: string; fileVersionId: string;
    locator: Record<string, ContractJsonValue>; valueDigest: string;
  }>[];
  proofDigest: string;
  configuration?: { entryFile: string; includeSearchPaths: string[]; overlayOrder: string[]; continuity?: ReviewedSourceContinuity };
  newProperties?: SourceRevisionNewProperty[];
  restorations?: SourceRestoration[];
  originTransfers?: Array<{ bindingId: string; oldValueId: string; sourcePinId: string; fromFileId: string; toFileId: string }>;
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
  let seed: { bindingId: string; valueId: string } | undefined;
  for (const entry of await loadSourceBindingCohortReadOnly(tx, {
    organizationId, projectId: input.projectId, configSetId: input.configSetId
  })) {
    const pin = await loadOwnedProjectValueSourcePin(tx, {
      organizationId, projectId: input.projectId,
      bindingId: entry.bindingId, projectValueId: entry.oldValueId
    });
    if (pin?.fileId === input.fileId) {
      seed = { bindingId: entry.bindingId, valueId: entry.oldValueId };
      break;
    }
  }
  if (!seed) conflict("Removed source member has no current Binding cohort.");
  const sourcePin = await loadOwnedProjectValueSourcePin(tx, {
    organizationId, projectId: input.projectId, bindingId: seed.bindingId, projectValueId: seed.valueId
  });
  if (!sourcePin) conflict("Removed source member has no exact source pin.");
  await lockCanonicalSourceCohort(tx, sourcePin);
  const cohort = await loadCanonicalSourceCohort(tx, {
    organizationId, projectId: input.projectId, configSetId: input.configSetId
  });
  const snapshot = await loadCanonicalSourceSnapshot(tx, storage, {
    organizationId, projectId: input.projectId, bindingId: seed.bindingId, projectValueId: seed.valueId
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

/** Composition is rooted in the saved manifest, including files with no Binding. */
async function inspectAdministratorMemberRemoval(tx: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; configSetId: string; fileId: string }, snapshot: CatalogSnapshot | null,
  snapshots?: ReadonlyMap<string, CatalogSnapshot>, requestId?: string, toolchain?: DtsToolchainRunner) {
  const currentCatalog = await lockSourceCatalogGovernance(tx, parameterOrganizationId(auth));
  if (snapshot ? currentCatalog?.id !== snapshot.release.id || currentCatalog.digest !== snapshot.release.digest : currentCatalog) {
    conflict("Catalog 已更新，请刷新配置并重新预览。");
  }
  const scope = [parameterOrganizationId(auth), input.projectId, input.configSetId];
  const set = await tx.query("select id from public.dts_config_set where organization_id=$1 and project_id=$2 and id=$3 for update nowait", scope);
  if (set.rows.length !== 1) throw new ApiError("NOT_FOUND", "配置不存在或不属于当前项目。");
  const current = (await tx.query<MemberFile>(`select id,current_version_id,config_set_role,config_set_sort_order,format
    from public.project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3 order by id for update nowait`, scope)).rows;
  if (!current.some((file) => file.id === input.fileId)) throw new ApiError("NOT_FOUND", "该文件已不在配置中，请刷新文件管理。");
  const revision = (await tx.query<{ id: string; entry_file: string; include_search_paths: string[]; overlay_order: string[] }>(`
    select id,entry_file,include_search_paths,overlay_order from public.dts_config_revisions
    where organization_id=$1 and project_id=$2 and config_set_id=$3 and status in ('resolved','validated','compiled','pending_approval')
    order by revision_number desc limit 1`, scope)).rows[0];
  if (!revision) conflict("配置缺少可用来源版本，请先在配置工作台解析当前文件。");
  const members = (await tx.query<CanonicalMemberRemovalProof["members"][number] & { storageKey: string }>(`
    select member.file_id as "fileId",member.file_version_id as "fileVersionId",member.source_name as "sourceName",file.format,
      member.role,member.sort_order as "sortOrder",version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey"
    from public.dts_config_revision_members member join public.project_parameter_files file on file.id=member.file_id
    join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=file.id
    where member.config_revision_id=$1 order by member.sort_order,member.file_id`, [revision.id])).rows;
  if (members.length !== current.length || members.some((member) => {
    const file = current.find((row) => row.id === member.fileId);
    return !file || !canonicalSourceMemberMatchesCurrentFile(member, file);
  })) conflict("当前成员、角色或版本与来源记录不一致，请刷新并解析配置后重新预览。");
  if (members.length < 2) throw new ApiError("VALIDATION_FAILED", "移除后没有可用根文件。请先添加并验证替代配置文件。", { reason: "missing-base" });
  const files: Array<{ name: string; content: string }> = [];
  for (const member of members) {
    if (!storage.getBounded) throw new ApiError("INTERNAL_ERROR", "Bounded source storage is required.");
    const bytes = await storage.getBounded(member.storageKey, MAX_PARAMETER_SOURCE_BYTES);
    if (bytes.length !== member.sizeBytes) conflict("历史源文件大小校验失败，请恢复文件存储后重试。");
    if (sourceRevisionDigest(bytes) !== member.checksum.replace(/^sha256:/, "")) conflict("历史源文件校验失败，请恢复文件存储后重试。");
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (member.format === "json") parseJsonSource(content);
    files.push({ name: member.sourceName, content });
  }
  const survivors = members.filter((member) => member.fileId !== input.fileId);
  const removed = members.find((member) => member.fileId === input.fileId)!;
  const overlayOrder = revision.overlay_order.filter((name) => name !== removed.sourceName);
  const configuration: NonNullable<CanonicalMemberRemovalProof["configuration"]> = {
    entryFile: revision.entry_file, includeSearchPaths: revision.include_search_paths, overlayOrder
  };
  const dependencies: Array<{ file: string; kind: "include" | "overlay"; target: string }> = [];
  for (const member of members.filter((row) => row.format === "dts")) {
    const content = files.find((row) => row.name === member.sourceName)!.content;
    for (const match of stripDtsComments(content).matchAll(/(?:#include|\/include\/)\s*["<]([^">]+)[">]/g)) dependencies.push({ file: member.sourceName, kind: "include", target: match[1]! });
  }
  for (const target of revision.overlay_order) dependencies.push({ file: revision.entry_file, kind: "overlay", target });
  let nodeRemovals = 0;
  let nodeAdditions = 0;
  const sourceProperties: SourceRevisionNewProperty[] = [];
  let effective: ReturnType<typeof resolveDtsConfigSet>["effective"] | undefined;
  const restorationScope = { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId };
  let anchors: Awaited<ReturnType<typeof matchingDeletedSourceAnchors>> = [];
  if (members.some((member) => member.format === "dts")) {
    const sourceFiles = new Map(survivors.filter((member) => member.format === "dts").map((member) => [member.sourceName,
      { content: files.find((row) => row.name === member.sourceName)!.content, fileVersionId: member.fileVersionId }]));
    if (!survivors.some((row) => row.format === "dts" && row.role === "base" && row.sourceName === revision.entry_file)) {
      throw new ApiError("VALIDATION_FAILED", "不能移除当前 DTS 根文件。请先将其他 DTS 文件设为根文件。", { reason: "missing-base" });
    }
    const resolved = await resolveDtsConfigSetAsync({ ...configuration, files: sourceFiles, requireExactOrigins: true });
    effective = resolved.effective;
    const errors = resolved.diagnostics.filter((row) => row.severity === "error" || /dangling|unresolved/.test(row.code));
    if (errors.length) throw new ApiError("VALIDATION_FAILED", `移除后存在未解决的 include 或节点引用：${errors.map((row) => `${row.fileName ?? "配置"}：${row.message}`).join("；")}。请先更新引用文件，再重新预览。`, { reason: "unresolved-source-dependency", diagnostics: errors });
    const formerRootOverlayFiles = await loadFormerRootOverlayFiles(tx, input.configSetId, survivors, overlayOrder);
    const validation = await (toolchain ?? createDtsToolchainRunner()).validate({ ...configuration, files: sourceFiles, formerRootOverlayFiles }, { mode: "release" });
    if (!validation.ok || validation.mode !== "release") throw new ApiError("VALIDATION_FAILED", "移除后的 DTS 配置无法构建，请修复配置文件后重新预览。", { reason: validation.failureCode, diagnostics: validation.diagnostics });
    anchors = await matchingDeletedSourceAnchors(tx, restorationScope, resolved.effective.nodesByLocator, survivors);
    configuration.continuity = await prepareReviewedSourceContinuity(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId,
      configSetId: input.configSetId, baseConfigRevisionId: revision.id, effectiveNodes: resolved.effective.nodesByLocator,
      sourceDigest: sourceRevisionDigest(survivors.map((member) => [member.fileId, member.checksum])),
      restorationNodes: sourceRestorationNodes(anchors) });
    if (snapshot) {
      snapshot = await loadOrganizationCatalogSnapshot(tx, parameterOrganizationId(auth), snapshot);
      const registrations = new Map((await loadActiveOrganizationSourceRegistrations(tx, { organizationId: parameterOrganizationId(auth) })).map((row) => [row.subjectId, row.id]));
      for (const node of resolved.effective.nodesByLocator.values()) {
        if (node.deleted) continue;
        const subject = resolveObservedSubject(snapshot, { compatibles: parseCompatibles(node.properties.get("compatible")?.rawText ?? null), nodeName: node.name });
        const registrationId = subject && registrations.get(subject.subjectId);
        if (!subject || !registrationId) continue;
        const logical = configuration.continuity.nodes.find((row) => row.nodeLocator === node.nodeLocator)!;
        for (const [propertyName, property] of node.properties) {
          if (property.deleted || isStructuralPropertyKey(propertyName)) continue;
          const definition = snapshot.getDefinition({ subjectId: CatalogSubjectId(subject.subjectId), propertyKey: PropertyKey(propertyName) });
          if (definition.status !== "found") continue;
          const member = survivors.find((row) => row.sourceName === property.sourceChain.at(-1)?.fileName);
          if (!member) conflict("移除后的参数没有唯一的保留来源，请核对配置结构。");
          const payload = rawTextToPayload(propertyName, property.rawText);
          sourceProperties.push({ logicalNodeId: logical.logicalNodeId, nodeLocator: logical.nodeLocator, propertyName,
            fileId: member.fileId, definitionId: definition.definition.id, definitionRevisionId: definition.definition.selectedRevision.id,
            registrationId, subjectId: subject.subjectId, payload });
        }
      }
    }
    const previousNodes = (await tx.query<{ logical_node_id: string }>(
      "select logical_node_id from public.dts_logical_node_revisions where config_revision_id=$1", [revision.id])).rows;
    nodeRemovals = previousNodes.filter((row) => !configuration.continuity!.nodes.some((node) => node.logicalNodeId === row.logical_node_id)).length;
    nodeAdditions = configuration.continuity.nodes.filter((node) => !previousNodes.some((row) => row.logical_node_id === node.logicalNodeId)).length;
  }
  const cohort: CanonicalMemberRemovalProof["cohort"][number][] = [];
  const originTransfers: NonNullable<CanonicalMemberRemovalProof["originTransfers"]> = [];
  for (const row of await loadSourceBindingCohortReadOnly(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId })) {
    const pin = await loadOwnedProjectValueSourcePin(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: row.bindingId, projectValueId: row.oldValueId });
    if (!pin || pin.configRevisionId !== revision.id || pin.valueState !== "present" || !members.some((member) => member.fileId === pin.fileId && member.fileVersionId === pin.fileVersionId)) {
      conflict("参数来源或当前值已变化，请重新同步并预览配置。");
    }
    cohort.push({ ...row, fileId: pin.fileId, fileVersionId: pin.fileVersionId, locator: pin.locator });
    if (pin.format === "dts") {
      const pinned = snapshots?.get(row.catalogReleaseId) ?? (snapshot?.release.id === row.catalogReleaseId ? snapshot : null);
      const currentBinding = await readOwnedCurrentBinding(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: row.bindingId });
      if (!pinned || currentBinding.status !== "current") conflict("参数的固定定义或来源身份不可用，请核对参数工作台。");
      const logical = configuration.continuity?.nodes.find((node) => node.logicalNodeId === pin.logicalNodeId);
      const node = logical && effective?.nodesByLocator.get(logical.nodeLocator);
      const property = node?.properties.get(String(pin.locator.propertyName));
      const origin = survivors.find((member) => member.sourceName === property?.sourceChain.at(-1)?.fileName);
      const matched = node && resolveObservedSubject(await loadOrganizationCatalogSnapshot(tx, parameterOrganizationId(auth), pinned), {
        compatibles: parseCompatibles(node.properties.get("compatible")?.rawText ?? null), nodeName: node.name
      });
      if (node && !node.deleted && property && !property.deleted && origin && matched?.subjectId === currentBinding.binding.subjectId) {
        const definition = pinned.getDefinitionRevision({ definitionId: ParameterDefinitionId(row.definitionId), revisionId: DefinitionRevisionId(row.effectiveRevisionId) });
        if (definition.status !== "found") conflict("参数固定的历史定义不可用。");
        assertCanonicalValueConstraints(definition.revision, rawTextToPayload(String(pin.locator.propertyName), property.rawText), true);
        if (origin.fileId !== pin.fileId) originTransfers.push({ bindingId: row.bindingId, oldValueId: row.oldValueId, sourcePinId: pin.sourcePinId, fromFileId: pin.fileId, toFileId: origin.fileId });
      } else if (pin.fileId !== input.fileId) conflict("移除将改变保留参数的主体或身份，请先在身份映射中确认归属。");
    }
    const existing = sourceProperties.findIndex((property) => property.logicalNodeId === pin.logicalNodeId
      && property.definitionId === row.definitionId && property.propertyName === pin.locator.propertyName);
    if (existing >= 0) {
      sourceProperties.splice(existing, 1);
    }
  }
  const restorations = await prepareSourceRestorations(tx, restorationScope, sourceProperties, anchors,
    snapshots ?? new Map(snapshot ? [[snapshot.release.id, snapshot]] : []));
  for (const restored of restorations) cohort.push({ ...restored, locator: restored.locator as Record<string, ContractJsonValue> });
  for (const property of sourceProperties) {
    const definition = snapshot?.getDefinitionRevision({ definitionId: ParameterDefinitionId(property.definitionId), revisionId: DefinitionRevisionId(property.definitionRevisionId) });
    if (!definition || definition.status !== "found") conflict("重新生效的参数定义不可用。");
    assertCanonicalValueConstraints(definition.revision, property.payload, true);
  }
  const pending = await tx.query(`select id from public.project_parameter_value_change_requests where organization_id=$1 and project_id=$2 and status='pending'
    and (source_revision_config_set_id=$3 or batch_config_set_id=$3 or member_config_set_id=$3 or config_revision_id=$4)
    and id<>coalesce($5,'') limit 1`, [...scope, revision.id, requestId ?? null]);
  if (pending.rows.length || await hasSourceConfigurationDrafts(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId })) {
    throw new ApiError("CONFLICT", "配置有待处理的参数草稿或审核请求，请先在参数工作台或审核中心处理。", { reason: "source-review-pending" });
  }
  const base = { kind: "canonical-member-removal" as const, organizationId: parameterOrganizationId(auth), ...input,
    fileVersionId: removed.fileVersionId, configRevisionId: revision.id, members: members.map(({ storageKey: _key, ...row }) => row), cohort, configuration,
    newProperties: sourceProperties, ...(restorations.length ? { restorations } : {}), originTransfers };
  return { proof: { ...base, proofDigest: sourceRevisionDigest(base) }, files, dependencies, nodeRemovals, nodeAdditions };
}

export async function previewAdministratorMemberRemoval(db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; configSetId: string; fileId: string }, options: { toolchain?: DtsToolchainRunner } = {}) {
  if (!canAdminParameters(auth) || !canEditParameters(auth, input.projectId)) throw new ApiError("FORBIDDEN", "配置管理员权限不足。");
  const snapshot = await loadSnapshot(db);
  const snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  try {
    return await db.transaction(async (tx) => {
      const inspected = await inspectAdministratorMemberRemoval(tx, storage, auth, input, snapshot, snapshots, undefined, options.toolchain);
      return { canApply: true as const, proofToken: inspected.proof.proofDigest, members: inspected.proof.members,
        removedFileId: input.fileId, dependencies: inspected.dependencies,
        parameterImpacts: [...inspected.proof.cohort.flatMap((row) => {
          const transfer = inspected.proof.originTransfers.find((item) => item.bindingId === row.bindingId);
          if (row.fileId !== input.fileId && !transfer) return [];
          return [{ propertyName: String(row.locator.propertyName ?? row.locator.pointer ?? "参数"),
            fromSource: inspected.proof.members.find((member) => member.fileId === row.fileId)!.sourceName,
            toSource: transfer ? inspected.proof.members.find((member) => member.fileId === transfer.toFileId)!.sourceName : null }];
        }), ...[...inspected.proof.newProperties, ...(inspected.proof.restorations ?? [])].map((row) => ({ propertyName: row.propertyName, fromSource: null,
          toSource: inspected.proof.members.find((member) => member.fileId === row.fileId)!.sourceName }))],
        impact: { restoredParameters: inspected.proof.restorations?.length ?? 0, nodeRemovals: inspected.nodeRemovals, nodeAdditions: inspected.nodeAdditions,
          removedBindings: inspected.proof.cohort.filter((row) => row.fileId === input.fileId && !inspected.proof.originTransfers.some((transfer) => transfer.bindingId === row.bindingId)).length,
          retainedBindings: inspected.proof.cohort.filter((row) => !inspected.proof.restorations?.some((restored) => restored.bindingId === row.bindingId)
            && (row.fileId !== input.fileId || inspected.proof.originTransfers.some((transfer) => transfer.bindingId === row.bindingId))).length,
          exposedBindings: inspected.proof.newProperties.length + inspected.proof.originTransfers.length } };
    });
  } catch (error) { rethrowSourceTransactionError(error); }
}

export async function applyAdministratorMemberRemoval(db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; configSetId: string; fileId: string; expectedProofToken: string; reason: string; clientMutationId: string },
  security: CanonicalSourceSecurityContext, options: { toolchain?: DtsToolchainRunner } = {}) {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "administrator configuration member removal",
    targetType: "project-parameter-file", targetId: input.fileId });
  const snapshot = await loadSnapshot(db);
  const snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  const mutationDigest = sourceRevisionDigest(input);
  try {
    return await db.transaction(async (tx) => {
      auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`member-removal:${parameterOrganizationId(auth)}:${auth.user.id}:${input.clientMutationId}`]);
      const previous = (await tx.query<{ id: string; member_mutation_digest: string; member_frozen_proof: CanonicalMemberRemovalProof }>(`
        select id,member_mutation_digest,member_frozen_proof from public.project_parameter_value_change_requests
        where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and member_mutation_id=$4`,
      [parameterOrganizationId(auth), input.projectId, auth.user.id, input.clientMutationId])).rows[0];
      let requestId: string, proof: CanonicalMemberRemovalProof;
      if (previous) {
        if (previous.member_mutation_digest !== mutationDigest) conflict("移除操作标识已用于其他输入，请重新预览。");
        requestId = previous.id; proof = previous.member_frozen_proof;
      } else {
        const inspected = await inspectAdministratorMemberRemoval(tx, storage, auth, { projectId: input.projectId, configSetId: input.configSetId, fileId: input.fileId }, snapshot, snapshots, undefined, options.toolchain);
        proof = inspected.proof;
        if (proof.proofDigest !== input.expectedProofToken) conflict("配置成员、来源或参数值已变化。请重新预览后确认，未移除任何文件。");
        requestId = `pvcr_${randomUUID()}`;
        await tx.query(`insert into public.project_parameter_value_change_requests
          (id,organization_id,project_id,request_kind,reason,status,submitter_user_id,member_file_id,member_config_set_id,
           member_file_version_id,member_proof_digest,member_frozen_proof,member_application_mode,member_mutation_id,member_mutation_digest)
          values ($1,$2,$3,'member-removal',$4,'pending',$5,$6,$7,$8,$9,$10::jsonb,'administrator_direct',$11,$12)`,
        [requestId, parameterOrganizationId(auth), input.projectId, input.reason.trim(), auth.user.id, input.fileId, input.configSetId,
          proof.fileVersionId, proof.proofDigest, JSON.stringify(proof), input.clientMutationId, mutationDigest]);
      }
      return applyReviewedCanonicalMemberRemoval(tx, storage, auth, snapshot, { requestId, submitterUserId: auth.user.id,
        reviewerUserId: auth.user.id, decision: "approve", frozen: proof }, { invocation: security.invocation, traceId: security.requestId,
        refusalSink: security.refusalSink, applicationMode: "administrator_direct", catalogSnapshots: snapshots, toolchain: options.toolchain });
    });
  } catch (error) { rethrowSourceTransactionError(error); }
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
    return (await inspectMemberRemoval(tx, storage, parameterOrganizationId(auth), input)).proof;
  } catch (error) { rethrowSourceTransactionError(error); }
}

/** Reviewed JSON and direct administrator removals share one atomic source transaction. */
export async function applyReviewedCanonicalMemberRemoval(
  tx: Database, storage: ObjectStore, auth: AuthContext, snapshot: CatalogSnapshot | null,
  review: ReviewedCanonicalMemberRemoval,
  context: { invocation: TrustedInvocationContext; traceId: string; refusalSink: TrustedRefusalAuditSink;
    applicationMode?: "administrator_direct"; catalogSnapshots?: ReadonlyMap<string, CatalogSnapshot>; toolchain?: DtsToolchainRunner }
): Promise<{ requestId: string; tombstoneId: string; successorConfigRevisionId: string; replayed: boolean }> {
  const frozen = review.frozen;
  const security: CanonicalSourceSecurityContext = {
    invocation: context.invocation, requestId: context.traceId, refusalSink: context.refusalSink
  };
  try {
    const direct = context.applicationMode === "administrator_direct";
    if (direct) auth = await requireCurrentSourceAdministrator(tx, auth, frozen.projectId);
    const request = (await tx.query<{
      status: string; submitter_user_id: string | null; assigned_to_user_id: string | null;
      reviewer_user_id: string | null; member_proof_digest: string;
      member_frozen_proof: CanonicalMemberRemovalProof; applied_source_result: {
        tombstoneId: string; successorConfigRevisionId: string
      } | null; applied_audit_ref: string | null; member_application_mode: string;
    }>(`select status,submitter_user_id,assigned_to_user_id,reviewer_user_id,
        member_proof_digest,member_frozen_proof,applied_source_result,applied_audit_ref,member_application_mode
      from public.project_parameter_value_change_requests
      where id=$1 and organization_id=$2 and project_id=$3 and request_kind='member-removal'
        and member_file_id=$4 and member_config_set_id=$5 and member_file_version_id=$6
      for update`, [review.requestId, parameterOrganizationId(auth), frozen.projectId,
      frozen.fileId, frozen.configSetId, frozen.fileVersionId])).rows[0];
    if (!request) throw new ApiError("NOT_FOUND", "Member removal review request is unavailable.");
    if (request.member_proof_digest !== frozen.proofDigest
      || !same(request.member_frozen_proof, frozen)
      || request.submitter_user_id !== review.submitterUserId
      || (direct ? request.member_application_mode !== "administrator_direct" || request.assigned_to_user_id !== null
        : request.member_application_mode !== "separate_review" || request.assigned_to_user_id !== review.reviewerUserId)
      || !['pending', 'approved'].includes(request.status)) {
      throw new ApiError("CONFLICT", "Member removal has no matching frozen review request.");
    }
    const invocation = await requireCanonicalUserInvocation(auth, security, {
      projectId: frozen.projectId, operation: "canonical member removal apply",
      targetType: "project-parameter-file", targetId: frozen.fileId
    });
    if (!review.requestId.trim() || (direct ? review.submitterUserId !== auth.user.id : review.reviewerUserId !== auth.user.id
      || review.submitterUserId === auth.user.id)
      || frozen.organizationId !== parameterOrganizationId(auth)
      || (direct ? !canEditParameters(auth, frozen.projectId) : (!canReviewParameters(auth)
      || !canReviewParameterStage(auth, frozen.projectId, "software_review")
      || !await hasCurrentCanonicalReviewRole(tx, {
        organizationId: parameterOrganizationId(auth), projectId: frozen.projectId, userId: auth.user.id
      })))) {
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
        and tombstone.config_set_id=$3 and tombstone.file_id=$4
        and audit.metadata->>'reviewRequestId'=$5`,
    [parameterOrganizationId(auth), frozen.projectId, frozen.configSetId, frozen.fileId, review.requestId])).rows[0];
    if (existing) {
      const metadata = existing.metadata as Record<string, unknown>;
      if (metadata.reviewRequestId !== review.requestId || metadata.proofDigest !== frozen.proofDigest
        || metadata.submitterUserId !== review.submitterUserId
        || !existing.successor_config_revision_id || request.status !== 'approved'
        || (direct ? request.reviewer_user_id !== null : request.reviewer_user_id !== auth.user.id)
        || request.applied_source_result?.tombstoneId !== existing.id
        || request.applied_source_result?.successorConfigRevisionId !== existing.successor_config_revision_id
        || !request.applied_audit_ref) conflict("Removed member has a different reviewed receipt.");
      return { requestId: review.requestId, tombstoneId: existing.id,
        successorConfigRevisionId: existing.successor_config_revision_id, replayed: true };
    }
    if (request.status !== 'pending') conflict("Member removal request is not pending.");
    const inspected = direct
      ? await inspectAdministratorMemberRemoval(tx, storage, auth, { projectId: frozen.projectId, configSetId: frozen.configSetId, fileId: frozen.fileId }, snapshot, context.catalogSnapshots, review.requestId, context.toolchain)
      : await inspectMemberRemoval(tx, storage, parameterOrganizationId(auth), frozen);
    if (!same(inspected.proof, frozen)) conflict("Member removal source proof is stale.");
    const attribution = trustedDomainAttribution(invocation);
    let successorConfigRevisionId: string = randomUUID();
    if (frozen.configuration?.continuity) {
      const configuration = frozen.configuration;
      const nodes = (await tx.query<{ node_locator: string; compatible: string | null }>(
        "select node_locator,compatible from public.dts_logical_node_revisions where config_revision_id=$1", [frozen.configRevisionId])).rows;
      for (const node of [...nodes, ...configuration.continuity!.nodes.map((row) => ({ node_locator: row.nodeLocator, compatible: row.compatible ?? null }))]) {
        await assertTrustedSensitiveNodeWriteAllowed(tx, auth, { organizationId: parameterOrganizationId(auth), projectId: frozen.projectId,
          ...(direct ? {} : { authorization: "review" as const }),
          nodePath: node.node_locator, sourcePath: { kind: "node-locator", value: node.node_locator }, compatible: canonicalizeLogicalNodeCompatible(node.compatible),
          compatibleIsAuthoritative: true, invocation, requestId: context.traceId, refusalSink: context.refusalSink });
      }
      const revision = await ingestConfigRevisionInTransaction(tx, { organizationId: parameterOrganizationId(auth), projectId: frozen.projectId,
        configSetId: frozen.configSetId, ...configuration, members: frozen.members.filter((row) => row.fileId !== frozen.fileId).map((member) => ({
          ...member, fileName: member.sourceName, role: member.role as ConfigRevisionMemberRole,
          content: inspected.files.find((file) => file.name === member.sourceName)!.content
        })) }, auth, { createdByUserId: attribution.userId, domain: attribution }, { reviewedSource: configuration.continuity });
      if (revision.status !== "resolved") conflict("移除后的配置结构解析失败，未保存任何变化。");
      successorConfigRevisionId = revision.id;
    } else {
      await insertConfigRevision(tx, {
        id: successorConfigRevisionId, organizationId: parameterOrganizationId(auth),
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
    }
    const observed = frozen.configuration?.continuity ? await listObservedProperties(asValueClient(tx), successorConfigRevisionId) : [];
    const auditEventId = randomUUID();
    const successorBindings: Array<{
      bindingId: string; oldValueId: string; newValueId: string; sourcePinId: string;
      historyEventId: string; fileId: string; fileVersionId: string;
    }> = [];
    for (const entry of frozen.cohort.filter((row) => row.fileId !== frozen.fileId || frozen.originTransfers?.some((transfer) => transfer.bindingId === row.bindingId))) {
      const restoration = frozen.restorations?.find((row) => row.bindingId === entry.bindingId);
      if (restoration) {
        const property = observed.find((row) => row.fileId === restoration.fileId && row.logicalNodeId === restoration.logicalNodeId && row.propertyKey === restoration.propertyName);
        const pinned = context.catalogSnapshots?.get(restoration.catalogReleaseId) ?? snapshot;
        if (!property || !pinned) conflict("恢复参数缺少实际来源或固定定义，所有变更已回滚。");
        successorBindings.push(await applySourceRestoration(tx, { organizationId: parameterOrganizationId(auth), projectId: frozen.projectId, configSetId: frozen.configSetId },
          restoration, { requestId: review.requestId, configRevisionId: successorConfigRevisionId, auditRef: auditEventId, derived: true }, pinned, property));
        continue;
      }
      const transfer = frozen.originTransfers?.find((row) => row.bindingId === entry.bindingId);
      const pinnedSnapshot = context.catalogSnapshots?.get(entry.catalogReleaseId) ?? snapshot;
      const binding = await loadBindingById(asValueClient(tx), entry.bindingId, "update");
      const old = await loadProjectValueById(asValueClient(tx), entry.oldValueId);
      if (!binding || !old || binding.organization_id !== parameterOrganizationId(auth)
        || binding.project_id !== frozen.projectId || binding.current_value_id !== entry.oldValueId
        || binding.source_occurrence_id !== entry.sourceOccurrenceId
        || !pinnedSnapshot || binding.catalog_release_id !== pinnedSnapshot.release.id
        || binding.definition_id !== entry.definitionId
        || binding.effective_revision_id !== entry.effectiveRevisionId
        || old.value_state !== "present"
        || old.value_digest !== entry.valueDigest) conflict("Surviving Binding base is stale.");
      const registration = await readSourceRegistrationAgreement(tx, {
        organizationId: parameterOrganizationId(auth), subjectId: binding.subject_id
      });
      if (registration?.id !== binding.registration_id
        || pinnedSnapshot.getDefinitionRevision({
          definitionId: ParameterDefinitionId(binding.definition_id),
          revisionId: DefinitionRevisionId(binding.effective_revision_id)
        }).status !== "found") conflict("Surviving Binding registration or Definition is unavailable.");
      const physicalFileId = transfer?.toFileId ?? entry.fileId;
      const memberIndex = frozen.members.findIndex((member) => member.fileId === physicalFileId);
      const physicalMember = frozen.members[memberIndex]!;
      const ownPin = await loadOwnedProjectValueSourcePin(tx, {
        organizationId: parameterOrganizationId(auth), projectId: frozen.projectId,
        bindingId: entry.bindingId, projectValueId: entry.oldValueId
      });
      if (memberIndex < 0 || !ownPin || ownPin.sourcePinId !== entry.sourcePinId
        || ownPin.configRevisionId !== frozen.configRevisionId
        || !["json-pointer", "dts-property"].includes(String(ownPin.locator.kind))) {
        conflict("Surviving Binding has no exact source locator.");
      }
      const property = ownPin.format === "dts" ? observed.find((row) => row.logicalNodeId === ownPin.logicalNodeId
        && row.fileId === physicalFileId && row.propertyKey === ownPin.locator.propertyName) : undefined;
      const payload = ownPin.format === "json" ? { kind: "json" as const, value: old.value as ContractJsonValue }
        : property ? rawTextToPayload(property.propertyKey, property.rawText) : null;
      if (!payload) conflict("移除后其他文件的参数身份或有效值发生变化。请先将依赖参数移至独立来源并重新预览。");
      const sourceValue = ownPin.format === "json" ? readJsonSourceValue(inspected.files[memberIndex]!.content,
        ownPin.locator.pointer as string, ownPin.rootPointer!) : payload.value;
      const valueDigest = digestProjectValuePayload(payload);
      if ((!transfer && old.value_digest !== valueDigest) || !same(sourceValue, payload.value)) {
        conflict("Surviving value differs from its exact source bytes.");
      }
      const definition = pinnedSnapshot.getDefinitionRevision({ definitionId: ParameterDefinitionId(entry.definitionId), revisionId: DefinitionRevisionId(entry.effectiveRevisionId) });
      if (definition.status !== "found") conflict("转移来源的参数定义不可用。");
      assertCanonicalValueConstraints(definition.revision, payload, true);
      const locator = property ? { kind: "dts-property", propertyOccurrenceId: property.propertyOccurrenceId,
        nodeOccurrenceId: property.nodeOccurrenceId, fileVersionId: physicalMember.fileVersionId, propertyName: property.propertyKey } : entry.locator;
      const sourceRef = transfer && property ? deriveDtsSourceRef({ fileName: physicalMember.sourceName, nodeLocator: property.locator }) : old.source_ref;
      const newValueId = deriveProjectValueId({
        bindingId: entry.bindingId, definitionRevisionId: DefinitionRevisionId(entry.effectiveRevisionId),
        sourceRef, configRevisionId: successorConfigRevisionId,
        valueKind: payload.kind, valueDigest, expectedTip: entry.oldValueId
      });
      const inserted = await insertProjectValue(asValueClient(tx), {
        id: newValueId, bindingId: entry.bindingId, definitionId: entry.definitionId,
        definitionRevisionId: entry.effectiveRevisionId, sourceRef,
        configRevisionId: successorConfigRevisionId, valueDigest, valueKind: payload.kind,
        valueJson: JSON.stringify(payload.value), valueState: "present"
      });
      if (!inserted) conflict("Surviving Value revision already exists.");
      const sourcePinId = randomUUID();
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,
         config_revision_id,file_id,file_version_id,format,locator,locator_digest,property_occurrence_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)`,
      [sourcePinId, newValueId, entry.bindingId, entry.definitionId,
        parameterOrganizationId(auth), frozen.projectId, entry.sourceOccurrenceId,
        successorConfigRevisionId, physicalFileId, physicalMember.fileVersionId,
        ownPin.format, JSON.stringify(locator), `sha256:${digest(serializeContract(locator))}`, property?.propertyOccurrenceId ?? null]);
      if (!await casCurrentTip(asValueClient(tx), {
        bindingId: entry.bindingId, expectedTip: entry.oldValueId, nextTip: newValueId,
        sourceCommitRequestId: review.requestId
      })) conflict("Surviving Binding lost its exact Value tip.");
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
        newValueId, sourcePinId, historyEventId, fileId: physicalFileId,
        fileVersionId: physicalMember.fileVersionId });
    }
    const removedBindings = frozen.cohort.filter((row) => row.fileId === frozen.fileId && !frozen.originTransfers?.some((transfer) => transfer.bindingId === row.bindingId))
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
        restoredParameters: frozen.restorations?.length ?? 0,
        reviewRequestId: review.requestId, submitterUserId: review.submitterUserId,
        proofDigest: frozen.proofDigest, applicationMode: direct ? "administrator_direct" : "separate_review", appliedByUserId: auth.user.id
      }, traceId: context.traceId
    });
    await tx.query("set local role parameter_governance_writer_role");
    await tx.query(`select parameter_catalog.insert_reviewed_member_tombstone(
      $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11)`,
    [tombstoneId, parameterOrganizationId(auth), frozen.projectId, frozen.configSetId,
      frozen.fileId, frozen.configRevisionId, frozen.fileVersionId,
      JSON.stringify(removedBindings), successorConfigRevisionId,
      JSON.stringify(successorBindings), auditEventId]);
    await tx.query("reset role");
    const detached = await tx.query(`update public.project_parameter_files
      set config_set_id=null,config_set_role=null,config_set_sort_order=0,updated_at=now()
      where id=$1 and organization_id=$2 and project_id=$3
        and config_set_id=$4 and current_version_id=$5`,
    [frozen.fileId, parameterOrganizationId(auth), frozen.projectId,
      frozen.configSetId, frozen.fileVersionId]);
    if (detached.rowCount !== 1) conflict("Removed file lost its exact membership or version.");
    if (frozen.newProperties?.length) {
      if (!snapshot) conflict("重新生效的参数缺少 Catalog 定义。");
      const propertyOccurrenceIds = frozen.newProperties.map((planned) => {
        const actual = observed.find((row) => row.fileId === planned.fileId && row.logicalNodeId === planned.logicalNodeId && row.propertyKey === planned.propertyName);
        if (!actual || !same(rawTextToPayload(actual.propertyKey, actual.rawText), planned.payload)) conflict("重新生效的参数与确认的预览不一致。");
        return actual.propertyOccurrenceId;
      });
      await syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, { organizationId: parameterOrganizationId(auth), projectId: frozen.projectId,
        configSetId: frozen.configSetId, configRevisionId: successorConfigRevisionId, propertyOccurrenceIds });
    }
    const approved = await tx.query(`update public.project_parameter_value_change_requests
      set status='approved',reviewer_user_id=$2,applied_at=now(),apply_outcome='committed',
        applied_audit_ref=$3,applied_file_version_ids='[]'::jsonb,
        applied_source_result=$4::jsonb,updated_at=now()
      where id=$1 and status='pending' and (assigned_to_user_id=$2 or (member_application_mode='administrator_direct' and submitter_user_id=$5))`,
    [review.requestId, direct ? null : auth.user.id, auditEventId,
      JSON.stringify({ tombstoneId, successorConfigRevisionId, ...(direct ? { successorBindings } : {}) }), auth.user.id]);
    if (approved.rowCount !== 1) conflict("Member removal review decision changed.");
    return { requestId: review.requestId, tombstoneId, successorConfigRevisionId, replayed: false };
  } catch (error) { rethrowSourceTransactionError(error); }
}
