import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { CatalogSnapshot } from "../catalog-kernel/interface";
import { resolveDtsConfigSet } from "../dts";
import type { ObjectStore } from "../logs/objectStore";
import { asValueClient, listObservedProperties, lockSourceCatalogGovernance, parseCompatibles, rawTextToPayload, resolveObservedSubject } from "../parameter-bindings/catalogProjectValueSync";
import { appendProjectValue, loadConfigurationRestoreCohort, loadOwnedProjectValueSourcePin, lockSourceConfigurationBindings, readOwnedCurrentBinding, readOwnedProjectValueIdentity } from "../parameter-bindings/values";
import { deriveHistoryEventId } from "../parameter-bindings/values/repositories";
import { assertCanonicalValueConstraints } from "../parameter-bindings/values/service";
import { readSourceRegistrationAgreement } from "../parameter-bindings/binding";
import { DefinitionRevisionId, ParameterDefinitionId, ProjectValueId, type ContractJsonValue } from "../parameter-catalog-contract";
import { ingestConfigRevisionInTransaction, prepareReviewedSourceContinuity, type ReviewedSourceContinuity } from "../parameter-topology/ingestService";
import { insertConfigRevision, insertConfigRevisionMembers, nextConfigRevisionNumber } from "../parameter-topology/repository";
import type { ConfigRevisionMemberRole } from "../parameter-topology/types";
import { loadOrganizationCatalogSnapshot, lockOrganizationModuleRecognition } from "../parameter-modules/recognitionSettings";
import { createDtsToolchainRunner } from "./dtsToolchain";
import { MAX_PARAMETER_SOURCE_BYTES, parseJsonSource, readJsonSourceValue } from "./jsonSource";
import { freezeSourceRevisionRequest, loadSnapshot, loadSourceRevisionCatalogSnapshots, requireCurrentSourceAdministrator, sameSourceRevision, sourceRevisionDigest } from "./sourceRevisionService";
import { requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { insertFileVersion } from "./repository";
import { ingestDtsFileVersion } from "./structuralIngest";
import { rethrowSourceTransactionError } from "./sourceVersion";
import type { ParsedIndex } from "./types";

export type BaselineSourceSnapshot = { configRevisionId: string; sourcePinCount: number };
type Member = { fileId: string; fileVersionId: string; sourceName: string; format: "dts" | "json";
  role: ConfigRevisionMemberRole; sortOrder: number; checksum: string; sizeBytes: number; storageKey: string;
  versionNumber: number; parsedIndex: ParsedIndex; currentVersionId: string | null; currentConfigSetId: string | null;
  currentRole: string | null; currentOrder: number };
type Revision = { id: string; revision_number: number; entry_file: string | null; include_search_paths: string[]; overlay_order: string[] };
export type CanonicalRestorePreview = {
  canRestore: boolean; proofToken?: string; sourceConfigRevisionId?: string;
  missingInformation: string[]; historicalRevisions: Array<{ id: string; revisionNumber: number }>;
  editorHref: string; requiresCompositionConfirmation: boolean;
  members: Array<{ fileId: string; fileName: string; fromVersionId: string | null; toVersionId: string;
    versionNumber: number; role: string; sortOrder: number; action: "restore" | "reattach" | "retain-added" | "unchanged"; compositionChanged: boolean }>;
  entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[];
  impact: { parameterChanges: number; retainedBindings: number; restoredBindings: number; sourceReplacements: number };
};
function conflict(message: string): never { throw new ApiError("CONFLICT", message, { reason: "configuration-restore-stale" }); }

async function revisionMembers(tx: Queryable, auth: AuthContext, projectId: string, configSetId: string, revisionId: string): Promise<Member[]> {
  return (await tx.query<Member>(`select member.file_id as "fileId",member.file_version_id as "fileVersionId",
    member.source_name as "sourceName",file.format,member.role,member.sort_order as "sortOrder",
    version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey",
    version.version_number as "versionNumber",version.parsed_index as "parsedIndex",
    file.current_version_id as "currentVersionId",file.config_set_id as "currentConfigSetId",
    file.config_set_role as "currentRole",file.config_set_sort_order as "currentOrder"
    from public.dts_config_revisions revision
    join public.dts_config_revision_members member on member.config_revision_id=revision.id
    join public.project_parameter_files file on file.id=member.file_id and file.organization_id=revision.organization_id and file.project_id=revision.project_id
    join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=file.id
    where revision.id=$1 and revision.organization_id=$2 and revision.project_id=$3 and revision.config_set_id=$4
    order by member.sort_order,member.file_id`, [revisionId,auth.organization.id,projectId,configSetId])).rows;
}

/** Capture only an actually persisted complete source composition; legacy sets
 * keep their legacy baseline, with explicit missing-information diagnostics. */
export async function captureBaselineSourceSnapshot(tx: Queryable, auth: AuthContext, projectId: string, configSetId: string): Promise<BaselineSourceSnapshot | null> {
  const canonical = (await tx.query(`select id from parameter_catalog.project_parameter_source_occurrences
    where organization_id=$1 and project_id=$2 and config_set_id=$3 limit 1`, [auth.organization.id,projectId,configSetId])).rows.length > 0;
  if (!canonical) return null;
  const revision = (await tx.query<Revision>(`select * from public.dts_config_revisions where organization_id=$1 and project_id=$2
    and config_set_id=$3 and status='resolved' order by revision_number desc limit 1`, [auth.organization.id,projectId,configSetId])).rows[0];
  if (!revision) conflict("当前规范配置没有完整来源修订，请先在配置编辑器完成配置构建。");
  const members = await revisionMembers(tx,auth,projectId,configSetId,revision.id);
  const count = (await tx.query<{ count: number }>(`select count(*)::int as count from public.project_parameter_files
    where organization_id=$1 and project_id=$2 and config_set_id=$3`,[auth.organization.id,projectId,configSetId])).rows[0]!.count;
  if (!members.length || members.length !== count || members.some((row) => row.currentVersionId !== row.fileVersionId
    || row.currentConfigSetId !== configSetId || row.currentRole !== (row.role === "include" ? "misc" : row.role)
    || row.currentOrder !== row.sortOrder || !row.sourceName)) conflict("当前文件与完整来源修订不一致，请先在配置编辑器重新构建后保存快照。");
  const cohort = await loadConfigurationRestoreCohort(tx,{ organizationId: auth.organization.id,projectId,configSetId,snapshotRevisionId: revision.id });
  if (cohort.some((row) => !row.active || !row.snapshotValueId || row.snapshotValueId !== row.oldValueId)) conflict("当前参数与完整来源修订不一致，请先完成来源同步后保存快照。");
  return { configRevisionId: revision.id,sourcePinCount: cohort.length };
}

async function inspect(tx: Database, storage: ObjectStore, auth: AuthContext, input: {
  projectId: string; baselineId: string; sourceConfigRevisionId?: string;
}, snapshot: CatalogSnapshot | null, snapshots: ReadonlyMap<string,CatalogSnapshot>) {
  const baseline = (await tx.query<{ config_set_id: string; source_snapshot: BaselineSourceSnapshot | null }>(`select config_set_id,source_snapshot
    from public.dts_release_baseline where id=$1 and organization_id=$2`,[input.baselineId,auth.organization.id])).rows[0];
  if (!baseline) throw new ApiError("NOT_FOUND","配置快照不存在。");
  const configSetId = baseline.config_set_id;
  const set = (await tx.query(`select id from public.dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update nowait`,
    [configSetId,auth.organization.id,input.projectId])).rows[0];
  if (!set) throw new ApiError("NOT_FOUND","配置快照不属于当前项目。");
  await lockOrganizationModuleRecognition(tx,auth.organization.id);
  const currentCatalog = await lockSourceCatalogGovernance(tx,auth.organization.id);
  if (snapshot ? currentCatalog?.id !== snapshot.release.id || currentCatalog.digest !== snapshot.release.digest : currentCatalog) conflict("参数目录已更新，请重新预览恢复。");
  if (snapshot) snapshot = await loadOrganizationCatalogSnapshot(tx,auth.organization.id,snapshot);
  const preview: CanonicalRestorePreview = { canRestore: false,missingInformation: [],historicalRevisions: [],
    editorHref: `/parameter-admin/projects/${encodeURIComponent(input.projectId)}/configuration?configSet=${encodeURIComponent(configSetId)}`,
    requiresCompositionConfirmation: false,members: [],entryFile: null,includeSearchPaths: [],overlayOrder: [],
    impact: { parameterChanges: 0,retainedBindings: 0,restoredBindings: 0,sourceReplacements: 0 } };
  const pinned = (await tx.query<{ file_id: string; file_version_id: string }>(`select file_id,file_version_id
    from public.dts_release_baseline_members where baseline_id=$1 order by file_id`,[input.baselineId])).rows;
  // Old snapshots can use only a real, complete historical source receipt.
  const historical = (await tx.query<Revision & { source_pin_count: number | null }>(`select revision.*,
    (select jsonb_array_length(request.applied_source_result->'results')
      +coalesce(jsonb_array_length(request.source_revision_context->'newProperties'),0)
      +coalesce(jsonb_array_length(request.source_revision_context->'json'->'mappings'),0)
      from public.project_parameter_value_change_requests request
      where request.organization_id=revision.organization_id and request.project_id=revision.project_id and request.status='approved'
        and request.applied_source_result->>'configRevisionId'=revision.id limit 1) as source_pin_count
    from public.dts_config_revisions revision where revision.organization_id=$1 and revision.project_id=$2 and revision.config_set_id=$3
      and revision.status='resolved'
      and (select count(*) from public.dts_config_revision_members member where member.config_revision_id=revision.id)=$4
      and not exists(select 1 from public.dts_release_baseline_members saved where saved.baseline_id=$5
        and not exists(select 1 from public.dts_config_revision_members member where member.config_revision_id=revision.id
          and member.file_id=saved.file_id and member.file_version_id=saved.file_version_id)) order by revision.revision_number desc`,
    [auth.organization.id,input.projectId,configSetId,pinned.length,input.baselineId])).rows;
  preview.historicalRevisions = historical.filter((row) => row.source_pin_count !== null).map((row) => ({ id: row.id,revisionNumber: row.revision_number }));
  const selected = baseline.source_snapshot?.configRevisionId ?? input.sourceConfigRevisionId;
  const targetRevision = historical.find((row) => row.id === selected);
  if (!selected) {
    preview.missingInformation = ["快照未保存完整来源修订、成员用途及顺序、include/overlay 组成和参数来源清单。",
      preview.historicalRevisions.length ? "请明确选择与快照版本完全匹配的实际历史修订，再重新预览。" : "没有保存完整提交回执的匹配历史修订，请在配置编辑器补齐来源并另存完整快照。"];
    return { preview,configSetId };
  }
  if (!targetRevision || (!baseline.source_snapshot && targetRevision.source_pin_count === null)) conflict("选定历史修订没有快照所钉的完整成员版本及参数来源清单，请重新选择。");
  const current = (await tx.query<Revision>(`select * from public.dts_config_revisions where organization_id=$1 and project_id=$2
    and config_set_id=$3 and status='resolved' order by revision_number desc limit 1`,[auth.organization.id,input.projectId,configSetId])).rows[0];
  if (!current) conflict("当前配置来源修订不存在。");
  await tx.query(`select id from public.project_parameter_files where organization_id=$1 and project_id=$2
    and (config_set_id=$3 or id=any($4::text[])) order by id for update nowait`,[auth.organization.id,input.projectId,configSetId,pinned.map((row) => row.file_id)]);
  const targetMembers = await revisionMembers(tx,auth,input.projectId,configSetId,targetRevision.id);
  const currentMembers = await revisionMembers(tx,auth,input.projectId,configSetId,current.id);
  const currentCount = (await tx.query<{ count: number }>(`select count(*)::int as count from public.project_parameter_files
    where organization_id=$1 and project_id=$2 and config_set_id=$3`,[auth.organization.id,input.projectId,configSetId])).rows[0]!.count;
  if (targetMembers.length !== pinned.length || currentMembers.length !== currentCount || currentMembers.some((row) => row.currentVersionId !== row.fileVersionId
    || row.currentConfigSetId !== configSetId || row.currentRole !== (row.role === "include" ? "misc" : row.role) || row.currentOrder !== row.sortOrder)) conflict("配置成员或版本已变化，请先完成来源构建再预览。");
  if (targetMembers.some((row) => row.currentConfigSetId && row.currentConfigSetId !== configSetId)) conflict("快照文件已归属其他配置，请在配置编辑器先移出原配置，再重新预览恢复。");
  const extras = currentMembers.filter((row) => !targetMembers.some((target) => target.fileId === row.fileId));
  const members = [...targetMembers,...extras].sort((a,b) => a.sortOrder-b.sortOrder || a.fileId.localeCompare(b.fileId));
  if (new Set(members.map((row) => row.sourceName)).size !== members.length) conflict("恢复后的来源名称重复，请在配置编辑器修正后重新预览。");
  const contents = new Map<string,string>();
  if (!storage.getBounded) throw new ApiError("INTERNAL_ERROR","Bounded source storage is required.");
  for (const member of [...currentMembers,...members]) {
    let bytes: Buffer;
    try { bytes = await storage.getBounded(member.storageKey,MAX_PARAMETER_SOURCE_BYTES); }
    catch { conflict(`来源对象 ${member.sourceName} 不存在或不可读；整次恢复未执行。`); }
    if (bytes.length !== member.sizeBytes || sourceRevisionDigest(bytes) !== member.checksum.replace(/^sha256:/,"")) conflict(`来源对象 ${member.sourceName} 校验失败；整次恢复未执行。`);
    const text = new TextDecoder("utf-8",{ fatal: true,ignoreBOM: true }).decode(bytes);
    if (member.format === "json") parseJsonSource(text);
    contents.set(`${member.fileId}:${member.fileVersionId}`,text);
  }
  const dts = members.filter((row) => row.format === "dts");
  const entryFile = targetRevision.entry_file ?? (dts.length ? current.entry_file : null);
  const includeSearchPaths = targetRevision.entry_file ? targetRevision.include_search_paths : current.include_search_paths;
  const overlayOrder = [...targetRevision.overlay_order,...current.overlay_order.filter((name) => extras.some((row) => row.sourceName === name))];
  let continuity: ReviewedSourceContinuity | null = null;
  let resolved: ReturnType<typeof resolveDtsConfigSet> | null = null;
  if (dts.length) {
    if (!entryFile) conflict("历史修订缺少 DTS 入口；请在配置编辑器补齐来源并另存完整快照。");
    const files = new Map(dts.map((row) => [row.sourceName,{ content: contents.get(`${row.fileId}:${row.fileVersionId}`)!,fileVersionId: row.fileVersionId }]));
    resolved = resolveDtsConfigSet({ entryFile,includeSearchPaths,overlayOrder,files,requireExactOrigins: true });
    if (resolved.diagnostics.some((row) => row.severity === "error" || /dangling|unresolved/.test(row.code))) throw new ApiError("VALIDATION_FAILED","恢复组合包含未解决的 include/overlay 引用。",{ diagnostics: resolved.diagnostics });
    const validated = await createDtsToolchainRunner().validate({ entryFile,includeSearchPaths,overlayOrder,files },{ mode: "release" });
    if (!validated.ok || validated.mode !== "release") throw new ApiError("VALIDATION_FAILED","恢复组合未通过 DTS 工具链；当前配置未改变。",{ diagnostics: validated.diagnostics });
    continuity = await prepareReviewedSourceContinuity(tx,{ organizationId: auth.organization.id,projectId: input.projectId,
      configSetId,baseConfigRevisionId: current.id,restorationBaseConfigRevisionId: targetRevision.id,
      effectiveNodes: resolved.effective.nodesByLocator,sourceDigest: sourceRevisionDigest(members) });
  }
  const cohort = await loadConfigurationRestoreCohort(tx,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId,snapshotRevisionId: targetRevision.id });
  const expectedPinCount = baseline.source_snapshot?.sourcePinCount ?? targetRevision.source_pin_count!;
  if (cohort.filter((row) => row.snapshotValueId !== null).length !== expectedPinCount) conflict("快照参数定义或来源记录已被删除/替换，无法完整恢复；不会复活已彻底删除的定义。");
  const planned = [];
  for (const row of cohort) {
    const sourceValueId = row.snapshotValueId ?? row.oldValueId;
    const pin = await loadOwnedProjectValueSourcePin(tx,{ organizationId: auth.organization.id,projectId: input.projectId,bindingId: row.bindingId,projectValueId: sourceValueId });
    const old = await readOwnedProjectValueIdentity(tx,{ organizationId: auth.organization.id,projectId: input.projectId,bindingId: row.bindingId,projectValueId: row.oldValueId });
    const oldPin = await loadOwnedProjectValueSourcePin(tx,{ organizationId: auth.organization.id,projectId: input.projectId,bindingId: row.bindingId,projectValueId: row.oldValueId });
    const pinnedCatalog = snapshots.get(row.catalogReleaseId);
    const definition = pinnedCatalog?.getDefinitionRevision({ definitionId: ParameterDefinitionId(row.definitionId),revisionId: DefinitionRevisionId(row.effectiveRevisionId) });
    if (!pin || pin.valueState !== "present" || !old || !oldPin || (row.active && oldPin.configRevisionId !== current.id) || !definition || definition.status !== "found"
      || (await readSourceRegistrationAgreement(tx,{ organizationId: auth.organization.id,subjectId: row.subjectId }))?.id !== row.registrationId) conflict("参数定义、登记或来源记录已变化，整次恢复未执行。");
    let fileId = pin.fileId, locator = pin.locator;
    let payload = old.value.payload;
    const propertyName = typeof pin.locator.propertyName === "string" ? pin.locator.propertyName : "";
    if (pin.format === "json") {
      const member = members.find((member) => member.fileId === pin.fileId);
      if (!member || typeof pin.locator.pointer !== "string" || pin.rootPointer === null) conflict("JSON 参数缺少明确来源成员或 Pointer。");
      payload = { kind: "json",value: readJsonSourceValue(contents.get(`${member.fileId}:${member.fileVersionId}`)!,pin.locator.pointer,pin.rootPointer) as ContractJsonValue };
    } else {
      const logical = continuity?.nodes.find((node) => node.logicalNodeId === pin.logicalNodeId);
      const node = logical && resolved?.effective.nodesByLocator.get(logical.nodeLocator);
      const property = node?.properties.get(propertyName);
      const origin = members.find((member) => member.sourceName === property?.sourceChain.at(-1)?.fileName);
      if (!node || node.deleted || !property || property.deleted || !origin) conflict("保留成员与快照组合使参数来源缺失，请在配置编辑器修正后重新预览。");
      if (snapshot && resolveObservedSubject(snapshot,{ compatibles: parseCompatibles(node.properties.get("compatible")?.rawText ?? null),nodeName: node.name })?.subjectId !== row.subjectId) conflict("恢复节点识别与参数身份不一致，请在配置编辑器核对。");
      fileId = origin.fileId; payload = rawTextToPayload(propertyName,property.rawText); locator = pin.locator;
    }
    assertCanonicalValueConstraints(definition.revision,payload,pin.format === "dts");
    planned.push({ ...row,fileId,fileVersionId: members.find((member) => member.fileId === fileId)!.fileVersionId,
      format: pin.format,logicalNodeId: pin.logicalNodeId,propertyName,locator,rootPointer: pin.rootPointer,payload,
      changed: !row.active || !sameSourceRevision(payload,old.value.payload),sourceFileId: oldPin.fileId });
  }
  preview.members = members.map((member) => {
    const retained = extras.some((row) => row.fileId === member.fileId);
    const compositionChanged = !retained && (member.currentConfigSetId !== configSetId
      || member.currentRole !== (member.role === "include" ? "misc" : member.role) || member.currentOrder !== member.sortOrder);
    return { fileId: member.fileId,fileName: member.sourceName,fromVersionId: member.currentVersionId,toVersionId: member.fileVersionId,
      versionNumber: member.versionNumber,role: member.role,sortOrder: member.sortOrder,compositionChanged,
      action: retained ? "retain-added" : member.currentConfigSetId !== configSetId ? "reattach" : member.currentVersionId !== member.fileVersionId || compositionChanged ? "restore" : "unchanged" };
  });
  preview.requiresCompositionConfirmation = preview.members.some((row) => row.compositionChanged);
  preview.entryFile = entryFile; preview.includeSearchPaths = includeSearchPaths; preview.overlayOrder = overlayOrder;
  preview.impact = { parameterChanges: planned.filter((row) => row.changed).length,retainedBindings: planned.length,
    restoredBindings: planned.filter((row) => !row.active).length,sourceReplacements: planned.filter((row) => row.fileId !== row.sourceFileId).length };
  const facts = { kind: "configuration_restore" as const,organizationId: auth.organization.id,projectId: input.projectId,baselineId: input.baselineId,
    candidateId: null,configSetId,baseConfigRevisionId: current.id,snapshotConfigRevisionId: targetRevision.id,
    baseDigest: sourceRevisionDigest(currentMembers),proposedDigest: sourceRevisionDigest(members),members,cohort: planned,continuity,
    entryFile,includeSearchPaths,overlayOrder,catalogRelease: snapshot ? { id: snapshot.release.id,digest: snapshot.release.digest } : null,
    targets: planned.filter((row) => row.changed).map((row) => ({ bindingId: row.bindingId,action: "set" as const,payload: row.payload,afterFileId: row.fileId,propertyName: row.propertyName })),
    originTransfers: planned.filter((row) => row.fileId !== row.sourceFileId).map((row) => ({ bindingId: row.bindingId,oldValueId: row.oldValueId,
      sourcePinId: row.sourcePinId,fromFileId: row.sourceFileId,toFileId: row.fileId })) };
  const proof = { ...facts,proofDigest: sourceRevisionDigest(facts) };
  preview.canRestore = true; preview.proofToken = proof.proofDigest; preview.sourceConfigRevisionId = targetRevision.id;
  return { preview,proof,contents,configSetId };
}

export async function previewCanonicalBaselineRestore(db: Database, storage: ObjectStore, auth: AuthContext,
  input: { projectId: string; baselineId: string; sourceConfigRevisionId?: string }): Promise<CanonicalRestorePreview> {
  const snapshot = await loadSnapshot(db), snapshots = await loadSourceRevisionCatalogSnapshots(db,input.projectId,auth.organization.id,snapshot,true);
  return db.transaction(async (tx) => {
    auth = await requireCurrentSourceAdministrator(tx,auth,input.projectId);
    return (await inspect(tx,storage,auth,input,snapshot,snapshots)).preview;
  });
}

export type CanonicalBaselineRestoreInput = {
  projectId: string; baselineId: string; sourceConfigRevisionId?: string; proofToken: string;
  confirmCompositionChanges: boolean; reason: string; clientMutationId: string;
};

/** One source transaction owns membership, version activation, topology,
 * complete value propagation and its immutable administrator receipt. */
export async function applyCanonicalBaselineRestore(db: Database, storage: ObjectStore, auth: AuthContext,
  input: CanonicalBaselineRestoreInput, security: CanonicalSourceSecurityContext) {
  await requireCanonicalUserInvocation(auth,security,{ projectId: input.projectId,operation: "configuration snapshot restore",
    targetType: "dts-release-baseline",targetId: input.baselineId });
  const snapshot = await loadSnapshot(db), snapshots = await loadSourceRevisionCatalogSnapshots(db,input.projectId,auth.organization.id,snapshot,true);
  try { return await db.transaction(async (tx) => {
    auth = await requireCurrentSourceAdministrator(tx,auth,input.projectId);
    if (!input.reason.trim() || !input.clientMutationId.trim()) throw new ApiError("VALIDATION_FAILED","请填写恢复原因。");
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`configuration-restore:${auth.organization.id}:${input.projectId}:${auth.user.id}:${input.clientMutationId}`]);
    const mutationDigest = sourceRevisionDigest(input);
    const replay = (await tx.query<{ request_kind: string; source_revision_mutation_digest: string;
      applied_source_result: { baselineId: string; restored: number; configRevisionId: string } | null }>(`select request_kind,source_revision_mutation_digest,applied_source_result
      from public.project_parameter_value_change_requests where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and source_revision_mutation_id=$4`,
      [auth.organization.id,input.projectId,auth.user.id,input.clientMutationId])).rows[0];
    if (replay) {
      if (replay.request_kind !== "configuration_restore" || replay.source_revision_mutation_digest !== mutationDigest || !replay.applied_source_result) conflict("此操作编号已用于不同的恢复请求。");
      return replay.applied_source_result;
    }
    const inspected = await inspect(tx,storage,auth,input,snapshot,snapshots);
    const { preview,proof,contents,configSetId } = inspected;
    if (!proof || !preview.canRestore || proof.proofDigest !== input.proofToken) conflict("恢复预览已过期，请重新预览；当前配置未改变。");
    if (preview.requiresCompositionConfirmation && !input.confirmCompositionChanges) throw new ApiError("VALIDATION_FAILED","请明确确认预览列出的成员归属、用途和顺序变化。");
    await lockSourceConfigurationBindings(tx,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId });
    for (const node of proof.continuity?.nodes ?? []) await assertTrustedSensitiveNodeWriteAllowed(tx,auth,{
      organizationId: auth.organization.id,projectId: input.projectId,nodePath: node.nodeLocator,sourcePath: { kind: "node-locator",value: node.nodeLocator },
      compatible: node.compatible ?? null,compatibleIsAuthoritative: true,invocation: security.invocation,requestId: security.requestId,refusalSink: security.refusalSink });
    const requestId = await freezeSourceRevisionRequest(tx,auth,proof,{ projectId: input.projectId,reason: input.reason,assignedToUserId: null,
      clientMutationId: input.clientMutationId },mutationDigest,"administrator_direct");
    const attribution = trustedDomainAttribution(security.invocation), versionIds = new Map<string,string>();
    for (const member of proof.members) {
      let versionId = member.fileVersionId;
      if (member.currentVersionId !== member.fileVersionId) {
        const version = await insertFileVersion(tx,{ id: randomUUID(),fileId: member.fileId,versionNumber: 0,
          storageKey: member.storageKey,checksum: member.checksum,sizeBytes: member.sizeBytes,parsedIndex: member.parsedIndex,
          origin: "rollback",attribution });
        versionId = version.id;
        if (member.format === "dts") await ingestDtsFileVersion(tx,versionId,contents!.get(`${member.fileId}:${member.fileVersionId}`)!);
      }
      const moved = await tx.query(`update public.project_parameter_files set current_version_id=$2,config_set_id=$3,
        config_set_role=$4,config_set_sort_order=$5,updated_at=now() where id=$1 and organization_id=$6 and project_id=$7
          and current_version_id is not distinct from $8 and config_set_id is not distinct from $9`,
        [member.fileId,versionId,configSetId,member.role === "include" ? "misc" : member.role,member.sortOrder,auth.organization.id,input.projectId,
          member.currentVersionId,member.currentConfigSetId]);
      if (moved.rowCount !== 1) conflict("配置文件发生并发修改，整次恢复已回滚。");
      versionIds.set(member.fileId,versionId);
    }
    const members = proof.members.map((member) => ({ ...member,fileName: member.sourceName,fileVersionId: versionIds.get(member.fileId)!,
      content: contents!.get(`${member.fileId}:${member.fileVersionId}`)! }));
    let revisionId: string;
    if (proof.entryFile && proof.continuity) {
      const revision = await ingestConfigRevisionInTransaction(tx,{ organizationId: auth.organization.id,projectId: input.projectId,configSetId,
        entryFile: proof.entryFile,includeSearchPaths: proof.includeSearchPaths,overlayOrder: proof.overlayOrder,members },auth,
        { createdByUserId: auth.user.id,domain: attribution },{ reviewedSource: proof.continuity });
      if (revision.status !== "resolved") conflict("恢复配置构建失败，整次恢复已回滚。");
      revisionId = revision.id;
    } else {
      revisionId = randomUUID();
      await insertConfigRevision(tx,{ id: revisionId,organizationId: auth.organization.id,projectId: input.projectId,configSetId,
        revisionNumber: await nextConfigRevisionNumber(tx,configSetId),status: "resolved",attribution });
      await insertConfigRevisionMembers(tx,revisionId,members);
    }
    const observed = await listObservedProperties(asValueClient(tx),revisionId), auditRef = randomUUID(), results = [];
    for (const entry of proof.cohort) {
      const current = await readOwnedCurrentBinding(tx,{ organizationId: auth.organization.id,projectId: input.projectId,bindingId: entry.bindingId,lock: true });
      const old = await readOwnedProjectValueIdentity(tx,{ organizationId: auth.organization.id,projectId: input.projectId,bindingId: entry.bindingId,projectValueId: entry.oldValueId });
      const pinned = snapshots.get(entry.catalogReleaseId);
      if (current.status !== "current" || !old || !pinned || current.binding.currentValueId !== entry.oldValueId) conflict("参数发生并发修改，整次恢复已回滚。");
      const property = entry.format === "dts" ? observed.find((row) => row.fileId === entry.fileId && row.logicalNodeId === entry.logicalNodeId && row.propertyKey === entry.propertyName) : null;
      if (entry.format === "dts" && (!property || !sameSourceRevision(rawTextToPayload(property.propertyKey,property.rawText),entry.payload))) conflict("实际参数来源与恢复预览不一致，整次恢复已回滚。");
      const appended = await appendProjectValue(asValueClient(tx),{ snapshot: pinned,binding: { ...current.binding,catalogRelease: pinned.release },
        definitionRevisionId: current.binding.effectiveRevisionId,expectedTip: ProjectValueId(entry.oldValueId),payload: entry.payload,
        source: { sourceRef: old.value.source.sourceRef,configRevisionId: revisionId },sourceCommit: { requestId,auditRef,derived: !entry.changed } });
      if (!appended.ok) conflict(`恢复参数同步失败：${appended.error.kind}，整次恢复已回滚。`);
      const fileVersionId = versionIds.get(entry.fileId)!, sourcePinId = randomUUID();
      const locator = entry.format === "json" ? entry.locator : { kind: "dts-property",propertyOccurrenceId: property!.propertyOccurrenceId,
        nodeOccurrenceId: property!.nodeOccurrenceId,fileVersionId,propertyName: entry.propertyName };
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,
        file_id,file_version_id,format,property_occurrence_id,locator,locator_digest)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [sourcePinId,appended.value.currentTip,entry.bindingId,entry.definitionId,auth.organization.id,input.projectId,entry.sourceOccurrenceId,
          revisionId,entry.fileId,fileVersionId,entry.format,property?.propertyOccurrenceId ?? null,JSON.stringify(locator),`sha256:${sourceRevisionDigest(locator)}`]);
      const historyEventId = deriveHistoryEventId({ bindingId: entry.bindingId,oldCurrentValueId: entry.oldValueId,newCurrentValueId: appended.value.currentTip });
      results.push({ bindingId: entry.bindingId,oldValueId: entry.oldValueId,newValueId: appended.value.currentTip,sourcePinId,historyEventId });
      if (entry.changed) await tx.query(`update public.project_parameter_value_change_targets set applied_value_id=$3,applied_history_event_id=$4,
        applied_source_pin_id=$5,applied_file_version_id=$6 where request_id=$1 and binding_id=$2 and applied_value_id is null`,
        [requestId,entry.bindingId,appended.value.currentTip,historyEventId,sourcePinId,fileVersionId]);
    }
    const receipt = { requestId,baselineId: input.baselineId,restored: preview.members.filter((row) => row.action === "restore" || row.action === "reattach").length,
      configRevisionId: revisionId,sourceRevisionProofDigest: proof.proofDigest,results };
    await writeTrustedAuditEventInTx(asAuditTx(tx),{ id: auditRef,invocation: security.invocation,app: "parameters",kind: "parameter-topology-governance",
      action: "value-change-applied",severity: "High",projectId: input.projectId,targetType: "project-parameter-value-change-request",targetId: requestId,
      metadata: { requestKind: "configuration_restore",applicationMode: "administrator_direct",appliedByUserId: auth.user.id,result: receipt },traceId: security.requestId });
    await tx.query(`update public.project_parameter_value_change_requests set status='approved',apply_outcome='committed',applied_at=now(),
      applied_audit_ref=$2,applied_file_version_ids=$3::jsonb,applied_source_result=$4::jsonb,updated_at=now() where id=$1 and status='pending'`,
      [requestId,auditRef,JSON.stringify([...versionIds.values()]),JSON.stringify(receipt)]);
    return receipt;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}
