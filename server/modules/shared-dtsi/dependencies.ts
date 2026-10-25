import { createHash } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { SharedDtsiDraft, SharedDtsiManifest, SharedDtsiVersion } from "../contracts/dtoSchemas/sharedDtsi";
import { sharedDtsiDependencySchema } from "../contracts/dtoSchemas/sharedDtsi";
import { getSharedDtsiVersion } from "./publication";

type Pin=NonNullable<SharedDtsiManifest["dependencies"]>[number];
export type SharedDtsiClosureResource=NonNullable<SharedDtsiManifest["dependencyClosure"]>[number] & {item:SharedDtsiVersion;direct:boolean};
export const mountedSharedPath=(mountPath:string,sourceName:string)=>mountPath?`${mountPath}/${sourceName}`:sourceName;
const invalid=(message:string):never=>{throw new ApiError("VALIDATION_FAILED",message,{reason:"shared-dependency-conflict"});};

/** Resolve only exact organization-authorized immutable revisions, in declared dependency order. */
export async function loadSharedDtsiClosure(db:Database,auth:AuthContext,pins:Pin[],ownerResourceId?:string) {
  const resources:SharedDtsiClosureResource[]=[],seen=new Map<string,SharedDtsiClosureResource>(),paths=new Set<string>();
  let bytes=0,files=0;
  const visit=async(pin:Pin,ancestors:string[],direct:boolean):Promise<void>=>{
    if(!sharedDtsiDependencySchema.safeParse(pin).success)invalid("传递依赖挂载路径超过边界或包含不安全目录。");
    if(ancestors.includes(pin.resourceId))invalid(`共享资源依赖循环：${[...ancestors,pin.resourceId].map(id=>seen.get(id)?.name??"当前资源").join(" → ")}。`);
    if(ancestors.length>=16)invalid("共享资源依赖超过 16 层。");
    const previous=seen.get(pin.resourceId);
    if(previous) {
      if(previous.versionId!==pin.versionId || previous.mountPath!==pin.mountPath)invalid(`${previous.name}：同一资源的版本或挂载路径冲突。`);
      previous.direct ||= direct;return;
    }
    if(resources.length>=64)invalid("共享资源闭包超过 64 个资源。");
    const item=await getSharedDtsiVersion(db,auth,pin.resourceId,pin.versionId);
    const resource={...pin,name:item.name,version:item.version,digest:item.digest,item,direct};
    seen.set(pin.resourceId,resource);resources.push(resource);
    for(const member of item.members) {
      const path=mountedSharedPath(pin.mountPath,member.sourceName).normalize("NFC");
      if(path.length>240 || path.split("/").length>16)invalid(`${item.name}：完整挂载路径超过 240 字符或 16 层。`);
      if(paths.has(path))invalid(`${path}：共享资源挂载路径重复。`);
      paths.add(path);files++;bytes+=member.sizeBytes;
      if(files>128 || bytes>16_777_216)invalid("共享资源闭包超过 128 个文件或 16 MiB。");
      if(member.sizeBytes!==Buffer.byteLength(member.content) || member.checksum!==`sha256:${createHash("sha256").update(member.content).digest("hex")}`)invalid(`${item.name}：固定版本源码校验失败。`);
    }
    for(const child of item.manifest.dependencies??[])await visit({...child,mountPath:mountedSharedPath(pin.mountPath,child.mountPath).replace(/\/$/u,"")},[...ancestors,pin.resourceId],false);
    const actual=resources.filter(row=>row!==resource && row.mountPath.startsWith(pin.mountPath?`${pin.mountPath}/`:""));
    for(const frozen of item.manifest.dependencyClosure??[]) {
      const resolved=actual.find(row=>row.resourceId===frozen.resourceId);
      if(!resolved || resolved.versionId!==frozen.versionId || resolved.digest!==frozen.digest || resolved.mountPath!==mountedSharedPath(pin.mountPath,frozen.mountPath).replace(/\/$/u,""))invalid(`${item.name}：固定依赖闭包与发布证明不一致。`);
    }
  };
  for(const pin of pins)await visit(pin,ownerResourceId?[ownerResourceId]:[],true);
  return resources;
}
export function closureMembers(resources:SharedDtsiClosureResource[]):SharedDtsiDraft["members"] {
  return resources.flatMap(resource=>resource.item.members.map(member=>({...member,sourceName:mountedSharedPath(resource.mountPath,member.sourceName)})));
}
export function closureManifest(resources:SharedDtsiClosureResource[]) {
  return resources.map(({item:_item,direct:_direct,...pin})=>pin);
}
