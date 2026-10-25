import { parameterOrganizationId } from "../parameters/operatingScope";
import posixPath from "node:path/posix";
import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution } from "../auth/trustedInvocation";
import { NormalizedConfigurationSchemaId, PropertyKey, type CatalogSnapshot } from "../catalog-kernel/interface";
import { lexDts, resolveDtsConfigSet, resolveDtsConfigSetAsync } from "../dts";
import { resolveIncludeTarget } from "../dts/configSetResolver";
import { closureManifest, composeDtsBuildInputs, loadSharedDtsiClosure, mountedSharedPath } from "../shared-dtsi/dependencies";
import type { DtsBuildInputs } from "../contracts/dtoSchemas/dtsPreprocessing";
import { inspectDtsCppIncludes, type DtsPreprocessingReceipt } from "../dts/cppSources";
import type { SharedReferenceSwitchPreview } from "../contracts/dtoSchemas/canonicalMemberAddition";
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
import { produceDtsReviewEvidenceInTransaction } from "../parameter-catalog-api/productionEvidence";
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
import { assertProjectSourceWritable, insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import { freezeSourceRevisionRequest, loadSnapshot, loadSourceRevisionCatalogSnapshots, requireCurrentSourceAdministrator,
  sameSourceRevision, sourceRevisionDigest, type SourceRevisionTarget, type SourceRevisionNewProperty } from "./sourceRevisionService";
import { applySourceRestoration, matchingDeletedSourceAnchors, prepareSourceRestorations, sourceRestorationNodes, type SourceRestoration } from "./sourceRestoration";
import { ingestDtsFileVersion } from "./structuralIngest";
import { rethrowSourceTransactionError } from "./sourceVersion";
import { withCanonicalSourceAttemptTransaction } from "./canonicalSourceAttemptTransaction";
import type { ConfigSetRole } from "./types";

export type MemberAdditionInput = {
  projectId: string; configSetId: string; candidateId?: string; fileId?: string;
  sharedReference?: { resourceId: string; versionId: string; mountPath?: string; replaceVersionId?: string };
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
  declaredBuildInputs: DtsBuildInputs; preprocessing?: DtsPreprocessingReceipt;
  members: Member[]; cohort: Cohort[]; continuity: ReviewedSourceContinuity | null;
  targets: SourceRevisionTarget[]; newProperties: NewProperty[]; json: MemberAdditionInput["json"] | null;
  restorations?: SourceRestoration[];
  originTransfers: Array<{ bindingId: string; oldValueId: string; sourcePinId: string; fromFileId: string; toFileId: string }>;
  catalogRelease: { id: string; digest: string } | null; proofDigest: string;
  sharedReference?: { resourceId: string; versionId: string; memberId: string; version: number; digest: string };
  sharedComposition?: Array<{resourceId:string;versionId:string;version:number;name:string;digest:string;mountPath:string;direct:boolean;
    sources:Array<{memberId:string;fileId:string;fileVersionId:string;sourceName:string}>}>;
  sharedClosure?:ReturnType<typeof closureManifest>;
  sharedSwitch?: { beforeReferences: Array<{id:string;resourceId:string;versionId:string;mountPath:string;direct:boolean}>;
    beforeSources: Array<{fileId:string;fileVersionId:string;referenceId:string;memberId:string;sourceName:string}>;
    beforeFiles:Array<{fileId:string;fileVersionId:string}> };
  rootEdit?: { fileId: string; baseFileVersionId: string; sourceName: string; before: string; after: string };
};
export type MemberAdditionPreview = {
  proofToken: string; configSetId: string; fileName: string; format: "dts" | "json";
  members: Member[]; entryFile: string | null; includeSearchPaths: string[]; overlayOrder: string[];
  sharedReference?: Proof["sharedReference"];
  sharedComposition?: Proof["sharedComposition"];
  sharedSwitch?:SharedReferenceSwitchPreview;
  rootEdit?: Proof["rootEdit"];
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
  await lockOrganizationModuleRecognition(tx, parameterOrganizationId(auth));
  if (snapshot) snapshot = await loadOrganizationCatalogSnapshot(tx, parameterOrganizationId(auth), snapshot);
  const set = (await tx.query("select id from public.dts_config_set where id=$1 and organization_id=$2 and project_id=$3 for update nowait",
    [input.configSetId, parameterOrganizationId(auth), input.projectId])).rows[0];
  if (!set) throw new ApiError("NOT_FOUND", "目标配置不存在或不属于当前项目。");
  await tx.query("select id from public.project_parameter_files where organization_id=$1 and project_id=$2 and (config_set_id=$3 or id=$4) order by id for update nowait",
    [parameterOrganizationId(auth), input.projectId, input.configSetId, input.fileId ?? null]);
  const revision = (await tx.query<{ id: string; entry_file: string | null; include_search_paths: string[]; overlay_order: string[]; declared_build_inputs: DtsBuildInputs; preprocessing:DtsPreprocessingReceipt|null }>(
    `select id,entry_file,include_search_paths,overlay_order,declared_build_inputs,preprocessing from public.dts_config_revisions
     where organization_id=$1 and project_id=$2 and config_set_id=$3 and status='resolved' order by revision_number desc limit 1 for update nowait`,
    [parameterOrganizationId(auth), input.projectId, input.configSetId])).rows[0];
  if (!revision) conflict("配置尚无可构建的当前来源版本，请先完成配置初始化。");
  const members = (await tx.query<Member & { storageKey: string; currentVersionId: string; currentRole: string; currentOrder: number }>(
    `select member.file_id as "fileId",member.file_version_id as "fileVersionId",member.source_name as "sourceName",file.format,
      member.role,member.sort_order as "sortOrder",version.checksum,version.size_bytes::float8 as "sizeBytes",version.storage_key as "storageKey",
      file.current_version_id as "currentVersionId",file.config_set_role as "currentRole",file.config_set_sort_order as "currentOrder"
     from public.dts_config_revision_members member join public.project_parameter_files file on file.id=member.file_id
       and file.organization_id=$2 and file.project_id=$3 and file.config_set_id=$4
     join public.project_parameter_file_versions version on version.id=member.file_version_id and version.file_id=file.id
     where member.config_revision_id=$1 order by member.sort_order,member.file_id`,
    [revision.id, parameterOrganizationId(auth), input.projectId, input.configSetId])).rows;
  const count = (await tx.query<{ count: number }>("select count(*)::int as count from public.project_parameter_files where organization_id=$1 and project_id=$2 and config_set_id=$3",
    [parameterOrganizationId(auth), input.projectId, input.configSetId])).rows[0]?.count;
  if (!members.length || members.length !== count || members.some((row) => row.currentVersionId !== row.fileVersionId
    || (row.role === "include" ? "misc" : row.role) !== row.currentRole || row.sortOrder !== row.currentOrder)) conflict("当前配置成员已变化，请重新核对配置来源。");
  const candidate = input.candidateId ? await getParameterFileCandidateByIdForUpdate(tx, { organizationId: parameterOrganizationId(auth),
    projectId: input.projectId, candidateId: input.candidateId }) : null;
  if (candidate?.status === "failed") throw new ApiError("VALIDATION_FAILED", "候选解析失败，请按诊断修正文件后重新上传；候选及当前配置会保留。", { diagnostics: candidate.diagnostics });
  if (input.candidateId && (!candidate || candidate.status !== "ready" || candidate.fileId || candidate.sourceRevisionContext
    || !candidate.storageKey || !candidate.checksum || candidate.sizeBytes === undefined)) conflict("请选择尚未激活、未绑定文件的上传候选；候选会保留以便修正。");
  const existing = input.fileId ? (await tx.query<{ id: string; fileName: string; format: "dts" | "json"; configSetId: string | null;
    fileVersionId: string; storageKey: string; checksum: string; sizeBytes: number }>(
    `select file.id,file.file_name as "fileName",file.format,file.config_set_id as "configSetId",version.id as "fileVersionId",
      version.storage_key as "storageKey",version.checksum,version.size_bytes::float8 as "sizeBytes"
     from public.project_parameter_files file join public.project_parameter_file_versions version on version.id=file.current_version_id and version.file_id=file.id
     where file.id=$1 and file.organization_id=$2 and file.project_id=$3`, [input.fileId, parameterOrganizationId(auth), input.projectId])).rows[0] : null;
  if (input.fileId && !existing) throw new ApiError("NOT_FOUND", "待加入的项目文件或当前版本不存在。");
  if (existing) await assertProjectSourceWritable(tx, existing.id);
  const currentReferences=(await tx.query<{id:string;resourceId:string;versionId:string;mountPath:string;direct:boolean}>(
    `select id,resource_id as "resourceId",revision_id as "versionId",mount_path as "mountPath",is_direct as direct
     from public.project_shared_dtsi_references where organization_id=$1 and project_id=$2 and config_set_id=$3 order by created_at,id`,
    [parameterOrganizationId(auth),input.projectId,input.configSetId])).rows;
  const replacing=input.sharedReference?.replaceVersionId;
  const replaced=currentReferences.find(row=>row.resourceId===input.sharedReference?.resourceId);
  if(replacing && (!replaced?.direct || replaced.versionId!==replacing || replacing===input.sharedReference?.versionId
    || input.sharedReference?.mountPath!==undefined && input.sharedReference.mountPath!==replaced.mountPath)) conflict("当前固定引用已变化；请选择直接引用的另一版本并重新预览。");
  const beforeSources=replacing?(await tx.query<{fileId:string;fileVersionId:string;referenceId:string;memberId:string;sourceName:string}>(
    `select snapshot.file_id as "fileId",snapshot.file_version_id as "fileVersionId",snapshot.reference_id as "referenceId",
      snapshot.member_id as "memberId",file.file_name as "sourceName" from public.project_shared_dtsi_snapshots snapshot
      join public.project_shared_dtsi_references ref on ref.id=snapshot.reference_id
      join public.project_parameter_files file on file.id=snapshot.file_id where ref.config_set_id=$1 order by file.id`,[input.configSetId])).rows:[];
  const pins=input.sharedReference ? [{resourceId:input.sharedReference.resourceId,versionId:input.sharedReference.versionId,mountPath:replaced?.mountPath??input.sharedReference.mountPath??""},
    ...(replacing?currentReferences.filter(row=>row.direct&&row.resourceId!==input.sharedReference!.resourceId).map(({resourceId,versionId,mountPath})=>({resourceId,versionId,mountPath})):[])] : [];
  const sharedResources=await loadSharedDtsiClosure(tx,auth,pins);
  const retainedSources=replacing?(await tx.query<{fileId:string;fileVersionId:string;resourceId:string;memberId:string}>(
    `select distinct file.id as "fileId",file.current_version_id as "fileVersionId",member.shared_reference->>'resourceId' as "resourceId",
       member.shared_reference->>'memberId' as "memberId" from public.project_parameter_files file
     join public.dts_config_revision_members member on member.file_id=file.id and member.shared_reference is not null
     join public.dts_config_revisions revision on revision.id=member.config_revision_id
     where file.organization_id=$1 and file.project_id=$2 and file.config_set_id is null and revision.config_set_id=$3`,
    [parameterOrganizationId(auth),input.projectId,input.configSetId])).rows:[];
  if(retainedSources.length)await tx.query("select id from public.project_parameter_files where id=any($1::text[]) order by id for update nowait",[retainedSources.map(row=>row.fileId)]);
  for(const retained of retainedSources)if(retainedSources.some(other=>other.resourceId===retained.resourceId&&other.memberId===retained.memberId&&other.fileId!==retained.fileId))
    conflict("同一共享成员存在多个历史项目文件锚点，请先完成身份核对。");
  const shared=sharedResources[0]?.item??null;
  const additionSortOrder=shared?Math.max(...members.filter(member=>!beforeSources.some(source=>source.fileId===member.fileId)).map(member=>member.sortOrder))+1:input.sortOrder;
  if(shared && (input.role!=="misc" || input.setAsRoot || input.json))throw new ApiError("VALIDATION_FAILED","共享资源以 include 用途加入完整配置。");
  const reused=new Set<string>();
  for(const resource of sharedResources) {
    const current=(await tx.query<{versionId:string;mountPath:string}>("select revision_id as \"versionId\",mount_path as \"mountPath\" from public.project_shared_dtsi_references where config_set_id=$1 and resource_id=$2",[input.configSetId,resource.resourceId])).rows[0];
    if(!current)continue;
    if(replacing)continue;
    if(resource.direct || current.versionId!==resource.versionId || current.mountPath!==resource.mountPath)
      conflict(`${resource.name}：此配置已引用该资源，请通过引用版本变更处理重复版本或挂载。`);
    reused.add(resource.resourceId);
  }
  const sharedTargets=sharedResources.filter(resource=>!reused.has(resource.resourceId)).flatMap(resource=>resource.item.members.map(member=>({
    fileId:beforeSources.find(source=>source.memberId===member.id&&currentReferences.find(ref=>ref.id===source.referenceId)?.resourceId===resource.resourceId)?.fileId
      ??retainedSources.find(source=>source.memberId===member.id&&source.resourceId===resource.resourceId)?.fileId??`shared_${sourceRevisionDigest([input.configSetId,resource.versionId,member.id])}`,
    fileVersionId:`shared_version_${sourceRevisionDigest([input.configSetId,resource.versionId,member.id])}`,
    sourceName:mountedSharedPath(resource.mountPath,member.sourceName),format:"dts" as const,storageKey:"",checksum:member.checksum,sizeBytes:member.sizeBytes,
    content:member.content,memberId:member.id,resourceId:resource.resourceId
  })));
  if(replacing)for(const target of sharedTargets) {
    const collision=(await tx.query<{id:string}>("select id from public.project_parameter_files where organization_id=$1 and project_id=$2 and file_name=$3 and id<>$4",[parameterOrganizationId(auth),input.projectId,target.sourceName,target.fileId])).rows[0];
    if(collision)conflict(`${target.sourceName}：目标共享成员与既有文件身份不同，请先核对身份或修改挂载目录。`);
  }
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
      format: existing.format, storageKey: existing.storageKey, checksum: existing.checksum, sizeBytes: existing.sizeBytes }
    : sharedTargets[0]??null;
  if (!target || !["dts", "json"].includes(target.format)) throw new ApiError("VALIDATION_FAILED", "请选择 DTS/JSON 候选或已有文件。");
  const retainedMembers=members.filter(member=>!beforeSources.some(source=>source.fileId===member.fileId));
  if (normalizeManifestLogicalPath(target.sourceName) !== target.sourceName || retainedMembers.some((row) => row.sourceName === target.sourceName && (!input.setAsRoot || row.fileId !== target.fileId))) {
    conflict("文件来源名称不合法或与已有成员重名，请使用不同文件名重新上传。");
  }
  if(sharedTargets.length) {
    const names=new Set(retainedMembers.map(member=>member.sourceName.normalize("NFC")));
    for(const member of sharedTargets) {
      if(normalizeManifestLogicalPath(member.sourceName)!==member.sourceName || names.has(member.sourceName.normalize("NFC")))conflict(`${member.sourceName}：共享挂载路径与配置成员重复。`);
      names.add(member.sourceName.normalize("NFC"));
    }
    if(retainedMembers.length+sharedTargets.length>128)throw new ApiError("VALIDATION_FAILED","完整配置不能超过 128 个成员。");
    if(additionSortOrder+sharedTargets.length-1>100000)throw new ApiError("VALIDATION_FAILED","完整依赖的成员列表顺序超过 100000，请先整理成员顺序。");
  }
  if (target.format === "json" && input.role === "overlay") throw new ApiError("VALIDATION_FAILED", "JSON 文件不能作为 DTS 覆盖层。");
  if (target.format !== "json" && input.json) throw new ApiError("VALIDATION_FAILED", "只有 JSON 文件可指定配置规范及字段映射。");
  if (!storage.getBounded) throw new ApiError("INTERNAL_ERROR", "Bounded source storage is required.");
  const contents = new Map<string, string>(), beforeContents=new Map<string,string>();
  for (const member of [...members, ...(shared?sharedTargets:[target])]) {
    let bytes: Buffer;
    try { bytes = "content" in member ? Buffer.from(member.content as string) : await storage.getBounded(member.storageKey, MAX_PARAMETER_SOURCE_BYTES); }
    catch { conflict(`来源文件 ${member.sourceName} 不可读取，请恢复文件后重新预览；当前配置未改变。`); }
    if (bytes.length !== member.sizeBytes || sourceRevisionDigest(bytes) !== member.checksum.replace(/^sha256:/, "")) conflict("来源文件校验失败，未改变当前配置。");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new ApiError("VALIDATION_FAILED", "来源文件必须为有效 UTF-8 文本，请重新上传。"); }
    if (member.format === "json") parseJsonSource(text);
    contents.set(member.fileId, text);
    if(!("content" in member))beforeContents.set(member.fileId,text);
  }
  let afterMembers: Member[] = [...retainedMembers.map(({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes }) =>
    ({ fileId, fileVersionId, sourceName, format, role, sortOrder, checksum, sizeBytes })),
  ...(!input.setAsRoot ? (shared?sharedTargets:[target]).map((row,index)=>({ fileId: row.fileId, fileVersionId: row.fileVersionId, sourceName: row.sourceName, format: row.format,
    role: shared ? "include" : input.role, sortOrder: additionSortOrder+index, checksum: row.checksum, sizeBytes: row.sizeBytes })) : [])].sort((a, b) => a.sortOrder - b.sortOrder || a.fileId.localeCompare(b.fileId));
  let rootEdit: Proof["rootEdit"];
  if (shared) {
    const root = members.find(member => member.sourceName === revision.entry_file && member.role === "base" && member.format === "dts");
    if (!root) throw new ApiError("VALIDATION_FAILED", "请先提供真实项目根文件并解析配置，再添加共享引用。");
    await assertProjectSourceWritable(tx, root.fileId);
    const before = contents.get(root.fileId)!;
    let rootSource=before;
    const retainedIncludes=new Set<string>();
    if(replacing) {
      const existingFiles=new Map(members.map(member=>[member.sourceName,{content:beforeContents.get(member.fileId)!,fileVersionId:member.fileVersionId}]));
      const oldNames=new Set(beforeSources.map(source=>source.sourceName));
      const oldTokens=lexDts(before), edits:Array<{start:number;end:number;text:string}>=[];
      if(revision.preprocessing)for(const edge of inspectDtsCppIncludes({entryFile:root.sourceName,includeSearchPaths:revision.include_search_paths,
        overlayOrder:revision.overlay_order,preprocessing:revision.preprocessing,
        files:new Map(members.filter(member=>member.format==="dts").map(member=>[member.sourceName,existingFiles.get(member.sourceName)!]))})) {
        if(edge.sourceName!==root.sourceName||!oldNames.has(edge.target))continue;
        const lines=before.split("\n"),offset=lines.slice(0,edge.line-1).reduce((size,line)=>size+line.length+1,0)+edge.column-1;
        if(before[offset]!=="#")continue;
        const original=beforeSources.find(source=>source.sourceName===edge.target)!;
        const resourceId=currentReferences.find(reference=>reference.id===original.referenceId)!.resourceId;
        const next=sharedTargets.find(target=>target.resourceId===resourceId&&target.memberId===original.memberId);
        if(next)retainedIncludes.add(next.sourceName);
        if(next?.sourceName===edge.target)continue;
        const marker=oldTokens.findIndex(token=>token.span.start===offset),prefix=oldTokens[marker];
        const argument=oldTokens[marker+(prefix?.value==="#include"?1:prefix?.value==="#"&&oldTokens[marker+1]?.value==="include"?2:0)];
        const lineEnd=offset+lines[edge.line-1]!.length-edge.column+1;
        if(argument?.kind!=="string"||argument.span.end>lineEnd) {
          const message=`${root.sourceName}:${edge.line}:${edge.column}：此 CPP include 需更换入口路径，但原始指令不是可精确改写的单行带引号形式；请在目标版本保留兼容入口后重新预览。`;
          throw new ApiError("CONFLICT",message,{reason:"shared-cpp-include-retarget",diagnostics:[{severity:"error",code:"shared-cpp-include-retarget",message}]});
        }
        edits.push(next?{...argument.span,text:JSON.stringify(posixPath.relative(posixPath.dirname(root.sourceName),next.sourceName))}
          :{start:offset,end:argument.span.end,text:""});
      }
      for(let at=0;at<oldTokens.length;at++) if(oldTokens[at]?.value==="/include/"&&oldTokens[at+1]?.kind==="string") {
        const found=resolveIncludeTarget(root.sourceName,oldTokens[at+1]!.value.slice(1,-1),revision.include_search_paths,existingFiles);
        if(!found.ok||!oldNames.has(found.fileName))continue;
        const original=beforeSources.find(source=>source.sourceName===found.fileName)!;
        const resourceId=currentReferences.find(reference=>reference.id===original.referenceId)!.resourceId;
        const next=sharedTargets.find(target=>target.resourceId===resourceId&&target.memberId===original.memberId);
        if(next) {
          retainedIncludes.add(next.sourceName);
          if(next.sourceName!==found.fileName)edits.push({...oldTokens[at+1]!.span,text:JSON.stringify(posixPath.relative(posixPath.dirname(root.sourceName),next.sourceName))});
        } else edits.push({start:oldTokens[at]!.span.start,end:oldTokens[at+1]!.span.end,text:""});
      }
      for(const edit of edits.sort((a,b)=>b.start-a.start))rootSource=rootSource.slice(0,edit.start)+edit.text+rootSource.slice(edit.end);
    }
    const tokens = lexDts(rootSource), directive = tokens.findIndex(token => token.value === "/dts-v1/");
    if (directive < 0 || tokens[directive + 1]?.value !== ";") throw new ApiError("VALIDATION_FAILED", "项目根文件需要明确的 /dts-v1/; 声明，未修改配置。");
    const included=new Set(sharedResources.flatMap(resource=>resource.item.manifest.includeGraph.map(edge=>mountedSharedPath(resource.mountPath,edge.target))));
    const roots=[...sharedResources].reverse().flatMap(resource=>sharedTargets.filter(member=>member.resourceId===resource.resourceId && /\.dtsi?$/u.test(member.sourceName) && !included.has(member.sourceName)));
    const includes=roots.filter(member=>!retainedIncludes.has(member.sourceName)).map(member=>`/include/ ${JSON.stringify(posixPath.relative(posixPath.dirname(root.sourceName),member.sourceName))}`).join("\n");
    const existingSharedNames=new Set((await tx.query<{sourceName:string}>(`select source_name as "sourceName" from public.dts_config_revision_members
      where config_revision_id=$1 and shared_reference is not null`,[revision.id])).rows.map(member=>member.sourceName));
    const existingFiles=new Map(members.map(member=>[member.sourceName,{content:contents.get(member.fileId)!,fileVersionId:member.fileVersionId}]));
    let offset = tokens[directive + 1]!.span.end;
    for(let at=directive+2;tokens[at]?.value==="/include/" && tokens[at+1]?.kind==="string";at+=2) {
      const current=resolveIncludeTarget(root.sourceName,tokens[at+1]!.value.slice(1,-1),revision.include_search_paths,existingFiles);
      if(!current.ok || !existingSharedNames.has(current.fileName))break;
      offset=tokens[at+1]!.span.end;
    }
    const after = includes?`${rootSource.slice(0, offset)}\n${includes}\n${rootSource.slice(offset)}`:rootSource;
    if (Buffer.byteLength(after) > MAX_PARAMETER_SOURCE_BYTES) throw new ApiError("VALIDATION_FAILED", "项目根文件加入引用后超过源码容量。");
    rootEdit = { fileId: root.fileId, baseFileVersionId: root.fileVersionId, sourceName: root.sourceName, before, after };
    contents.set(root.fileId, after);
    afterMembers = afterMembers.map(member => member.fileId === root.fileId ? { ...member,
      fileVersionId: `shared_root_${sourceRevisionDigest([root.fileVersionId, shared.id])}`, checksum: `sha256:${sourceRevisionDigest(Buffer.from(after))}`, sizeBytes: Buffer.byteLength(after) } : member);
  }
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
  const currentPins = (await tx.query<{resourceId:string;versionId:string;mountPath:string}>(`select resource_id as "resourceId",revision_id as "versionId",mount_path as "mountPath"
    from public.project_shared_dtsi_references where organization_id=$1 and project_id=$2 and config_set_id=$3 order by created_at,id`,
    [parameterOrganizationId(auth),input.projectId,input.configSetId])).rows;
  const currentResources = await loadSharedDtsiClosure(tx,auth,currentPins);
  const completeResources = replacing?sharedResources:[...currentResources,...sharedResources.filter(resource=>!currentResources.some(existing=>existing.resourceId===resource.resourceId))];
  const declaredBuildInputs = revision.declared_build_inputs;
  const {includeSearchPaths,defines} = composeDtsBuildInputs(declaredBuildInputs,completeResources);
  const overlayNames=afterMembers.filter((row)=>row.format==="dts"&&row.role==="overlay").map(row=>row.sourceName);
  const overlayOrder=input.setAsRoot?overlayNames:[...revision.overlay_order,...overlayNames.filter(name=>!revision.overlay_order.includes(name))];
  let continuity: ReviewedSourceContinuity | null = null;
  let resolved: ReturnType<typeof resolveDtsConfigSet> | null = null;
  const diagnostics: MemberAdditionPreview["diagnostics"] = [];
  const restorationScope = { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId };
  let anchors: Awaited<ReturnType<typeof matchingDeletedSourceAnchors>> = [];
  if (target.format === "json" && !input.json) diagnostics.push({ severity: "warning", code: "json-unregistered",
    message: "JSON 文件已校验；未登记为参数，将产生 0 个新 Binding。" });
  if (dts.length) {
    if (!entryFile || dts.filter((row) => row.role === "base").length !== 1
      || !dts.some((row) => row.sourceName === entryFile && row.role === "base")) conflict("DTS 配置需要唯一可用的基础入口，请检查文件用途。");
    const files = new Map(dts.map((row) => [row.sourceName, { content: contents.get(row.fileId)!, fileVersionId: row.fileVersionId }]));
    resolved = await resolveDtsConfigSetAsync({ entryFile, includeSearchPaths, defines, overlayOrder, requireExactOrigins: true, files });
    diagnostics.push(...resolved.diagnostics.map(({ severity, code, message, fileName }) => ({ severity, code,
      message: input.setAsRoot ? rootDiagnosticMessage(code, message, fileName) : message })));
    if (diagnostics.some((row) => row.severity === "error" || /dangling|unresolved/.test(row.code))) {
      throw new ApiError("VALIDATION_FAILED", "配置包含未解决的 include/overlay 引用，请修正候选后重试。", { diagnostics });
    }
    const formerRootOverlayFiles = await loadFormerRootOverlayFiles(tx, input.configSetId, afterMembers, overlayOrder);
    const validated = await (toolchain ?? createDtsToolchainRunner()).validate({ entryFile, includeSearchPaths, defines, overlayOrder, files, formerRootOverlayFiles }, { mode: "release" });
    diagnostics.push(...validated.diagnostics.map((row) => ({ severity: row.severity, code: row.code ?? "toolchain",
      message: input.setAsRoot ? rootDiagnosticMessage(row.code ?? "toolchain", row.message,
        `${row.file}${row.line ? `，第 ${row.line} 行` : ""}`) : row.message })));
    if (!validated.ok || validated.mode !== "release") throw new ApiError("VALIDATION_FAILED", "DTS 工具链未通过，当前组成未改变。", { diagnostics });
    anchors = await matchingDeletedSourceAnchors(tx, restorationScope, resolved.effective.nodesByLocator, afterMembers);
    continuity = await prepareReviewedSourceContinuity(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId,
      configSetId: input.configSetId, baseConfigRevisionId: revision.id, effectiveNodes: resolved.effective.nodesByLocator,
      sourceDigest: sourceRevisionDigest(afterMembers), restorationNodes: sourceRestorationNodes(anchors) });
  }
  const cohort: Cohort[] = [], targets: SourceRevisionTarget[] = [], newProperties: NewProperty[] = [], originTransfers: Proof["originTransfers"] = [];
  for (const entry of await loadSourceBindingCohortReadOnly(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId })) {
    const pin = await loadOwnedProjectValueSourcePin(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    if (!pin || pin.configRevisionId !== revision.id || pin.valueState !== "present" || !members.some((row) => row.fileId === pin.fileId && row.fileVersionId === pin.fileVersionId)) conflict("参数来源已变化，请重新预览。");
    const old = await readOwnedProjectValueIdentity(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
    const current = await readOwnedCurrentBinding(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: entry.bindingId });
    const pinned = snapshots.get(entry.catalogReleaseId);
    const definition = pinned?.getDefinitionRevision({ definitionId: ParameterDefinitionId(entry.definitionId), revisionId: DefinitionRevisionId(entry.effectiveRevisionId) });
    if (!old || current.status !== "current" || !definition || definition.status !== "found"
      || (await readSourceRegistrationAgreement(tx, { organizationId: parameterOrganizationId(auth), subjectId: current.binding.subjectId }))?.id !== current.binding.registrationId) conflict("参数定义或登记已变化，请重新预览。");
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
      if(replacing)throw new ApiError("CONFLICT",`版本切换移除了已关联参数 ${logical?.nodeLocator??"未知节点"} · ${propertyName}，请先处理来源冲突后重新预览。`,{reason:"shared-version-conflict",bindingId:entry.bindingId});
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
    const registration = subject && await readSourceRegistrationAgreement(tx, { organizationId: parameterOrganizationId(auth), subjectId: subject.subjectId });
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
      || !await readSourceRegistrationAgreement(tx, { organizationId: parameterOrganizationId(auth), subjectId: subject.subject.id })) conflict("请选择当前组织已登记的配置规范。");
    if (!input.json.mappings.length || new Set(input.json.mappings.map((row) => row.definitionId)).size !== input.json.mappings.length) throw new ApiError("VALIDATION_FAILED", "JSON 字段需明确、唯一的参数定义映射。");
    readJsonSourceValue(contents.get(target.fileId)!, input.json.rootPointer);
    for (const mapping of input.json.mappings) {
      const definition = snapshot.getDefinitionById(ParameterDefinitionId(mapping.definitionId));
      if (definition.status !== "found" || definition.definition.subjectId !== subject.subject.id) conflict("JSON 映射中的参数不属于选定配置规范。");
      assertCanonicalValueConstraints(definition.definition.selectedRevision, { kind: "json", value: readJsonSourceValue(contents.get(target.fileId)!, mapping.pointer, input.json.rootPointer) as ContractJsonValue });
    }
  }
  const facts = { kind: "member_addition" as const, organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId,
    ...(input.setAsRoot ? { setAsRoot: true } : {}),
    ...(replacing?{sharedSwitch:{beforeReferences:currentReferences,beforeSources,beforeFiles:[...beforeSources,...retainedSources.filter(source=>sharedTargets.some(target=>target.fileId===source.fileId))].map(({fileId,fileVersionId})=>({fileId,fileVersionId}))}}:{}),
    ...(shared ? { sharedReference: { resourceId: shared.resourceId, versionId: shared.id, version: shared.version, memberId: shared.members[0]!.id, digest: shared.digest },
      sharedClosure:closureManifest(sharedResources),sharedComposition:sharedResources.filter(resource=>!reused.has(resource.resourceId)).map(({item:_item,...resource})=>({...resource,sources:sharedTargets.filter(member=>member.resourceId===resource.resourceId)
        .map(({memberId,fileId,fileVersionId,sourceName})=>({memberId,fileId,fileVersionId,sourceName}))})),rootEdit } : {}),
    candidateId: candidate?.id ?? null, fileId: target.fileId, baseConfigRevisionId: revision.id,
    baseDigest: sourceRevisionDigest(members.map(({ storageKey: _storage, currentVersionId: _version, currentRole: _role, currentOrder: _order, ...row }) => row)),
    proposedDigest: target.checksum.replace(/^sha256:/, ""), entryFile, includeSearchPaths, overlayOrder, declaredBuildInputs,
    ...(resolved?.preprocessing?{preprocessing:resolved.preprocessing.receipt}:{}),
    members: afterMembers, cohort, continuity, targets, newProperties, ...(restorations.length ? { restorations } : {}), originTransfers, json: input.json ?? null,
    catalogRelease: snapshot ? { id: snapshot.release.id, digest: snapshot.release.digest } : null };
  const proof: Proof = { ...facts, proofDigest: sourceRevisionDigest(facts) };
  const beforeNodes = (await tx.query<{ id: string }>("select logical_node_id as id from public.dts_logical_node_revisions where config_revision_id=$1", [revision.id])).rows;
  let switchPreview:SharedReferenceSwitchPreview|undefined;
  if(replacing&&resolved&&entryFile) {
    const before=await resolveDtsConfigSetAsync({entryFile:revision.entry_file!,includeSearchPaths:revision.include_search_paths,overlayOrder:revision.overlay_order,
      preprocessing:revision.preprocessing??undefined,defines:composeDtsBuildInputs(declaredBuildInputs,currentResources).defines,requireExactOrigins:true,
      files:new Map(members.filter(member=>member.format==="dts").map(member=>[member.sourceName,{content:beforeContents.get(member.fileId)!,fileVersionId:member.fileVersionId}]))});
    if(before.diagnostics.some(row=>row.severity==="error"))conflict("当前来源无法重现，请先修复来源证明后重新预览。");
    const oldNames=new Set(beforeSources.map(source=>source.sourceName)),nextNames=new Set(sharedTargets.map(source=>source.sourceName));
    const effective:SharedReferenceSwitchPreview["effective"]=[];
    for(const locator of new Set([...before.effective.nodesByLocator.keys(),...resolved.effective.nodesByLocator.keys()])) {
      const oldNode=before.effective.nodesByLocator.get(locator),nextNode=resolved.effective.nodesByLocator.get(locator);
      for(const property of new Set(["status",...oldNode?.properties.keys()??[],...nextNode?.properties.keys()??[]])) {
        const a=oldNode?.properties.get(property),b=nextNode?.properties.get(property);
        const oldShared=a?.sourceChain.filter(row=>oldNames.has(row.fileName)).at(-1),targetShared=b?.sourceChain.filter(row=>nextNames.has(row.fileName)).at(-1);
        const oldValue=oldNode&&!oldNode.deleted&&(!a?.deleted)?a?.rawText??(property==="status"?'"okay"':null):null;
        const nextValue=nextNode&&!nextNode.deleted&&(!b?.deleted)?b?.rawText??(property==="status"?'"okay"':null):null;
        const originBefore=a?.sourceChain.at(-1)?.fileName??null,originAfter=b?.sourceChain.at(-1)?.fileName??null;
        const localOverride=Boolean(targetShared&&originAfter&&!nextNames.has(originAfter));
        if(oldValue!==nextValue||oldShared?.rawText!==targetShared?.rawText||originBefore!==originAfter)
          effective.push({node:locator,property,oldShared:oldShared?.effect==="delete"?null:oldShared?.rawText??null,targetShared:targetShared?.effect==="delete"?null:targetShared?.rawText??null,
            before:oldValue,after:nextValue,originBefore,originAfter,localOverride});
      }
    }
    switchPreview={beforeVersion:currentResources.find(resource=>resource.resourceId===shared!.resourceId)!.version,afterVersion:shared!.version,
      dependencies:{before:currentResources.map(({name,version,mountPath})=>({name,version,mountPath})),after:sharedResources.map(({name,version,mountPath})=>({name,version,mountPath}))},
      sources:[...new Set([...members.map(member=>member.sourceName),...afterMembers.map(member=>member.sourceName)])].map(sourceName=>({sourceName,
        before:beforeContents.get(members.find(member=>member.sourceName===sourceName)?.fileId??"")??null,
        after:contents.get(afterMembers.find(member=>member.sourceName===sourceName)?.fileId??"")??null,
        projectOwned:!oldNames.has(sourceName)&&!nextNames.has(sourceName)})),effective,build:{mode:"release",passed:true,includeSearchPaths,defines}};
  }
  const preview: MemberAdditionPreview = { proofToken: proof.proofDigest, configSetId: input.configSetId, fileName: target.sourceName, format: target.format,
    ...(shared ? { sharedReference: proof.sharedReference,sharedComposition:proof.sharedComposition, rootEdit } : {}),
    ...(switchPreview?{sharedSwitch:switchPreview}:{}),
    members: afterMembers, entryFile, includeSearchPaths, overlayOrder, diagnostics,
    impact: { parameterChanges: targets.length + newProperties.length + (input.json?.mappings.length ?? 0),
      nodeAdditions: continuity?.nodes.filter((node) => !beforeNodes.some((row) => row.id === node.logicalNodeId)).length ?? 0,
      nodeRemovals: beforeNodes.filter((row) => !continuity?.nodes.some((node) => node.logicalNodeId === row.id)).length,
      retainedBindings: cohort.length - targets.filter((row) => row.action === "delete").length - restorations.length,
      sourceReplacements: originTransfers.length, restoredParameters: restorations.length } };
  return { proof, preview, contents, candidate, target,resolved };
}

export async function previewCanonicalMemberAddition(db: Database, storage: ObjectStore, auth: AuthContext, input: MemberAdditionInput,
  security: CanonicalSourceSecurityContext, options: { toolchain?: DtsToolchainRunner } = {}): Promise<MemberAdditionPreview> {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "configuration member addition preview", targetType: "dts-config-set", targetId: input.configSetId });
  const snapshot = await loadSnapshot(db), snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  try { return await db.transaction(async (tx) => {
    auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
    return (await inspect(tx, storage, auth, input, snapshot, snapshots, options.toolchain)).preview;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}

export async function applyCanonicalMemberAddition(db: Database, storage: ObjectStore, auth: AuthContext,
  input: MemberAdditionInput & { proofToken: string; reason: string; clientMutationId: string }, security: CanonicalSourceSecurityContext,
  options: { toolchain?: DtsToolchainRunner } = {}) {
  await requireCanonicalUserInvocation(auth, security, { projectId: input.projectId, operation: "configuration member addition apply", targetType: "dts-config-set", targetId: input.configSetId });
  const snapshot = await loadSnapshot(db), snapshots = await loadSourceRevisionCatalogSnapshots(db, input.projectId, parameterOrganizationId(auth), snapshot);
  try { return await withCanonicalSourceAttemptTransaction(db, storage, async (tx, attempt) => {
    auth = await requireCurrentSourceAdministrator(tx, auth, input.projectId);
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`member-addition:${parameterOrganizationId(auth)}:${input.projectId}:${auth.user.id}:${input.clientMutationId}`]);
    const mutationDigest = sourceRevisionDigest(input);
    const replay = (await tx.query<{ request_kind: string; source_revision_mutation_digest: string; applied_source_result: { requestId: string; fileId: string; fileVersionId: string; configRevisionId: string } }>(
      `select request_kind,source_revision_mutation_digest,applied_source_result from public.project_parameter_value_change_requests
       where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and source_revision_mutation_id=$4`,
      [parameterOrganizationId(auth), input.projectId, auth.user.id, input.clientMutationId])).rows[0];
    if (replay) { if (replay.request_kind !== "member_addition" || replay.source_revision_mutation_digest !== mutationDigest || !replay.applied_source_result) conflict("此操作编号已用于不同的来源操作。"); return replay.applied_source_result; }
    const current = await lockSourceCatalogGovernance(tx, parameterOrganizationId(auth));
    if (snapshot ? current?.id !== snapshot.release.id || current.digest !== snapshot.release.digest : current) conflict("参数目录已变化，请重新预览。");
    const inspected = await inspect(tx, storage, auth, input, snapshot, snapshots, options.toolchain);
    const { proof, contents, candidate, target } = inspected;
    if (proof.proofDigest !== input.proofToken) conflict("预览已过期，未改变当前配置；请重新预览。");
    for (const node of proof.continuity?.nodes ?? []) await assertTrustedSensitiveNodeWriteAllowed(tx, auth, {
      organizationId: parameterOrganizationId(auth), projectId: input.projectId, nodePath: node.nodeLocator,
      sourcePath: { kind: "node-locator", value: node.nodeLocator }, compatible: node.compatible ?? null,
      compatibleIsAuthoritative: true, invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink });
    await lockSourceConfigurationBindings(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId });
    const derived=proof.sharedComposition?.flatMap(resource=>resource.sources.map(source=>proof.members.find(member=>member.fileId===source.fileId)!))??[];
    if (candidate || proof.sharedReference) {
      for(const source of derived.length?derived:[target])if(!proof.sharedSwitch?.beforeFiles.some(before=>before.fileId===source.fileId))await insertProjectParameterFile(tx, { id: source.fileId, organizationId: parameterOrganizationId(auth), projectId: input.projectId,
        fileName: source.sourceName, format: source.format, enabled: true });
      if (candidate) await tx.query("update public.project_parameter_file_candidates set file_id=$2 where id=$1 and status='ready' and file_id is null", [candidate.id, target.fileId]);
    }
    const requestId = await freezeSourceRevisionRequest(tx, auth, proof, { projectId: input.projectId, reason: input.reason,
      assignedToUserId: null, clientMutationId: input.clientMutationId }, mutationDigest, "administrator_direct");
    const attribution = trustedDomainAttribution(security.invocation);
    let fileVersionId = target.fileVersionId;
    const versionIds = new Map<string, string>();
    for(const source of derived.length?derived:candidate?[target]:[]) {
      const stored = proof.sharedReference ? await attempt.objectStore.put({ organizationId: parameterOrganizationId(auth),
        fileName: `${randomUUID()}.dtsi`, contentType: "text/plain", bytes: Buffer.from(contents.get(source.fileId)!) }) : null;
      if (stored && sourceRevisionDigest(await attempt.objectStore.getBounded!(stored.storageKey, MAX_PARAMETER_SOURCE_BYTES)) !== source.checksum.replace(/^sha256:/, "")) conflict("共享来源快照写入校验失败，配置未改变。");
      const version = proof.sharedSwitch
        ? (await tx.query<{id:string}>("select public.derive_shared_dtsi_switch_version($1,$2,$3,$4) as id",[requestId,source.fileId,randomUUID(),stored!.storageKey])).rows[0]!
        : await insertFileVersion(tx, { id: randomUUID(), fileId: source.fileId, versionNumber: 1, storageKey: stored?.storageKey ?? target.storageKey,
          checksum: source.checksum, sizeBytes: source.sizeBytes, parsedIndex: candidate?.parsedIndex, origin: "upload", attribution });
      if(source.fileId===target.fileId)fileVersionId = version.id;
      versionIds.set(source.fileId, version.id);
      if(!proof.sharedSwitch)await setCurrentVersion(tx, { fileId: source.fileId, versionId: version.id });
      if (source.format === "dts" && !/\.(h|hpp)$/u.test(source.sourceName)) await ingestDtsFileVersion(tx, version.id, contents.get(source.fileId)!, inspected.resolved?.preprocessing?.originalDocuments.get(source.sourceName),
        new Set(proof.continuity?.nodes.map(node => node.nodeLocator)));
    }
    if (proof.rootEdit) {
      const root = proof.members.find(member => member.fileId === proof.rootEdit!.fileId)!;
      const stored = await attempt.objectStore.put({ organizationId: parameterOrganizationId(auth), fileName: `${randomUUID()}.dts`,
        contentType: "text/plain", bytes: Buffer.from(proof.rootEdit.after) });
      if (sourceRevisionDigest(await attempt.objectStore.getBounded!(stored.storageKey, MAX_PARAMETER_SOURCE_BYTES)) !== root.checksum.replace(/^sha256:/, "")) conflict("项目根文件写入校验失败，配置未改变。");
      const version = await insertFileVersion(tx, { id: randomUUID(), fileId: root.fileId, versionNumber: 1,
        storageKey: stored.storageKey, checksum: root.checksum, sizeBytes: root.sizeBytes, origin: "writeback", attribution });
      await ingestDtsFileVersion(tx, version.id, proof.rootEdit.after, inspected.resolved?.preprocessing?.originalDocuments.get(root.sourceName),
        new Set(proof.continuity?.nodes.map(node => node.nodeLocator)));
      const updated = await tx.query("update public.project_parameter_files set current_version_id=$2,updated_at=now() where id=$1 and current_version_id=$3", [root.fileId, version.id, proof.rootEdit.baseFileVersionId]);
      if (updated.rowCount !== 1) conflict("项目根文件已变化，请重新预览。");
      versionIds.set(root.fileId, version.id);
    }
    if(proof.sharedSwitch) {
      await tx.query("select public.apply_shared_dtsi_switch($1,$2::jsonb)",[requestId,JSON.stringify(derived.map(source=>({fileId:source.fileId,fileVersionId:versionIds.get(source.fileId)!})))]);
    } else if (input.setAsRoot) {
      for (const member of proof.members) {
        const updated = await tx.query(`update public.project_parameter_files set config_set_role=$4,config_set_sort_order=$5,updated_at=now()
          where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$6 and current_version_id=$7`,
        [member.fileId, parameterOrganizationId(auth), input.projectId, member.role === "include" ? "misc" : member.role, member.sortOrder, input.configSetId, member.fileVersionId]);
        if (updated.rowCount !== 1) conflict("配置成员已变化，根文件切换已回滚。");
      }
    } else {
      for(const source of derived.length?derived:[target]) {
      const attached = await tx.query(`update public.project_parameter_files set config_set_id=$2,config_set_role=$3,config_set_sort_order=$4,updated_at=now()
      where id=$1 and organization_id=$5 and project_id=$6 and config_set_id is null and current_version_id=$7`,
    [source.fileId, input.configSetId, input.role,proof.members.find(member=>member.fileId===source.fileId)!.sortOrder, parameterOrganizationId(auth), input.projectId,versionIds.get(source.fileId)??fileVersionId]);
    if (attached.rowCount !== 1) conflict("文件归属或版本已变化，所有变更已回滚。");
      }
    }
    for(const shared of proof.sharedSwitch?[]:proof.sharedComposition??[]) {
      const referenceId = randomUUID();
      await tx.query(`insert into public.project_shared_dtsi_references(id,organization_id,project_id,config_set_id,resource_id,revision_id,created_by_user_id,mount_path,is_direct)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [referenceId, parameterOrganizationId(auth), input.projectId, input.configSetId, shared.resourceId, shared.versionId, auth.user.id,shared.mountPath,shared.direct]);
      for(const source of shared.sources)
      await tx.query(`insert into public.project_shared_dtsi_snapshots(file_id,file_version_id,reference_id,revision_id,member_id)
        values ($1,$2,$3,$4,$5)`, [source.fileId, versionIds.get(source.fileId), referenceId, shared.versionId, source.memberId]);
    }
    const members: ConfigRevisionManifestMember[] = proof.members.map((member) => ({ ...member, fileName: member.sourceName,
      fileVersionId: versionIds.get(member.fileId) ?? member.fileVersionId,
      role: member.role as ConfigRevisionMemberRole, content: contents.get(member.fileId)! }));
    let revisionId: string;
    if (proof.entryFile && proof.continuity) {
      const revision = await ingestConfigRevisionInTransaction(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId,
        configSetId: input.configSetId, entryFile: proof.entryFile, includeSearchPaths: proof.includeSearchPaths,
        overlayOrder: proof.overlayOrder, preprocessing:proof.preprocessing, declaredBuildInputs:proof.declaredBuildInputs, members }, auth, { createdByUserId: auth.user.id, domain: attribution }, { reviewedSource: proof.continuity });
      if (revision.status !== "resolved") conflict("文件组成无法构建，所有变更已回滚。");
      if(snapshot)await produceDtsReviewEvidenceInTransaction(tx,db,storage,auth,revision.id);
      revisionId = revision.id;
    } else {
      revisionId = randomUUID();
      await insertConfigRevision(tx, { id: revisionId, organizationId: parameterOrganizationId(auth), projectId: input.projectId,
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
        const restored = await applySourceRestoration(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId }, restoration,
          { requestId, configRevisionId: revisionId, auditRef }, pinned, property);
        results.push({ ...restored, kind: "changed" });
        await tx.query(`update public.project_parameter_value_change_targets set applied_value_id=$3,applied_history_event_id=$4,
          applied_source_pin_id=$5,applied_file_version_id=$6 where request_id=$1 and binding_id=$2`,
        [requestId,entry.bindingId,restored.newValueId,restored.historyEventId,restored.sourcePinId,restored.fileVersionId]);
        continue;
      }
      const currentBinding = await readOwnedCurrentBinding(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: entry.bindingId, lock: true });
      const old = await readOwnedProjectValueIdentity(tx, { organizationId: parameterOrganizationId(auth), projectId: input.projectId, bindingId: entry.bindingId, projectValueId: entry.oldValueId });
      const pinned = snapshots.get(entry.catalogReleaseId);
      if (!old || currentBinding.status !== "current" || currentBinding.binding.currentValueId !== entry.oldValueId || !pinned) conflict("参数当前值已变化，所有变更已回滚。");
      const change = proof.targets.find((row) => row.bindingId === entry.bindingId), deleted = change?.action === "delete";
      const afterFileId = change?.afterFileId ?? entry.fileId;
      const afterFileVersionId = versionIds.get(afterFileId) ?? proof.members.find((member) => member.fileId === afterFileId)!.fileVersionId;
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
      const baseMember = proof.members.find((member) => member.fileId === entry.fileId);
      if(deleted&&!baseMember)conflict("删除参数缺少精确的原始来源成员，所有变更已回滚。");
      const deletionProof = deleted ? { kind: "dts-source-absence-v1", scannerVersion: "dts-config-v1",
        beforeValueDigest: old.value.valueDigest.startsWith("sha256:") ? old.value.valueDigest : `sha256:${old.value.valueDigest}`,
        beforeSourceDigest: `sha256:${baseMember!.checksum.replace(/^sha256:/, "")}`, afterSourceDigest: `sha256:${baseMember!.checksum.replace(/^sha256:/, "")}` } : null;
      await tx.query(`insert into parameter_catalog.project_value_source_pins
        (id,project_value_id,binding_id,definition_id,organization_id,project_id,source_occurrence_id,config_revision_id,file_id,file_version_id,
         format,property_occurrence_id,locator,locator_digest,value_state,base_source_pin_id,delete_request_id,delete_proof)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18::jsonb)`,
        [sourcePinId, appended.value.currentTip, entry.bindingId, entry.definitionId, parameterOrganizationId(auth), input.projectId,
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
      organizationId: parameterOrganizationId(auth), projectId: input.projectId, configSetId: input.configSetId, configRevisionId: revisionId,
      propertyOccurrenceIds: proof.newProperties.map((planned) => {
        const actual = observed.find((row) => row.fileId === planned.fileId && row.logicalNodeId === planned.logicalNodeId && row.propertyKey === planned.propertyName);
        if (!actual || !sameSourceRevision(rawTextToPayload(actual.propertyKey, actual.rawText), planned.payload)) conflict("新增参数与预览不一致。");
        return actual.propertyOccurrenceId;
      }) });
    if (proof.json && snapshot) await registerCanonicalJsonSource(tx, storage, auth, snapshot, { projectId: input.projectId,
      configSetId: input.configSetId, fileId: target.fileId, fileVersionId, ...proof.json,
      invocation: security.invocation, requestId: security.requestId, refusalSink: security.refusalSink });
    const receipt = { requestId, configRevisionId: revisionId, fileId: target.fileId, fileVersionId,
      ...(derived.length?{derivedSources:derived.map(source=>({fileId:source.fileId,fileVersionId:versionIds.get(source.fileId)!}))}:{}),
      ...(proof.rootEdit ? { rootFileVersionId: versionIds.get(proof.rootEdit.fileId) } : {}), sourceRevisionProofDigest: proof.proofDigest, results };
    await writeTrustedAuditEventInTx(asAuditTx(tx), { id: auditRef, invocation: security.invocation, app: "parameters", kind: "parameter-topology-governance",
      action: "value-change-applied", severity: "Medium", projectId: input.projectId, targetType: "project-parameter-value-change-request", targetId: requestId,
      metadata: { applicationMode: "administrator_direct", appliedByUserId: auth.user.id, requestKind: "member_addition", operation: proof.sharedSwitch?"switch_shared_version":input.setAsRoot ? "set_root" : "add_member",
        restoredParameters: proof.restorations?.length ?? 0, configSetId: input.configSetId, result: receipt }, traceId: security.requestId });
    if (candidate) await tx.query("update public.project_parameter_file_candidates set status='active',activated_at=now(),activated_by_user_id=$2,activated_version_id=$3 where id=$1 and status='ready'",
      [candidate.id, auth.user.id, fileVersionId]);
    await tx.query(`update public.project_parameter_value_change_requests set status='approved',apply_outcome='committed',applied_at=now(),
      applied_audit_ref=$2,applied_file_version_ids=$3::jsonb,applied_source_result=$4::jsonb,updated_at=now() where id=$1 and status='pending'`,
    [requestId, auditRef, JSON.stringify([...versionIds.values()].length ? [...versionIds.values()] : [fileVersionId]), JSON.stringify(receipt)]);
    return receipt;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}
