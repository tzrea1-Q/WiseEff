import type { Database } from "../../shared/database/client";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { parameterOrganizationId } from "../parameters/operatingScope";
import type { SharedDtsiClosureResource } from "../shared-dtsi/dependencies";
import { mountedSharedPath } from "../shared-dtsi/dependencies";
import { preparePublishedSharedDtsiSource } from "../shared-dtsi/publication";
import { assertProjectSourceWritable } from "./repository";
import { sameSourceRevision } from "./sourceRevisionService";
import { loadExactSourceRevisionForProof } from "./sourceVersion";
import { dtsBuildInputsSchema,dtsDefinesSchema } from "../contracts/dtoSchemas/dtsPreprocessing";
import { sharedDtsiDependencySchema } from "../contracts/dtoSchemas/sharedDtsi";

const originSchema=z.object({organizationId:z.string().min(1),projectId:z.string().min(1),configSetId:z.string().min(1),configRevisionId:z.string().min(1),fileId:z.string().min(1),fileVersionId:z.string().min(1),
  members:z.array(z.object({fileId:z.string().min(1),fileVersionId:z.string().min(1),sourceName:z.string().min(1),checksum:z.string().regex(/^(sha256:)?[a-f0-9]{64}$/u)})).min(1).max(128),
  dependencies:z.array(sharedDtsiDependencySchema).max(32),buildInputs:dtsBuildInputsSchema,
  effectiveBuildInputs:z.object({includeSearchPaths:z.array(z.string()).max(128),defines:dtsDefinesSchema}),evidence:z.object({digest:z.string().regex(/^sha256:[a-f0-9]{64}$/u)})});

/** Explicit selection plus the retained promotion receipt, never a filename/hash discovery. */
export async function provePrivateSharedConversion(tx:Database,storage:ObjectStore,auth:AuthContext,input:{projectId:string;configSetId:string;
  configRevisionId:string;fileId:string;fileVersionId:string},resources:SharedDtsiClosureResource[]){
  const refuse=(part:string):never=>{throw new ApiError("CONFLICT",`${part}；当前配置未改变。`,{reason:"private-shared-conversion-proof"});};
  const root=resources[0];if(!root?.item.manifest.sourceEvidence)refuse("目标版本缺少私有源码发布证明");
  const sourceEvidence=root.item.manifest.sourceEvidence!.digest;
  const rows=(await tx.query<{metadata:unknown}>(
    `select metadata from public.audit_events where organization_id=$1 and kind='shared-dtsi-project-source' and action='import'
      and target_type='shared-dtsi-resource' and actor_type='user' and project_id=metadata->>'projectId'
      and target_id=$2 and metadata->'evidence'->>'digest'=$3`,[parameterOrganizationId(auth),root.resourceId,sourceEvidence])).rows;
  if(rows.length!==1)refuse("找不到唯一的原始私有源码发布记录");
  if(!originSchema.safeParse(rows[0]!.metadata).success)refuse("原始发布记录缺少完整来源字段");
  // Retain the original JSONB value order used by the promotion owner's opaque digest.
  const origin=rows[0]!.metadata as z.infer<typeof originSchema>;
  const retainedOrigin={organizationId:origin.organizationId,projectId:origin.projectId,configSetId:origin.configSetId,configRevisionId:origin.configRevisionId,
    fileId:origin.fileId,fileVersionId:origin.fileVersionId,members:origin.members.map(({fileId,fileVersionId,sourceName,checksum})=>({fileId,fileVersionId,sourceName,checksum})),
    dependencies:origin.dependencies.map(({resourceId,versionId,mountPath})=>({resourceId,versionId,mountPath})),buildInputs:origin.buildInputs,
    effectiveBuildInputs:{includeSearchPaths:origin.effectiveBuildInputs.includeSearchPaths,defines:origin.effectiveBuildInputs.defines}};
  if(`sha256:${createHash("sha256").update(JSON.stringify(retainedOrigin)).digest("hex")}`!==sourceEvidence)refuse("原始发布记录与冻结来源摘要不同");
  if(origin.organizationId!==parameterOrganizationId(auth) || !sameSourceRevision(origin.buildInputs,{includeSearchPaths:root.item.manifest.buildInputs.includeSearchPaths,defines:root.item.manifest.buildInputs.defines??{}})
    || !sameSourceRevision(origin.dependencies,root.item.manifest.dependencies??[]))refuse("原始构建设置或固定依赖与目标版本不同");
  const original=await loadExactSourceRevisionForProof(tx,storage,{...origin,organizationId:parameterOrganizationId(auth)});
  const current=await loadExactSourceRevisionForProof(tx,storage,{...input,organizationId:parameterOrganizationId(auth)});
  const selected=current.members.find(member=>member.fileId===input.fileId&&member.fileVersionId===input.fileVersionId);
  const selectedOrigin=original.members.find(member=>member.fileId===origin.fileId&&member.fileVersionId===origin.fileVersionId);
  if(!selected || !selectedOrigin || selected.sharedReference || selected.sourceName!==mountedSharedPath(root.mountPath,selectedOrigin.sourceName))refuse("所选文件与发布来源入口不对应");
  if(root.item.members.length!==origin.members.length)refuse("目标版本成员与原始发布闭包不同");
  for(const member of root.item.members){
    const pin=origin.members.find(row=>row.sourceName===member.sourceName);
    const before=original.members.find(row=>row.fileId===pin?.fileId&&row.fileVersionId===pin.fileVersionId);
    if(!pin || !before || before.sharedReference || before.content!==member.content || before.checksum.replace(/^sha256:/u,"")!==member.checksum.replace(/^sha256:/u,"") || pin.checksum.replace(/^sha256:/u,"")!==member.checksum.replace(/^sha256:/u,""))refuse("目标版本已改变原始私有源码");
  }
  const files=[];
  for(const resource of resources){
    await preparePublishedSharedDtsiSource(tx,auth,resource.item);
    for(const member of resource.item.members){
      const sourceName=mountedSharedPath(resource.mountPath,member.sourceName),matches=current.members.filter(row=>row.sourceName===sourceName);
      if(matches.length!==1)refuse("当前配置缺少唯一的完整依赖成员");const before=matches[0]!;
      if(before.format!=="dts" || before.content!==member.content || before.checksum.replace(/^sha256:/u,"")!==member.checksum.replace(/^sha256:/u,"") || before.sizeBytes!==member.sizeBytes)refuse("当前成员与固定共享源码不一致");
      if(before.sharedReference){
        if(before.sharedReference.resourceId!==resource.resourceId || before.sharedReference.versionId!==resource.versionId
          || before.sharedReference.memberId!==member.id || before.sharedReference.digest!==resource.digest)refuse("已有共享依赖与目标固定闭包不同");
        continue;
      }
      await assertProjectSourceWritable(tx,before.fileId);
      files.push({fileId:before.fileId,fileVersionId:before.fileVersionId,sourceName,role:before.role,sortOrder:before.sortOrder,
        resourceId:resource.resourceId,versionId:resource.versionId,memberId:member.id});
    }
  }
  return {sourceEvidence,files};
}
