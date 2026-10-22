import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution } from "../auth/trustedInvocation";
import { NormalizedConfigurationSchemaId, PropertyKey, type CatalogSnapshot } from "../catalog-kernel/interface";
import { resolveDtsConfigSet } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import { asValueClient, listObservedProperties, lockSourceCatalogGovernance, parseCompatibles, rawTextToPayload,
  resolveObservedSubject, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { appendProjectValue, loadOwnedProjectValueSourcePin, loadSourceBindingCohortReadOnly,
  lockSourceConfigurationBindings, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { assertCanonicalValueConstraints } from "../parameter-bindings/values/service";
import { deriveHistoryEventId } from "../parameter-bindings/values/repositories";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { CatalogSubjectId, DefinitionRevisionId, ParameterDefinitionId, ProjectValueId, type ContractJsonValue } from "../parameter-catalog-contract";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { ingestConfigRevisionInTransaction, prepareReviewedSourceContinuity, type ReviewedSourceContinuity } from "../parameter-topology/ingestService";
import { normalizeManifestLogicalPath } from "../parameter-topology/configRevisionManifest";
import { isStructuralPropertyKey } from "../parameter-topology/parameterSurface";
import { loadOrganizationCatalogSnapshot, lockOrganizationModuleRecognition } from "../parameter-modules/recognitionSettings";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import type { ConfigRevisionManifestMember, ConfigRevisionMemberRole } from "../parameter-topology/types";
import { getParameterFileCandidateByIdForUpdate } from "./candidateRepository";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { createDtsToolchainRunner, type DtsToolchainRunner } from "./dtsToolchain";
import { loadFormerRootOverlayFiles } from "./configSetSnapshot";
import { MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, readJsonSourceValue } from "./jsonSource";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import { freezeSourceRevisionRequest, loadSnapshot, loadSourceRevisionCatalogSnapshots, requireCurrentSourceAdministrator,
  sameSourceRevision, sourceRevisionDigest, type SourceRevisionTarget, type SourceRevisionNewProperty } from "./sourceRevisionService";
import { applySourceRestoration, matchingDeletedSourceAnchors, prepareSourceRestorations, sourceRestorationNodes, type SourceRestoration } from "./sourceRestoration";
import { ingestDtsFileVersion } from "./structuralIngest";
import { rethrowSourceTransactionError } from "./sourceVersion";
import type { ConfigSetRole } from "./types";

export type MemberAdditionInput = {
  projectId: string; configSetId: string; candidateId?: string; fileId?: string;
  role: ConfigSetRole; sortOrder: number;
  setAsRoot?: boolean;
  json?: { configurationSchemaId: string; rootPointer: string; mappings: Array<{ definitionId: string; pointer: string }> };
};
type Member = {
  fileId: string; fileVersionId: string; sourceName: string; format: "dts" | "json";
  role: string; sortOrder: number; checksum: string; sizeBytes: number;
};
type Cohort = Awaited<ReturnType<typeof loadSourceBindingCohortReadOnly>>[number] & {
  fileId: string; fileVersionId: string; format: "dts" | "json"; logicalNodeId: string | null;
  propertyName: string; locator: Record<string, ContractJsonValue>; rootPointer: string | null;
};
type NewProperty = SourceRevisionNewProperty;
type Proof = {
  kind: "member_addition"; organizationId: string; projectId: string; configSetId: string; setAsRoot?: boolean;
  candidateId: string | null; fileId: string; baseConfigRevisionId: string; baseDigest: string; proposedDigest: string;
  entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[];
  members: Member[]; cohort: Cohort[]; continuity: ReviewedSourceContinuity | null;
  targets: SourceRevisionTarget[]; newProperties: NewProperty[]; json: MemberAdditionInput["json"] | null;
  restorations?: SourceRestoration[];
  originTransfers: Array<{ bindingId: string; oldValueId: string; sourcePinId: string; fromFileId: string; toFileId: string }>;
  catalogRelease: { id: string; digest: string } | null; proofDigest: string;
};
export type MemberAdditionPreview = {
  proofToken: string; configSetId: string; fileName: string; format: "dts" | "json";
  members: Member[]; entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[];
  diagnostics: Array<{ severity: "error" | "warning"; code: string; message: string }>;
  impact: { parameterChanges: number; nodeAdditions: number; nodeRemovals: number; retainedBindings: number; sourceReplacements: number; restoredParameters?: number };
};
function conflict(message: string): never { throw new ApiError("CONFLICT", message, { reason: "configuration-addition-stale" }); }
function rootDiagnosticMessage(code: string, message: string, fileName?: string): string {
  const labels: Record<string, string> = {
    "include-cycle": "文件存在循环引用", "include-missing": "找不到引用文件", "path-escape": "引用路径超出当前配置",
    "label-duplicate": "节点标签重复", "target-unresolved": "找不到删除目标节点", "dangling-reference": "找不到覆盖目标节点",
    "source-proof-limit": "配置超过精确来源校验容量", "toolchain-unavailable": "DTS 校验工具不可用，请联系管理员检查工具链",
    "version-mismatch": "DTS 校验工具版本不匹配", "compile-failed": "DTS 编译失败，请检查文件语法与引用",
    "schema-failed": "DTS 规范校验失败", "timeout": "DTS 校验超时", "overlay-order": "覆盖文件顺序无效"
  };
  const references = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  return `${fileName ?? "配置"}：${labels[code] ?? "DTS 校验未通过"}${references.length ? `（${references.join("、")}）` : ""}。`;
}

async function inspect(tx: Database, storage: ObjectStore, auth: AuthContext, input: MemberAdditionInput,
  snapshot: CatalogSnapshot | null, snapshots: ReadonlyMap<string, CatalogSnapshot>, toolchain?: DtsToolchainRunner) {
  await lockOrganizationModuleRecognition(tx, auth.organization.id);
  if (snapshot) snapshot = await loadOrganizationCatalogSnapshot(tx, auth.organization.id, snapshot);
  const set = (await tx.query("select id from public.dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update nowait",
    [input.configSetId, auth.organization.id, input.projectId])).rows[0];
  if (!set) throw new ApiError("NOT_FOUND", "目标配置不存在或不属于当前项目。");
  await tx.query("select id from public.project_parameter_files where organization_id=$1 and project_id=$2 and (config_set_id=$3 or id=$4) order by id for update nowait",
    [auth.organization.id, input.projectId, input.configSetId, input.fileId ?? null]);
  const revision = (await tx.query<{ id: string; entry_file: string | null; include_search_paths: string[]; overlay_order: string[] }>(
    `select id,entry_file,include_search_paths,overlay_order from public.dts_config_revisions
     where organization_id=$1 and project_id=$2 and config_set_id=$3 and status='resolved' order by revision_number desc limit 1 for update nowait`,
    [auth.organization.id, input.projectId, input.configSetId])).rows[0];
  if (!revision) conflict("配置尚无可构建的当前来源版本，请先完成配置初始化。");
  const members = (await tx.query<Member & { storageKey: string; currentVersionId: string; currentRole: string; currentOrder: number }>(
    `select member.file_id as "fileId",member.file_version_id as "fileVersionId",member.source_name as "sourceName",file.format,
      member.role,member.sort_order as "sortOrder",version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey",
      file.current_version_id as "currentVersionId",file.config_set_role as "currentRole",file.config_set_sort_order as "currentOrder"
     from public.dts_config_revision_members member join public.project_parameter_files file on file.id=member.file_id
       and file.organization_id=$2 and file.project_id=$3 and file.config_set_id=$4
     join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=file.id
     where member.config_revision_id=$1 order by member.sort_order,member.file_id`,
    [revision.id, auth.organization.id, input.projectId, input.configSetId])).rows;
  const count = (await tx.query<{ count: number }>("select count(*)::int as count from public.project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3",
    [auth.organization.id, input.projectId, input.configSetId])).rows[0]?.count;
  if (!members.length || members.length !== count || members.some((row) => row.currentVersionId !== row.fileVersionId
    || (row.role === "include" ? "misc" : row.role) !== row.currentRole || row.sortOrder !== row.currentOrder)) conflict("当前配置成员已变化，请重新核对配置来源。");
  const candidate = input.candidateId ? await getParameterFileCandidateByIdForUpdate(tx, { organizationId: auth.organization.id,
    projectId: input.projectId, candidateId: input.candidateId }) : null;
  if (candidate?.status === "failed") throw new ApiError("VALIDATION_FAILED", "候选解析失败，请按诊断修正文件后重新上传；候选及当前配置会保留。", { diagnostics: candidate.diagnostics });
  if (input.candidateId && (!candidate || candidate.status !== "ready" || candidate.fileId || candidate.sourceRevisionContext
    || !candidate.storageKey || !candidate.checksum || candidate.sizeBytes === undefined)) conflict("请选择尚未激活、未绑定文件的上传候选；候选会保留以便修正。");
  const existing = input.fileId ? (await tx.query<{ id: string; fileName: string; format: "dts" | "json"; configSetId: string | null;
    fileVersionId: string; storageKey: string; checksum: string; sizeBytes: number }>(
    `select file.id,file.file_name as "fileName",file.format,file.config_set_id as "configSetId",version.id as "fileVersionId",
      version.storage_key as "storageKey",version.checksum,version.size_bytes::float8 as "sizeBytes"
     from public.project_parameter_files file join public.project_parameter_file_versions version on version.id=file.current_version_id and version.file_id=file.id
     where file.id=$1 and file.organization_id=$2 and file.project_id=$3`, [input.fileId, auth.organization.id, input.projectId])).rows[0] : null;
  if (input.fileId && !existing) throw new ApiError("NOT_FOUND", "待加入的项目文件或当前版本不存在。");
  if (input.setAsRoot) {
    if (input.candidateId || input.json || input.role !== "base" || existing?.format !== "dts"
      || existing.configSetId !== input.configSetId || !members.some((row) => row.fileId === existing.id && row.sourceName !== revision.entry_file)) {
      throw new ApiError("VALIDATION_FAILED", "请选择当前配置中尚未作为根文件的 DTS 文件。");
    }
  } else if (existing?.configSetId) conflict("该文件已属于一个配置，请先从原配置移除后再加入。");
  const target = candidate ? { fileId: `member_${candidate.id}`, fileVersionId: candidate.id, sourceName: candidate.fileName,
    format: candidate.format, storageKey: candidate.storageKey!, checksum: candidate.checksum!, sizeBytes: candidate.sizeBytes! }
    : existing ? { fileId: existing.id, fileVersionId: existing.fileVersionId,
      sourceName: input.setAsRoot ? members.find((row) => row.fileId === existing.id)!.sourceName : existing.fileName,
      format: existing.format, storageKey: existing.storageKey, checksum: existing.checksum, sizeBytes: existing.sizeBytes } : null;
  if (!target || !["dts", "json"].includes(target.format)) throw new ApiError("VALIDATION_FAILED", "请选择 DTS/JSON 候选或已有文件。");
  if (normalizeManifestLogicalPath(target.sourceName) !== target.sourceName || members.some((row) => row.sourceName === target.sourceName && (!input.setAsRoot || row.fileId !== target.fileId))) {
    conflict("文件来源名称不合法或与已有成员重名，请使用不同文件名重新上传。");
  }
  if (target.format === "json" && input.role === "overlay") throw new ApiError("VALIDATION_FAILED", "JSON 文件不能作为 DTS 覆盖层。");
  if (target.format !== "json" && input.json) throw new ApiError("VALIDATION_FAILED", "只有 JSON 文件可指定配置规范及字段映射。");
  if (!storage.getBounded) throw new ApiError("INTERNAL_ERROR", "Bounded source storage is required.");
  const contents = new Map<string, string>();
  for (const member of [...members, target]) {
    let bytes: Buffer;
    try { bytes = await storage.getBounded(member.storageKey, MAX_PARAMETER_SOURCE_BYTES); }
    catch { conflict(`来源文件 ${member.sourceName} 不可读取，请恢复文件后重新预览；当前配置未改变。`); }
    if (bytes.length !== member.sizeBytes || sourceRevisionDigest(bytes) !== member.checksum.replace(/^sha256:/, "")) conflict("来源文件校验失败，未改变当前配置。");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new ApiError("VALIDATION_FAILED", "来源文件必须为有效 UTF-8 文本，请重新上传。"); }
    if (member.format === "json") parseJsonSource(text);
    contents.set(member.fileId, text);
  }
  let afterMembers: Member[] = [...members.map(({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes }) =>
    ({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes })),
  ...(!input.setAsRoot ? [{ fileId: target.fileId, fileVersionId: target.fileVersionId, sourceName: target.sourceName, format: target.format,
    role: input.role, sortOrder: input.sortOrder, checksum: target.checksum, sizeBytes: target.sizeBytes }] : [])].sort((a, b) => a.sortOrder - b.sortOrder || a.fileId.localeCompare(b.fileId));
  if (input.setAsRoot) {
    const oldRoot = afterMembers.find((row) => row.format === "dts" && row.role === "base" && row.sourceName === revision.entry_file);
    if (!oldRoot || afterMembers.filter((row) => row.format === "dts" && row.role === "base").length !== 1) conflict("当前配置缺少唯一有效根文件，请重新核对来源。");
    const overlays = [oldRoot.sourceName, ...[...new Set([...revision.overlay_order,
      ...afterMembers.filter((row) => row.format === "dts" && row.role === "overlay").map((row) => row.sourceName)])]
      .filter((name) => name !== target.sourceName && name !== oldRoot.sourceName)];
    afterMembers = afterMembers.map((row) => row.fileId === target.fileId ? { ...row, role: "base", sortOrder: 0 }
      : overlays.includes(row.sourceName) && row.format === "dts" ? { ...row, role: "overlay", sortOrder: overlays.indexOf(row.sourceName) + 1 } : row)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.fileId.localeCompare(b.fileId));
  }
  const dts = afterMembers.filter((row) => row.format === "dts");
  const entryFile = input.setAsRoot ? target.sourceName : revision.entry_file ?? dts.find((row) => row.role === "base")?.sourceName ?? null;
  const includeSearchPaths = revision.include_search_paths?.length ? revision.include_search_paths : ["."];
  const overlayOrder = afterMembers.filter((row) => row.format === "dts" && row.role === "overlay").map((row) => row.sourceName);
  let continuity: ReviewedSourceContinuity | null = null;
  let resolved: ReturnType<typeof resolveDtsConfigSet> | null = null;
  const diagnostics: MemberAdditionPreview["diagnostics"] = [];
  const restorationScope = { organizationId: auth.organization.id, projectId: input.projectId, configSetId: input.configSetId };
  let anchors: Awaited<ReturnType<typeof matchingDeletedSourceAnchors>> = [];
  if (target.format === "json" && !input.json) diagnostics.push({ severity: "warning", code: "json-unregistered",
    message: "JSON 文件已校验；未登记为参数，将产生 0 个新 Binding。" });
  if (dts.length) {
    if (!entryFile || dts.filter((row) => row.role === "base").length !== 1
      || !dts.some((row) => row.sourceName === entryFile && row.role === "base")) conflict("DTS 配置需要唯一可用的基础入口，请检查文件用途。");
    const files = new Map(dts.map((row) => [row.sourceName, { content: contents.get(row.fileId)!, fileVersionId: row.fileVersionId }]));
    resolved = resolveDtsConfigSet({ entryFile, includeSearchPaths, overlayOrder, requireExactOrigins: true, files });
    diagnostics.push(...resolved.diagnostics.map(({ severity, code, message, fileName }) => ({ severity, code,
      message: input.setAsRoot ? rootDiagnosticMessage(code, message, fileName) : message })));
    if (diagnostics.some((row) => row.severity === "error" || /dangling|unresolved/.test(row.code))) {
      throw new ApiError("VALIDATION_FAILED", "配置包含未解决的 include/overlay 引用，请修正候选后重试。", { diagnostics });
    }
    const formerRootOverlayFiles = await loadFormerRootOverlayFiles(tx, input.configSetId, afterMembers, overlayOrder);
    const validated = await (toolchain ?? createDtsToolchainRunner()).validate({ entryFile, includeSearchPaths, overlayOrder, files, formerRootOverlayFiles }, { mode: "release" });
    diagnostics.push(...validated.diagnostics.map((row) => ({ severity: row.severity, code: row.code ?? "toolchain",
      message: input.setAsRoot ? rootDiagnosticMessage(row.code ?? "toolchain", row.message,
        `${row.file}${row.line ? `，第 ${row.line} 行` : ""}`) : row.message })));
    if (!validated.ok || validated.mode !== "release") throw new ApiError("VALIDATION_FAILED", "DTS 工具链未通过，当前组成未改变。", { diagnostics });
    anchors = await matchingDeletedSourceAnchors(tx, restorationScope, resolved.effective.nodesByLocator, afterMembers);
    continuity = await prepareReviewedSourceContinuity(tx, { organizationId: auth.organization.id, projectId: input.projectId,
      configSetId: input.configSetId, baseConfigRevisionId: revision.id, effectiveNodes: resolved.effective.nodesByLocator,
      sourceDigest: sourceRevisionDigest(afterMembers), restorationNodes: sourceRestorationNodes(anchors) });
  }
  const cohort: Cohort[] = [], targets: SourceRevisionTarget[] = [], newProperties: NewProperty[] = [], originTransfers: Proof["originTransfers"] = [];
  for (const entry of await loadSourceBindingCohortReadOnly(tx, { organizationId: auth.organization.id, projectId: input.projectId, configSetId: input.configSetId })) {
    const pin = await loadOwnedProjectValueSourcePin(tx, { organizationId: auth.organization.id, projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (!pin || pin.configRevisionId !== revision.id || pin.valueState !== "present" || !members.some((row) => row.fileId === pin.fileId && row.fileVersionId === pin.fileVersionId)) conflict("参数来源已变化，请重新预览。");
    const old = await readOwnedProjectValueIdentity(tx, { organizationId: auth.organization.id, projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    const current = await readOwnedCurrentBinding(tx, { organizationId: auth.organization.id, projectId: input.projectId, bindingId: entry.bindingId });
    const pinned = snapshots.get(entry.catalogReleaseId);
    const definition = pinned?.getDefinitionRevision({ definitionId: ParameterDefinitionId(entry.definitionId), revisionId: DefinitionRevisionId(entry.effectiveRevisionId) });
    if (!old || current.status !== "current" || !definition || definition.status !== "found"
      || (await readSourceRegistrationAgreement(tx, { organizationId: auth.organization.id, subjectId: current.binding.subjectId }))?.id !== current.binding.registrationId) conflict("参数定义或登记已变化，请重新预览。");
    const propertyName = typeof pin.locator.propertyName === "string" ? pin.locator.propertyName : "";
    cohort.push({ ...entry, fileId: pin.fileId, fileVersionId: pin.fileVersionId, format: pin.format,
      logicalNodeId: pin.logicalNodeId, propertyName, locator: pin.locator, rootPointer: pin.rootPointer });
    if (pin.format === "json") {
      if (typeof pin.locator.pointer !== "string" || !sameSourceRevision(readJsonSourceValue(contents.get(pin.fileId)!, pin.locator.pointer, pin.rootPointer ?? ""), old.value.payload.value)) conflict("JSON 参数与其当前文件不一致。");
      continue;
    }
    const logical = continuity?.nodes.find((row) => row.logicalNodeId === pin.logicalNodeId);
    const node = logical && resolved?.effective.nodesByLocator.get(logical.nodeLocator);
    const property = node?.properties.get(propertyName);
    const origin = afterMembers.find((row) => row.sourceName === property?.sourceChain.at(-1)?.fileName);
    if (node && !node.deleted && snapshot && resolveObservedSubject(snapshot, {
      compatibles: parseCompatibles(node.properties.get("compatible")?.rawText ?? null), nodeName: node.name
    })?.subjectId !== current.binding.subjectId) conflict("当前节点识别与已有参数关联不一致，请先完成身份核对后重新预览。");
    if (!property || property.deleted || node?.deleted || !origin) {
      targets.push({ bindingId: entry.bindingId, action: "delete", payload: old.value.payload, afterFileId: pin.fileId, propertyName });
    } else {
      const payload = rawTextToPayload(propertyName, property.rawText);
      assertCanonicalValueConstraints(definition.revision, payload, true);
      if (!sameSourceRevision(payload, old.value.payload) || origin.fileId !== pin.fileId) targets.push({ bindingId: entry.bindingId, action: "set", payload, afterFileId: origin.fileId, propertyName });
      if (origin.fileId !== pin.fileId) originTransfers.push({ bindingId: entry.bindingId, oldValueId: entry.oldValueId,
        sourcePinId: pin.sourcePinId, fromFileId: pin.fileId, toFileId: origin.fileId });
    }
  }
  if (snapshot && resolved && continuity) for (const node of resolved.effective.nodesByLocator.values()) {
    if (node.deleted) continue;
    const subject = resolveObservedSubject(snapshot, { compatibles: parseCompatibles(node.properties.get("compatible")?.rawText ?? null), nodeName: node.name });
    const registration = subject && await readSourceRegistrationAgreement(tx, { organizationId: auth.organization.id, subjectId: subject.subjectId });
    if (!subject || !registration) continue;
    const logical = continuity.nodes.find((row) => row.nodeLocator === node.nodeLocator)!;
    for (const [name, property] of node.properties) {
      if (property.deleted || isStructuralPropertyKey(name)) continue;
      const member = afterMembers.find((row) => row.sourceName === property.sourceChain.at(-1)?.fileName);
      const definition = snapshot.getDefinition({ subjectId: CatalogSubjectId(subject.subjectId), propertyKey: PropertyKey(name) });
      if (!member || definition.status !== "found" || cohort.some((entry) => entry.logicalNodeId === logical.logicalNodeId && entry.propertyName === name)) continue;
      const payload = rawTextToPayload(name, property.rawText); assertCanonicalValueConstraints(definition.definition.selectedRevision, payload, true);
      newProperties.push({ fileId: member.fileId, logicalNodeId: logical.logicalNodeId, nodeLocator: node.nodeLocator, propertyName: name,
        definitionId: definition.definition.id, definitionRevisionId: definition.definition.selectedRevision.id,
        registrationId: registration.id, subjectId: subject.subjectId, payload });
    }
  }
  const restorations = await prepareSourceRestorations(tx, restorationScope, newProperties, anchors, snapshots);
  for (const restored of restorations) {
    cohort.push({ ...restored, format: "dts", locator: restored.locator as Record<string, ContractJsonValue>, rootPointer: null });
    targets.push({ bindingId: restored.bindingId, action: "set", payload: restored.payload, afterFileId: restored.fileId, propertyName: restored.propertyName });
  }
  if (input.json) {
    if (!snapshot) conflict("JSON 参数登记需要已发布的配置规范。");
    const subject = snapshot.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "absent" }, configurationSchemaIds: [NormalizedConfigurationSchemaId(input.json.configurationSchemaId)] });
    if (subject.status !== "matched" || subject.subject.kind !== "configuration-schema"
      || !await readSourceRegistrationAgreement(tx, { organizationId: auth.organization.id, subjectId: subject.subject.id })) conflict("请选择当前组织已登记的配置规范。");
    if (!input.json.mappings.length || new Set(input.json.mappings.map((row) => row.definitionId)).size !== input.json.mappings.length) throw new ApiError("VALIDATION_FAILED", "JSON 字段需明确、唯一的参数定义映射。");
    readJsonSourceValue(contents.get(target.fileId)!, input.json.rootPointer);
    for (const mapping of input.json.mappings) {
      const definition = snapshot.getDefinitionById(ParameterDefinitionId(mapping.definitionId));
      if (definition.status !== "found" || definition.definition.subjectId !== subject.subject.id) conflict("JSON 映射中的参数不属于选定配置规范。");
      assertCanonicalValueConstraints(definition.definition.selectedRevision, { kind: "json", value: readJsonSourceValue(contents.get(target.fileId)!, mapping.pointer, input.json.rootPointer) as ContractJsonValue });
    }
  }
  const facts = { kind: "member_addition" as const, organizationId: auth.organization.id, projectId: input.projectId, configSetId: input.configSetId,
    ...(input.setAsRoot ? { setAsRoot: true } : {}),
    candidateId: candidate?.id ?? null, fileId: target.fileId, baseConfigRevisionId: revision.id,
    baseDigest: sourceRevisionDigest(members.map(({ storageKey: _storage, currentVersionId: _version, currentRole: _role, currentOrder: _order, ...row }) => row)),
    proposedDigest: target.checksum.replace(/^sha256:/, ""), entryFile, includeSearchPaths, overlayOrder,
    members: afterMembers, cohort, continuity, targets, newProperties, ...(restorations.length ? { restorations } : {}), originTransfers, json: input.json ?? null,
    catalogRelease: snapshot ? { id: snapshot.release.id, digest: snapshot.release.digest } : null };
  const proof: Proof = { ...facts, proofDigest: sourceRevisionDigest(facts) };
  const beforeNodes = (await tx.query<{ id: string }>("select logical_node_id as id from public.dts_logical_node_revisions where config_revision_id=$1", [revision.id])).rows;
  const preview: MemberAdditionPreview = { proofToken: proof.proofDigest, configSetId: input.configSetId, fileName: target.sourceName, format: target.format,
    members: afterMembers, entryFile, includeSearchPaths, overlayOrder, diagnostics,
    impact: { parameterChanges: targets.length + newProperties.length + (input.json?.mappings.length ?? 0),
      nodeAdditions: continuity?.nodes.filter((node) => !beforeNodes.some((row) => row.id === node.logicalNodeId)).length ?? 0,
      nodeRemovals: beforeNodes.filter((row) => !continuity?.nodes.some((node) => node.logicalNodeId === row.id)).length,
      retainedBindings: cohort.length - targets.filter((row) => row.action === "delete").length - restorations.length,
      sourceReplacements: originTransfers.length, restoredParameters: restorations.length } };
  return { proof, preview, contents, candidate, target };
}

export async function previewCanonicalMemberAddition(db: Database, storage: ObjectStore, auth: AuthContext, input: MemberAdditionInput,
  security: CanonicalSourceSecurityContext, options: { toolchain?: DtsToolchainRunner } = {}): Promise<MemberAdditionPreview> {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "configuration member addition preview", targetType: "dts-config-set", targetId: input.configSetId });
  const snapshot = await loadSnapshot(db), snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, auth.organization.id, snapshot);
  try { return await db.transaction(async (tx) => {
    auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
    return (await inspect(tx, storage, auth, input, snapshot, snapshots, options.toolchain)).preview;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}

export async function applyCanonicalMemberAddition(db: Database, storage: ObjectStore, auth: AuthContext,
  input: MemberAdditionInput & { proofToken: string; reason: string; clientMutationId: string }, security: CanonicalSourceSecurityContext,
  options: { toolchain?: DtsToolchainRunner } = {}) {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "configuration member addition apply", targetType: "dts-config-set", targetId: input.configSetId });
  const snapshot = await loadSnapshot(db), snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, auth.organization.id, snapshot);
  try { return await db.transaction(async (tx) => {
    auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`member-addition:${auth.organization.id}:${input.projectId}:${auth.user.id}:${input.clientMutationId}`]);
    const mutationDigest = sourceRevisionDigest(input);
    const replay = (await tx.query<{ request_kind: string; source_revision_mutation_digest: string; applied_source_result: { requestId: string; fileId: string; fileVersionId: string; configRevisionId: string } }>(
      `select request_kind,source_revision_mutation_digest,applied_source_result from public.project_parameter_value_change_requests
       where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and source_revision_mutation_id=$4`,
      [auth.organization.id, input.projectId, auth.user.id, input.clientMutationId])).rows[0];
    if (replay) { if (replay.request_kind !== "member_addition" || replay.source_revision_mutation_digest !== mutationDigest || !replay.applied_source_result) conflict("此操作编号已用于不同的来源操作。"); return replay.applied_source_result; }
    const current = await lockSourceCatalogGovernance(tx, auth.organization.id);
    if (snapshot ? current?.id !== snapshot.release.id || current.digest !== snapshot.release.digest : current) conflict("参数目录已变化，请重新预览。");
    const inspected = await inspect(tx, storage, auth, input, snapshot, snapshots, options.toolchain);
    const { proof, contents, candidate, target } = inspected;
    if (proof.proofDigest !== input.proofToken) conflict("预览已过期，未改变当前配置；请重新预览。");
    for (const node of proof.continuity?.nodes ?? []) await assertTrustedSensitiveNodeWriteAllowed(tx, auth, {
      organizationId: auth.organization.id, projectId: input.projectId, nodePath: node.nodeLocator,
      sourcePath: { kind: "node-locator", value: node.nodeLocator }, compatible: node.compatible ?? null,
      compatibleIsAuthoritative: true, invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink });
    await lockSourceConfigurationBindings(tx, { organizationId: auth.organization.id, projectId: input.projectId, configSetId: input.configSetId });
    if (candidate) {
      await insertProjectParameterFile(tx, { id: target.fileId, organizationId: auth.organization.id, projectId: input.projectId,
        fileName: target.sourceName, format: target.format, enabled: true });
      await tx.query("update public.project_parameter_file_candidates set file_id=$2 where id=$1 and status='ready' and file_id is null", [candidate.id, target.fileId]);
    }
    const requestId = await freezeSourceRevisionRequest(tx, auth, proof, { projectId: input.projectId, reason: input.reason,
      assignedToUserId: null, clientMutationId: input.clientMutationId }, mutationDigest, "administrator_direct");
    const attribution = trustedDomainAttribution(security.invocation);
    let fileVersionId = target.fileVersionId;
    if (candidate) {
      const version = await insertFileVersion(tx, { id: randomUUID(), fileId: target.fileId, versionNumber: 1, storageKey: target.storageKey,
        checksum: target.checksum, sizeBytes: target.sizeBytes, parsedIndex: candidate.parsedIndex, origin: "upload", attribution });
      fileVersionId = version.id;
      await setCurrentVersion(tx, { fileId: target.fileId, versionId: fileVersionId });
      if (target.format === "dts") await ingestDtsFileVersion(tx, fileVersionId, contents.get(target.fileId)!);
    }
    if (input.setAsRoot) {
      for (const member of proof.members) {
        const updated = await tx.query(`update public.project_parameter_files set config_set_role=$4,config_set_sort_order=$5,updated_at=now()
          where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$6 and current_version_id=$7`,
        [member.fileId, auth.organization.id, input.projectId, member.role === "include" ? "misc" : member.role, member.sortOrder, input.configSetId, member.fileVersionId]);
        if (updated.rowCount !== 1) conflict("配置成员已变化，根文件切换已回滚。");
      }
    } else {
      const attached = await tx.query(`update public.project_parameter_files set config_set_id=$2,config_set_role=$3,config_set_sort_order=$4,updated_at=now()
      where id=$1 and organization_id=$5 and project_id=$6 and config_set_id is null and current_version_id=$7`,
    [target.fileId, input.configSetId, input.role, input.sortOrder, auth.organization.id, input.projectId, fileVersionId]);
    if (attached.rowCount !== 1) conflict("文件归属或版本已变化，所有变更已回滚。");
    }
    const members: ConfigRevisionManifestMember[] = proof.members.map((member) => ({ ...member, fileName: member.sourceName,
      fileVersionId: member.fileId === target.fileId ? fileVersionId : member.fileVersionId,
      role: member.role as ConfigRevisionMemberRole, content: contents.get(member.fileId)! }));
    let revisionId: string;
    if (proof.entryFile && proof.continuity) {
      const revision = await ingestConfigRevisionInTransaction(tx, { organizationId: auth.organization.id, projectId: input.projectId,
        configSetId: input.configSetId, entryFile: proof.entryFile, includeSearchPaths: proof.includeSearchPaths,
        overlayOrder: proof.overlayOrder, members }, auth, { createdByUserId: auth.user.id, domain: attribution }, { reviewedSource: proof.continuity });
      if (revision.status !== "resolved") conflict("文件组成无法构建，所有变更已回滚。");
      revisionId = revision.id;
    } else {
      revisionId = randomUUID();
      await insertConfigRevision(tx, { id: revisionId, organizationId: auth.organization.id, projectId: input.projectId,
        configSetId: input.configSetId, revisionNumber: await nextConfigRevisionNumber(tx, input.configSetId), status: "resolved", attribution });
      await insertConfigRevisionMembers(tx, revisionId, members);
    }
    const observed = await listObservedProperties(asValueClient(tx), revisionId), auditRef = randomUUID(), results = [];
    for (const entry of proof.cohort) {
      const restoration = proof.restorations?.find((row) => row.bindingId === entry.bindingId);
      if (restoration) {
        const property = observed.find((row) => row.fileId === restoration.fileId && row.logicalNodeId === restoration.logicalNodeId && row.propertyKey === restoration.propertyName);
        const pinned = snapshots.get(restoration.catalogReleaseId);
        if (!property || !pinned) conflict("恢复参数缺少实际来源或固定定义，所有变更已回滚。");
        const restored = await applySourceRestoration(tx, { organizationId: auth.organization.id, projectId: input.projectId, configSetId: input.configSetId }, restoration,
          { requestId, configRevisionId: revisionId, auditRef }, pinned, property);
        results.push({ ...restored, kind: "changed" });
        await tx.query(`update public.project_parameter_value_change_targets set applied_value_id=$3,applied_history_event_id=$4,
          applied_source_pin_id=$5,applied_file_version_id=$6 where request_id=$1 and binding_id=$2`,
        [requestId,entry.bindingId,restored.newValueId,restored.historyEventId,restored.sourcePinId,restored.fileVersionId]);
        continue;
      }
      const currentBinding = await readOwnedCurrentBinding(tx, { organizationId: auth.organization.id, projectId: input.projectId, bindingId: entry.bindingId, lock: true });
      const old = await readOwnedProjectValueIdentity(tx, { organizationId: auth.organization.id, projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
      const pinned = snapshots.get(entry.catalogReleaseId);
      if (!old || currentBinding.status !== "current" || currentBinding.binding.currentValueId !== entry.oldValueId || !pinned) conflict("参数当前值已变化，所有变更已回滚。");
      const change = proof.targets.find((row) => row.bindingId === entry.bindingId), deleted = change?.action === "delete";
      const afterFileId = change?.afterFileId ?? entry.fileId;
      const afterFileVersionId = afterFileId === target.fileId ? fileVersionId : proof.members.find((member) => member.fileId === afterFileId)!.fileVersionId;
      const property = entry.format === "dts" && !deleted ? observed.find((row) => row.fileId === afterFileId && row.logicalNodeId === entry.logicalNodeId && row.propertyKey === entry.propertyName) : null;
      if (entry.format === "dts" && !deleted && !property) conflict("参数来源未完整生成，所有变更已回滚。");
      const payload = change?.payload ?? old.value.payload;
      const appended = await appendProjectValue(asValueClient(tx), { snapshot: pinned, binding: { ...currentBinding.binding, catalogRelease: pinned.release },
        definitionRevisionId: currentBinding.binding.effectiveRevisionId, expectedTip: ProjectValueId(entry.oldValueId),
        source: { sourceRef: old.value.source.sourceRef, configRevisionId: revisionId }, payload,
        valueState: deleted ? "deleted" : "present", sourceCommit: { requestId, auditRef, derived: !change } });
      if (!appended.ok) conflict(`参数同步失败：${appended.error.kind}；所有变更已回滚。`);
      const locator = entry.format === "json" ? entry.locator : deleted ? { kind: "dts-source-absence",
        basePropertyOccurrenceId: entry.locator.propertyOccurrenceId, baseNodeOccurrenceId: entry.locator.nodeOccurrenceId,
        baseFileVersionId: entry.fileVersionId, fileVersionId: entry.fileVersionId, propertyName: entry.propertyName, logicalNodeId: entry.logicalNodeId! }
        : { kind: "dts-property", propertyOccurrenceId: property!.propertyOccurrenceId, nodeOccurrenceId: property!.nodeOccurrenceId,
          fileVersionId: afterFileVersionId, propertyName: entry.propertyName };
      const sourcePinId = randomUUID();
      const baseMember = proof.members.find((member) => member.fileId === entry.fileId)!;
      const deletionProof = deleted ? { kind: "dts-source-absence-v1", scannerVersion: "dts-config-v1",
        beforeValueDigest: old.value.valueDigest.startsWith("sha256:") ? old.value.valueDigest : `sha256:${old.value.valueDigest}`,
        beforeSourceDigest: `sha256:${baseMember.checksum.replace(/^sha256:/, "")}`, afterSourceDigest: `sha256:${baseMember.checksum.replace(/^sha256:/, "")}` } : null;
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,
         format,property_occurrence_id,locator,locator_digest,value_state,base_source_pin_id,delete_request_id,delete_proof)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18::jsonb)`,
        [sourcePinId, appended.value.currentTip, entry.bindingId, entry.definitionId, auth.organization.id, input.projectId,
          entry.sourceOccurrenceId, revisionId, afterFileId, afterFileVersionId, entry.format, property?.propertyOccurrenceId ?? null,
          JSON.stringify(locator), `sha256:${sourceRevisionDigest(locator)}`, deleted ? "deleted" : "present", deleted ? entry.sourcePinId : null,
          deleted ? requestId : null, deletionProof ? JSON.stringify(deletionProof) : null]);
      const historyEventId = deriveHistoryEventId({ bindingId: entry.bindingId, oldCurrentValueId: entry.oldValueId, newCurrentValueId: appended.value.currentTip });
      results.push({ bindingId: entry.bindingId, oldValueId: entry.oldValueId, newValueId: appended.value.currentTip, sourcePinId,
        historyEventId, kind: deleted ? "deleted" : change ? "changed" : "derived" });
      if (change) await tx.query(`update public.project_parameter_value_change_targets set applied_value_id=$3,applied_history_event_id=$4,
        applied_source_pin_id=$5,applied_file_version_id=$6 where request_id=$1 and binding_id=$2`,
      [requestId, entry.bindingId, appended.value.currentTip, historyEventId, sourcePinId, afterFileVersionId]);
    }
    if (snapshot && proof.newProperties.length) await syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), snapshot, {
      organizationId: auth.organization.id, projectId: input.projectId, configSetId: input.configSetId, configRevisionId: revisionId,
      propertyOccurrenceIds: proof.newProperties.map((planned) => {
        const actual = observed.find((row) => row.fileId === planned.fileId && row.logicalNodeId === planned.logicalNodeId && row.propertyKey === planned.propertyName);
        if (!actual || !sameSourceRevision(rawTextToPayload(actual.propertyKey, actual.rawText), planned.payload)) conflict("新增参数与预览不一致。");
        return actual.propertyOccurrenceId;
      }) });
    if (proof.json && snapshot) await registerCanonicalJsonSource(tx, storage, auth, snapshot, { projectId: input.projectId,
      configSetId: input.configSetId, fileId: target.fileId, fileVersionId, ...proof.json,
      invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink });
    const receipt = { requestId, configRevisionId: revisionId, fileId: target.fileId, fileVersionId, sourceRevisionProofDigest: proof.proofDigest, results };
    await writeTrustedAuditEventInTx(asAuditTx(tx), { id: auditRef, invocation: security.invocation, app: "parameters", kind: "parameter-topology-governance",
      action: "value-change-applied", severity: "Medium", projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: requestId,
      metadata: { applicationMode: "administrator_direct", appliedByUserId: auth.user.id, requestKind: "member_addition", operation: input.setAsRoot ? "set_root" : "add_member",
        restoredParameters: proof.restorations?.length ?? 0, configSetId: input.configSetId, result: receipt }, traceId: security.requestId });
    if (candidate) await tx.query("update public.project_parameter_file_candidates set status='active',activated_at=now(),activated_by_user_id=$2,activated_version_id=$3 where id=$1 and status='ready'",
      [candidate.id, auth.user.id, fileVersionId]);
    await tx.query(`update public.project_parameter_value_change_requests set status='approved',apply_outcome='committed',applied_at=now(),
      applied_audit_ref=$2,applied_file_version_ids=$3::jsonb,applied_source_result=$4::jsonb,updated_at=now() where id=$1 and status='pending'`,
    [requestId, auditRef, JSON.stringify([fileVersionId]), JSON.stringify(receipt)]);
    return receipt;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}
