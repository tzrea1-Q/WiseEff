import type { Database } from "../../shared/database/client";
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

/** Explicit selection plus the retained promotion receipt, never a filename/hash discovery. */
export async function provePrivateSharedConversion(tx:Database,storage:ObjectStore,auth:AuthContext,input:{projectId:string;configSetId:string;
  configRevisionId:string;fileId:string;fileVersionId:string},resources:SharedDtsiClosureResource[]){
  const refuse=(part:string):never=>{throw new ApiError("CONFLICT",`${part}；当前配置未改变。`,{reason:"private-shared-conversion-proof"});};
  const root=resources[0];if(!root?.item.manifest.sourceEvidence)refuse("目标版本缺少私有源码发布证明");
  const rows=(await tx.query<{metadata:{organizationId:string;projectId:string;configSetId:string;configRevisionId:string;fileId:string;fileVersionId:string;
    members:Array<{fileId:string;fileVersionId:string;sourceName:string;checksum:string}>;dependencies:unknown;buildInputs:unknown;effectiveBuildInputs:unknown;evidence:{digest:string}}}>(
    `select metadata from public.audit_events where organization_id=$1 and kind='shared-dtsi-project-source' and action='import'
      and target_id=$2 and metadata->'evidence'->>'digest'=$3`,[parameterOrganizationId(auth),root.resourceId,root.item.manifest.sourceEvidence.digest])).rows;
  if(rows.length!==1)refuse("找不到唯一的原始私有源码发布记录");
  const origin=rows[0]!.metadata;
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
      if(before.sharedReference || before.format!=="dts" || before.content!==member.content || before.checksum.replace(/^sha256:/u,"")!==member.checksum.replace(/^sha256:/u,"") || before.sizeBytes!==member.sizeBytes)refuse("当前私有成员与固定共享源码不一致");
      await assertProjectSourceWritable(tx,before.fileId);
      files.push({fileId:before.fileId,fileVersionId:before.fileVersionId,sourceName,role:before.role,sortOrder:before.sortOrder,
        resourceId:resource.resourceId,versionId:resource.versionId,memberId:member.id});
    }
  }
  return {sourceEvidence:root.item.manifest.sourceEvidence.digest,files};
}
