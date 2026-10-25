import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { AuthContext } from "../auth/types";
import { trustedDomainAttribution } from "../auth/trustedInvocation";
import { NormalizedConfigurationSchemaId, ParameterDefinitionId, type CatalogSnapshot } from "../catalog-kernel/interface";
import { configSetPackageLimits, configSetPackageManifestName, configSetSourcePackageSchema,
  type ConfigSetImportBody, type ConfigSetImportPreview, type ConfigSetImportResult } from "../contracts/dtoSchemas/configSetPackage";
import { dtsBuildInputsSchema } from "../contracts/dtoSchemas/dtsPreprocessing";
import { resolveDtsConfigSetAsync } from "../dts";
import { analysisCaseArchiveLimits, AnalysisCaseArchiveError, readBoundedZipArchive } from "../logs/analysisCaseArchive";
import type { ObjectStore } from "../logs/objectStore";
import { asValueClient, loadActiveOrganizationSourceRegistrations, lockSourceCatalogGovernance, syncPublishedCatalogProjectValuesInTransaction } from "../parameter-bindings/catalogProjectValueSync";
import { loadOwnedProjectValueSourcePin } from "../parameter-bindings/values";
import { produceDtsReviewEvidenceInTransaction } from "../parameter-catalog-api/productionEvidence";
import { assertTrustedSensitiveNodeWriteAllowed } from "../parameter-kernel/sensitiveNode";
import { ingestConfigRevisionInTransaction } from "../parameter-topology/ingestService";
import { insertConfigRevision, insertConfigRevisionMembers } from "../parameter-topology/repository";
import type { ConfigRevisionManifestMember } from "../parameter-topology/types";
import { normalizeIncludeSearchPaths } from "../parameter-topology/configRevisionManifest";
import { parameterOrganizationId } from "../parameters/operatingScope";
import { composeDtsBuildInputs, loadSharedDtsiClosure, mountedSharedPath } from "../shared-dtsi/dependencies";
import { preparePublishedSharedDtsiSource } from "../shared-dtsi/publication";
import { assertSharedDtsiNewReferences, lockSharedDtsiReferences } from "../shared-dtsi/lifecycle";
import { registerCanonicalJsonSource } from "./canonicalJsonSource";
import { requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { withCanonicalSourceAttemptTransaction } from "./canonicalSourceAttemptTransaction";
import { insertConfigSet } from "./configSetRepository";
import { createDtsToolchainRunner } from "./dtsToolchain";
import { parseJsonSource, readJsonSourceValue } from "./jsonSource";
import { insertFileVersion, insertProjectParameterFile, setCurrentVersion } from "./repository";
import { loadSnapshot, requireCurrentSourceAdministrator, sourceRevisionDigest } from "./sourceRevisionService";
import { ingestDtsFileVersion } from "./structuralIngest";
import { rethrowSourceTransactionError } from "./sourceVersion";

const invalid = (message: string): never => { throw new ApiError("VALIDATION_FAILED", message); };
const conflict = (message: string): never => { throw new ApiError("CONFLICT", message, { reason: "configuration-import-stale" }); };

/** One bounded archive owner, also used by shared-source intake; no extraction to host paths. */
export async function readConfigSetPackage(input: ConfigSetImportBody["archive"]) {
  let files: Map<string, Buffer>;
  try {
    files = await readBoundedZipArchive(Buffer.from(input.contentBase64, "base64"), { ...analysisCaseArchiveLimits,
      maxFiles: configSetPackageLimits.maxFiles + 1, maxFileBytes: configSetPackageLimits.maxManifestBytes,
      maxUnpackedBytes: configSetPackageLimits.maxTotalBytes + configSetPackageLimits.maxManifestBytes, maxCompressedBytes: configSetPackageLimits.maxArchiveBytes });
  } catch (error) {
    if (error instanceof AnalysisCaseArchiveError) invalid(error.message);
    throw error;
  }
  const decode = (bytes: Buffer, name: string) => {
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return invalid(`${name}：源码必须采用 UTF-8 编码。`); }
  };
  const metadata = files.get(configSetPackageManifestName);
  if (!metadata) invalid("请选择 WiseEff 导出的完整配置 ZIP（缺少导出清单）。");
  let json: unknown;
  try { json = JSON.parse(decode(metadata!, configSetPackageManifestName)); }
  catch { invalid("配置导出清单不是有效 JSON。"); }
  const parsed = configSetSourcePackageSchema.safeParse((json as { sourcePackage?: unknown })?.sourcePackage);
  if (!parsed.success) invalid("配置包缺少完整原始源码和构建清单，请从当前配置重新导出。");
  const manifest = parsed.data!;
  files.delete(configSetPackageManifestName);
  if (files.size !== manifest.members.length || [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > configSetPackageLimits.maxTotalBytes)
    invalid("配置包文件数、总大小或清单与原始文件不一致。");
  const contents = new Map<string, string>(), paths = new Set<string>();
  for (const member of manifest.members) {
    const key = member.sourceName.normalize("NFC");
    if (paths.has(key)) invalid(`${member.sourceName}：清单包含重复路径。`);
    paths.add(key);
    const bytes = files.get(member.sourceName);
    if (bytes && bytes.length>configSetPackageLimits.maxFileBytes) invalid(`${member.sourceName}：单个原始文件超过 2 MiB 上限。`);
    if (!bytes || member.checksum !== `sha256:${sourceRevisionDigest(bytes)}`) invalid(`${member.sourceName}：原始源码缺失或校验失败。`);
    if (member.sourceName === configSetPackageManifestName || !/\.(?:dts|dtsi|dtso|h|hpp|json)$/u.test(member.sourceName)
      || member.format !== (member.sourceName.endsWith(".json") ? "json" : "dts")) invalid(`${member.sourceName}：文件格式与清单不一致。`);
    const content = decode(bytes!, member.sourceName);
    if (member.format === "json") parseJsonSource(content);
    contents.set(member.sourceName, content);
  }
  if (manifest.entryFile && (manifest.members.filter(row=>row.format==="dts" && row.role==="base").length!==1
    || !manifest.members.some(row=>row.sourceName===manifest.entryFile && row.format==="dts" && row.role==="base"))) invalid("清单入口必须对应唯一的设备树根文件。");
  if (manifest.overlayOrder.some(path=>!manifest.members.some(row=>row.sourceName===path && row.format==="dts" && row.role!=="include" && row.role!=="base"))
    || new Set(manifest.overlayOrder).size!==manifest.overlayOrder.length || manifest.formerRootOverlayFiles.some(path=>!manifest.overlayOrder.includes(path))) invalid("覆盖顺序与来源文件不一致。");
  if (!isDeepStrictEqual(normalizeIncludeSearchPaths(manifest.resolvedBuildInputs.includeSearchPaths), normalizeIncludeSearchPaths(manifest.includeSearchPaths))) invalid("构建搜索目录与冻结清单不一致。");
  return { manifest, contents };
}

async function inspect(tx: Database, auth: AuthContext, projectId: string, input: ConfigSetImportBody, catalog:CatalogSnapshot|null) {
  const organizationId = parameterOrganizationId(auth);
  if (input.ownership === "reuse") await lockSharedDtsiReferences(tx,auth);
  const project = (await tx.query<{ status: string; initialization_status:string }>("select status,initialization_status from projects where id=$1 and organization_id=$2 for update nowait", [projectId, organizationId])).rows[0];
  if (!project) throw new ApiError("NOT_FOUND", "目标项目不存在。");
  if (project.initialization_status !== "initialized") conflict("请先通过现有项目初始化审核，再导入完整配置包。");
  if (project.status === "archived") conflict("请先恢复目标项目，再导入完整配置。");
  if ((await tx.query("select id from project_parameter_files where project_id=$1 and organization_id=$2 limit 1", [projectId, organizationId])).rows.length)
    conflict("完整配置包只能导入尚无来源文件的新项目；请选择空项目。");
  const emptySets=(await tx.query<{id:string;name:string}>("select id,name from dts_config_set where project_id=$1 and organization_id=$2 order by id",[projectId,organizationId])).rows;
  if (emptySets.some(row=>row.name===input.name)) conflict("配置名称已存在，请填写另一个名称后重新预览。");
  const { manifest, contents } = await readConfigSetPackage(input.archive);
  const governance = await lockSourceCatalogGovernance(tx, organizationId);
  if (catalog ? governance?.id !== catalog.release.id || governance.digest !== catalog.release.digest : governance) conflict("参数目录已更新，请重新预览。");
  const resources = input.ownership === "reuse" ? await loadSharedDtsiClosure(tx, auth, manifest.sharedClosure.filter(row => row.direct)
    .map(({ resourceId, versionId, mountPath }) => ({ resourceId, versionId, mountPath }))) : [];
  if (input.ownership === "reuse") {
    await assertSharedDtsiNewReferences(tx,auth,resources,[]);
    if (resources.length !== manifest.sharedClosure.length) conflict("共享固定闭包不一致；可明确选择作为项目私有源码导入。");
    for (const resource of resources) {
      const frozen = manifest.sharedClosure.find(row => row.resourceId === resource.resourceId);
      if (!frozen || resource.versionId !== frozen.versionId || resource.digest !== frozen.digest || resource.mountPath !== frozen.mountPath
        || resource.direct !== frozen.direct || !isDeepStrictEqual(resource.item.manifest, frozen.manifest)) conflict("共享精确版本或构建清单不匹配；请重新导出或明确选择私有导入。");
      await preparePublishedSharedDtsiSource(tx, auth, resource.item);
      for (const source of resource.item.members) {
        const path = mountedSharedPath(resource.mountPath, source.sourceName), member = manifest.members.find(row => row.sourceName === path);
        if (!member || member.shared?.resourceId !== resource.resourceId || member.shared.versionId !== resource.versionId
          || member.shared.memberId !== source.id || contents.get(path) !== source.content) conflict(`${path}：共享原始源码与精确发布版本不一致。`);
      }
    }
    for (const member of manifest.members.filter(row => row.shared)) {
      const resource = resources.find(row => row.resourceId === member.shared!.resourceId && row.versionId === member.shared!.versionId);
      if (!resource?.item.members.some(source => source.id === member.shared!.memberId && mountedSharedPath(resource.mountPath, source.sourceName) === member.sourceName))
        conflict(`${member.sourceName}：共享成员归属无法验证。`);
    }
  }
  const declared = input.ownership === "private" ? manifest.resolvedBuildInputs : manifest.declaredBuildInputs;
  if (!dtsBuildInputsSchema.safeParse(declared).success) invalid("私有导入的构建声明超过当前项目支持的搜索目录或宏上限，请先精简配置包后重新导出。");
  const effective = composeDtsBuildInputs(declared, resources);
  if (!isDeepStrictEqual(effective, manifest.resolvedBuildInputs)) conflict("本地声明与固定版本不能重现包内构建输入。");
  const resolved = manifest.entryFile ? await resolveDtsConfigSetAsync({ entryFile: manifest.entryFile, includeSearchPaths: manifest.includeSearchPaths,
    overlayOrder: manifest.overlayOrder, defines: effective.defines, preprocessing: manifest.preprocessing, requireExactOrigins: true,
    files: new Map(manifest.members.filter(row => row.format === "dts").map(row => [row.sourceName, { content: contents.get(row.sourceName)!, fileVersionId:row.checksum }])) }) : null;
  if (manifest.members.some(row => row.format === "dts") && !resolved) invalid("设备树配置缺少明确入口文件。");
  if (resolved?.diagnostics.some(row => row.severity === "error")) throw new ApiError("VALIDATION_FAILED", "完整来源无法解析，请修复后重新导出。", { diagnostics: resolved.diagnostics });
  if (resolved) {
    const validation = await createDtsToolchainRunner().validate({ entryFile: manifest.entryFile!, includeSearchPaths: manifest.includeSearchPaths,
      defines: effective.defines, overlayOrder: manifest.overlayOrder, formerRootOverlayFiles:manifest.formerRootOverlayFiles,
      files: new Map([...contents].filter(([name]) => !name.endsWith(".json")).map(([name, content]) => [name, { content }])) }, { mode: "release" });
    if (!validation.ok) throw new ApiError("VALIDATION_FAILED", "原始源码构建未通过，请修复后重新导出。", { diagnostics: validation.diagnostics });
  }
  for (const source of manifest.jsonSources) {
    const member = manifest.members.find(row => row.sourceName === source.sourceName && row.format === "json");
    const subject = catalog?.resolveSubject({ driverCompatibles: [], nodeTypeFallback: { kind: "absent" }, configurationSchemaIds: [NormalizedConfigurationSchemaId(source.configurationSchemaId)] });
    if (!member) conflict("JSON 配置来源缺失。");
    if (!subject || subject.status !== "matched" || subject.subject.kind !== "configuration-schema") return conflict("JSON 配置模型在当前目录不可用，请先修复来源映射。");
    for (const mapping of source.mappings) {
      const definition = catalog!.getDefinitionById(ParameterDefinitionId(mapping.definitionId));
      if (definition.status !== "found" || definition.definition.subjectId !== subject.subject.id) conflict("JSON 定义不属于当前配置模型。");
      readJsonSourceValue(contents.get(source.sourceName)!, mapping.pointer, source.rootPointer);
    }
  }
  const proofToken = sourceRevisionDigest({ projectId, organizationId, userId: auth.user.id, roles: auth.roles, permissions: auth.permissions,
    name: input.name, ownership: input.ownership, projectState:project, emptySets, archiveDigest:sourceRevisionDigest(Buffer.from(input.archive.contentBase64,"base64")), manifest, catalog: governance,
    registrations:await loadActiveOrganizationSourceRegistrations(tx,{organizationId}) });
  const preview: ConfigSetImportPreview = { proofToken, name: input.name, ownership: input.ownership, entryFile: manifest.entryFile,
    members: manifest.members.map(row => ({ sourceName: row.sourceName, format: row.format, ownership: input.ownership === "reuse" && row.shared ? "shared" : "private" })),
    sharedVersions: resources.map(row => ({ name: row.name, version: row.version, mountPath: row.mountPath })),
    nodeCount: resolved?.effective.nodesByLocator.size ?? 0, diagnostics: (resolved?.diagnostics ?? []).map(({ severity, message }) => ({ severity, message })) };
  return { manifest, contents, catalog, resources, declared, effective, resolved, preview };
}

export async function previewConfigSetImport(db: Database, auth: AuthContext, projectId: string, input: ConfigSetImportBody, security: CanonicalSourceSecurityContext) {
  await requireCanonicalUserInvocation(auth, security, { projectId, operation: "configuration package preview", targetType: "project", targetId: projectId });
  const catalog=await loadSnapshot(db);
  try { return await db.transaction(async tx => {
    auth = await requireCurrentSourceAdministrator(tx, auth, projectId);
    return (await inspect(tx, auth, projectId, input, catalog)).preview;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}

export async function applyConfigSetImport(db: Database, storage: ObjectStore, auth: AuthContext, projectId: string,
  input: ConfigSetImportBody & { proofToken: string; reason: string; clientMutationId: string }, security: CanonicalSourceSecurityContext): Promise<ConfigSetImportResult> {
  await requireCanonicalUserInvocation(auth, security, { projectId, operation: "configuration package import", targetType: "project", targetId: projectId });
  const catalog=await loadSnapshot(db);
  try { return await withCanonicalSourceAttemptTransaction(db, storage, async (tx, attempt) => {
    auth = await requireCurrentSourceAdministrator(tx, auth, projectId);
    const organizationId = parameterOrganizationId(auth), mutationDigest = sourceRevisionDigest(input);
    const operationId = `config-import-${sourceRevisionDigest([organizationId, projectId, auth.user.id, input.clientMutationId])}`;
    await tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [operationId]);
    const replay = (await tx.query<{ metadata: { mutationDigest: string; result: ConfigSetImportResult } }>(`select metadata from audit_events
      where organization_id=$1 and project_id=$2 and actor_user_id=$3 and target_type='dts-config-set' and target_id=$4 and kind='config-set' and action='imported'`, [organizationId, projectId, auth.user.id, operationId])).rows[0];
    if (replay) { if (replay.metadata.mutationDigest !== mutationDigest) conflict("此操作编号已用于不同配置导入。"); return replay.metadata.result; }
    const plan = await inspect(tx, auth, projectId, input, catalog);
    if (input.proofToken !== plan.preview.proofToken) conflict("导入预览已过期；请重新预览，当前项目未改变。");
    for (const [nodePath,node] of plan.resolved?.effective.nodesByLocator ?? []) await assertTrustedSensitiveNodeWriteAllowed(tx, auth, {
      organizationId, projectId, nodePath, sourcePath: { kind: "node-locator", value: nodePath },
      compatible: node.properties.get("compatible")?.rawText ?? null, compatibleIsAuthoritative: true, ...security });
    await insertConfigSet(tx, { id: operationId, organizationId, projectId, name: input.name });
    const members: ConfigRevisionManifestMember[] = [], attribution = trustedDomainAttribution(security.invocation);
    for (const member of plan.manifest.members) {
      const fileId = randomUUID(), fileVersionId = randomUUID(), content = plan.contents.get(member.sourceName)!;
      await insertProjectParameterFile(tx, { id: fileId, organizationId, projectId, fileName: member.sourceName, format: member.format, enabled: true });
      const stored = await attempt.objectStore.put({ organizationId, fileName: `${randomUUID()}.${member.format}`, contentType: member.format === "json" ? "application/json" : "text/plain", bytes: Buffer.from(content) });
      if (!attempt.objectStore.getBounded || sourceRevisionDigest(await attempt.objectStore.getBounded(stored.storageKey, configSetPackageLimits.maxFileBytes)) !== member.checksum.slice(7)) conflict("导入对象写入校验失败；所有变更已回滚。");
      await insertFileVersion(tx, { id: fileVersionId, fileId, versionNumber: 1, storageKey: stored.storageKey, checksum: member.checksum,
        sizeBytes: Buffer.byteLength(content), origin: "upload", attribution });
      await setCurrentVersion(tx, { fileId, versionId: fileVersionId });
      await tx.query("update project_parameter_files set config_set_id=$2,config_set_role=$3,config_set_sort_order=$4 where id=$1", [fileId, operationId, member.role === "include" ? "misc" : member.role, member.sortOrder]);
      members.push({ ...member, fileId, fileVersionId, fileName: member.sourceName, content });
      if (member.format === "dts" && !/\.(?:h|hpp)$/u.test(member.sourceName)) await ingestDtsFileVersion(tx, fileVersionId, content,
        plan.resolved?.preprocessing?.originalDocuments.get(member.sourceName), plan.resolved ? new Set(plan.resolved.effective.nodesByLocator.keys()) : undefined);
    }
    for (const resource of plan.resources) {
      const referenceId = randomUUID();
      await tx.query(`insert into project_shared_dtsi_references(id,organization_id,project_id,config_set_id,resource_id,revision_id,created_by_user_id,mount_path,is_direct)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [referenceId, organizationId, projectId, operationId, resource.resourceId, resource.versionId, auth.user.id, resource.mountPath, resource.direct]);
      for (const source of resource.item.members) {
        const member = members.find(row => row.fileName === mountedSharedPath(resource.mountPath, source.sourceName))!;
        await tx.query("insert into project_shared_dtsi_snapshots(file_id,file_version_id,reference_id,revision_id,member_id) values ($1,$2,$3,$4,$5)", [member.fileId, member.fileVersionId, referenceId, resource.versionId, source.id]);
      }
    }
    let revisionId: string | undefined;
    if (plan.manifest.entryFile) {
      const revision = await ingestConfigRevisionInTransaction(tx, { organizationId, projectId, configSetId: operationId,
        entryFile: plan.manifest.entryFile, includeSearchPaths: plan.manifest.includeSearchPaths, overlayOrder: plan.manifest.overlayOrder,
        defines: plan.effective.defines, declaredBuildInputs: plan.declared, preprocessing: plan.manifest.preprocessing, members }, auth, { createdByUserId: auth.user.id, domain: attribution });
      if (revision.status !== "resolved") conflict("导入配置未能完整构建；所有变更已回滚。");
      revisionId = revision.id;
      if (plan.catalog) {
        await syncPublishedCatalogProjectValuesInTransaction(asValueClient(tx), plan.catalog, { organizationId, projectId, configSetId: operationId, configRevisionId: revisionId });
        await produceDtsReviewEvidenceInTransaction(tx, db, storage, auth, revisionId);
      }
    } else if (!plan.manifest.jsonSources.length) {
      revisionId = randomUUID();
      await insertConfigRevision(tx, { id: revisionId, organizationId, projectId, configSetId: operationId, revisionNumber: 1, status: "resolved", attribution });
      await insertConfigRevisionMembers(tx, revisionId, members);
    }
    for (const source of plan.manifest.jsonSources) {
      const member = members.find(row => row.fileName === source.sourceName)!;
      const registered = await registerCanonicalJsonSource(tx, storage, auth, plan.catalog!, { ...source, projectId, configSetId: operationId,
        fileId: member.fileId, fileVersionId: member.fileVersionId, ...security });
      const binding=registered.bindings[0];
      if (!binding) conflict("JSON 来源没有生成可验证的新项目参数。");
      const pin=await loadOwnedProjectValueSourcePin(tx,{organizationId,projectId,bindingId:binding.id,projectValueId:binding.currentValueId});
      if (!pin || revisionId && revisionId!==pin.configRevisionId) return conflict("JSON 来源与完整配置修订不一致，所有变更已回滚。");
      revisionId=pin.configRevisionId;
    }
    if (!revisionId) return conflict("配置缺少完整的来源修订，所有变更已回滚。");
    const result: ConfigSetImportResult = { configSetId: operationId, configRevisionId: revisionId, fileIds: members.map(row => row.fileId), ownership: input.ownership };
    await writeTrustedAuditEventInTx(asAuditTx(tx), { invocation: security.invocation, app: "parameters", kind: "config-set", action: "imported", severity: "Medium",
      projectId, targetType: "dts-config-set", targetId: operationId, traceId: security.requestId,
      metadata: { mutationDigest, reason: input.reason, ownership: input.ownership, proofDigest: plan.preview.proofToken, result,
        sharedComposition:plan.resources.map(resource=>({resourceId:resource.resourceId,versionId:resource.versionId,digest:resource.digest,
          name:resource.name,version:resource.version,mountPath:resource.mountPath,direct:resource.direct,
          sources:resource.item.members.map(source=>{const member=members.find(row=>row.sourceName===mountedSharedPath(resource.mountPath,source.sourceName))!;
            return {memberId:source.id,fileId:member.fileId,fileVersionId:member.fileVersionId,sourceName:member.sourceName};})})),
        sourceOverlayFileIds:members.filter(member=>plan.manifest.formerRootOverlayFiles.includes(member.fileName)).map(member=>member.fileId) } });
    return result;
  }); } catch (error) { rethrowSourceTransactionError(error); }
}
