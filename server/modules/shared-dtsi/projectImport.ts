import { createHash } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import type { ObjectStore } from "../logs/objectStore";
import { parameterUsageProjectScope } from "../parameter-kernel/policy";
import { parameterInvocation, parameterOrganizationId, withParameterAccess } from "../parameters/operatingScope";
import { loadExactSourceRevisionForProof } from "../parameter-files/sourceVersion";
import { resolveDtsConfigSet } from "../dts/configSetResolver";
import { DtsPreprocessingError, inspectDtsCppIncludes, requiresDtsPreprocessing } from "../dts/cppSources";
import { sharedDtsiDraftInputSchema, type SharedDtsiDraft } from "../contracts/dtoSchemas/sharedDtsi";
import { createSharedDtsiDraft, getSharedDtsiDraft, requireWrite, type WriteContext } from "./service";
import { sharedDtsiPublicationSource } from "./source";
import { getSharedDtsiVersion } from "./publication";

export async function importPrivateProjectSource(db: Database, objectStore: ObjectStore, auth: AuthContext,
  input: { projectId: string; configSetId: string; configRevisionId: string; fileId: string; fileVersionId: string; name: string }, context: WriteContext) {
  requireWrite(auth, context);
  const current = await getAuthContext(db, auth.user.id);
  if(current.organization.id !== auth.organization.id) throw new ApiError("FORBIDDEN", "账户所属组织已变化，请重新登录。", {reason:"authentication-scope-changed"});
  const authorized = withParameterAccess(current, await resolveOperatingContext(db, createUserInvocation(current), parameterOrganizationId(auth)));
  const security = { ...context, invocation: parameterInvocation(authorized)! };
  const invocation = requireWrite(authorized, security), scope = parameterUsageProjectScope(authorized);
  if(!scope || scope.kind === "only" && !scope.ids.includes(input.projectId)) throw new ApiError("FORBIDDEN", "没有此项目的源码读取权限。");
  return db.transaction(async tx => {
    const identity = { ...input, organizationId: parameterOrganizationId(authorized) };
    if(!(await tx.query("select id from public.projects where id=$1 and organization_id=$2 for key share",[input.projectId,identity.organizationId])).rowCount)
      throw new ApiError("NOT_FOUND","项目源码不存在。");
    const exact = await loadExactSourceRevisionForProof(tx, objectStore, identity);
    const selected = exact.members.find(member => member.fileId === input.fileId && member.fileVersionId === input.fileVersionId)!;
    if(selected.sharedReference || selected.format !== "dts" || !/\.dtsi?$/u.test(selected.sourceName))
      throw new ApiError("VALIDATION_FAILED", "请选择项目私有的 .dts 或 .dtsi 源码。");
    const files = new Map(exact.members.filter(member => member.format === "dts").map(member =>
      [member.sourceName, { content: member.content, fileVersionId: member.fileVersionId }]));
    const buildInputs = {includeSearchPaths:exact.revision.includeSearchPaths,
      defines:exact.revision.preprocessing?.defines ?? exact.revision.declaredBuildInputs.defines};
    const sourceFiles = new Set<string>();
    try {
      const source = {entryFile:selected.sourceName,includeSearchPaths:buildInputs.includeSearchPaths,defines:buildInputs.defines,overlayOrder:[],files};
      if(requiresDtsPreprocessing(files,buildInputs.defines)) {
        const graph = inspectDtsCppIncludes(source);
        const visit = (name:string) => { if(sourceFiles.has(name)) return;sourceFiles.add(name);for(const edge of graph.filter(value=>value.sourceName===name))visit(edge.target); };
        visit(selected.sourceName);
      } else {
        const resolved = resolveDtsConfigSet(source);
        const diagnostics = resolved.diagnostics.filter(item => item.severity === "error" && !["target-unresolved", "dangling-reference"].includes(item.code));
        if(diagnostics.length) throw new ApiError("VALIDATION_FAILED", "所选源码依赖不完整，项目配置已保留。", {diagnostics});
        resolved.sourceFiles.forEach(name=>sourceFiles.add(name));
      }
    } catch(error) {
      if(error instanceof ApiError)throw error;
      throw new ApiError("VALIDATION_FAILED", "所选源码或依赖无效，项目配置已保留。", {diagnostics:[{
        sourceName:error instanceof DtsPreprocessingError?error.fileName:selected.sourceName,
        message:error instanceof Error?error.message:"设备树语法无效。"}]});
    }
    const reachable = exact.members.filter(member => sourceFiles.has(member.sourceName));
    const own = reachable.filter(member => !member.sharedReference);
    const dependencies: NonNullable<SharedDtsiDraft["dependencies"]> = [];
    for(const member of reachable.filter(member => member.sharedReference)) {
      const pin = member.sharedReference!;
      const version=await getSharedDtsiVersion(tx,authorized,pin.resourceId,pin.versionId);
      const upstream=version.members.find(value=>value.id===pin.memberId);
      if(!upstream || version.digest!==pin.digest || version.version!==pin.version || upstream.content!==member.content
        || upstream.checksum.replace(/^sha256:/u,"")!==member.checksum.replace(/^sha256:/u,""))
        throw new ApiError("CONFLICT", "固定共享依赖的来源证明不可用。");
      const mountPath=member.sourceName===upstream.sourceName?"":member.sourceName.endsWith(`/${upstream.sourceName}`)
        ?member.sourceName.slice(0,-upstream.sourceName.length-1):null;
      const previous=dependencies.find(value=>value.resourceId===pin.resourceId);
      if(mountPath===null || previous && (previous.versionId!==pin.versionId || previous.mountPath!==mountPath))
        throw new ApiError("CONFLICT","冻结共享依赖的版本或挂载路径不一致。");
      if(!previous)dependencies.push({resourceId:pin.resourceId,versionId:pin.versionId,mountPath});
    }
    const parsed = sharedDtsiDraftInputSchema.safeParse({ name:input.name,
      members:own.map(member => ({sourceName:member.sourceName,content:member.content})), dependencies,buildInputs,
      changeDescription:"" });
    if(!parsed.success) throw new ApiError("VALIDATION_FAILED", "源码路径或大小不符合共享资源边界，项目配置已保留。", {issues:parsed.error.issues});
    // Validate the selected closure through the same owner as publication; external project labels remain explicit requirements.
    await sharedDtsiPublicationSource({ ...parsed.data, id:"", resourceId:"", revision:1, updatedAt:"", changeDescription:"检查私有源码依赖",
      members:reachable.map(member => ({id:member.fileVersionId,sourceName:member.sourceName,content:member.content})) });
    const origin = { organizationId:identity.organizationId, projectId:input.projectId, configSetId:input.configSetId,
      configRevisionId:input.configRevisionId, fileId:input.fileId, fileVersionId:input.fileVersionId,
      members:own.map(member => ({fileId:member.fileId,fileVersionId:member.fileVersionId,sourceName:member.sourceName,checksum:member.checksum})), dependencies,buildInputs };
    const evidence = { digest:`sha256:${createHash("sha256").update(JSON.stringify(origin)).digest("hex")}` };
    const draft = await createSharedDtsiDraft(tx, authorized, parsed.data, security);
    await tx.query("update public.shared_dtsi_drafts set source_origin=$2::jsonb where id=$1", [draft.id, JSON.stringify({evidence,...origin})]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, {requestId:context.requestId}, {app:"parameters",kind:"shared-dtsi-project-source",action:"import",severity:"Medium",
      projectId:input.projectId,targetType:"shared-dtsi-resource",targetId:draft.resourceId,metadata:{...origin,evidence}});
    return getSharedDtsiDraft(tx, authorized, draft.resourceId);
  });
}
