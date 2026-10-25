import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { parameterUsageProjectScope } from "../parameter-kernel/policy";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { ApiError } from "../../shared/http/errors";
import { requireRead } from "./service";
import { parameterOrganizationId, withParameterAccess } from "../parameters/operatingScope";
import { getSharedDtsiResourceDetail } from "./publication";

export async function listSharedDtsiUsages(db:Database,auth:AuthContext,resourceId:string,input:{offset:number;limit:number}) {
  const requestedOrganizationId=parameterOrganizationId(auth),current=await getAuthContext(db,auth.user.id);
  if(current.organization.id!==auth.organization.id)throw new ApiError("FORBIDDEN","账户所属组织已变化，请重新登录后访问共享资源。",{reason:"authentication-scope-changed"});
  requireRead(current);
  const authorized=withParameterAccess(current,await resolveOperatingContext(db,createUserInvocation(current),requestedOrganizationId));
  await getSharedDtsiResourceDetail(db,authorized,resourceId);
  const scope=parameterUsageProjectScope(authorized);
  if(!scope)throw new ApiError("FORBIDDEN","当前项目使用范围不可用。");
  const values=[parameterOrganizationId(authorized),resourceId,scope.kind==="all"?null:scope.ids];
  const from=`from public.project_shared_dtsi_references ref
    join public.projects project on project.id=ref.project_id and project.organization_id=ref.organization_id
    join public.dts_config_set config on config.id=ref.config_set_id and config.project_id=project.id
    join public.shared_dtsi_revisions version on version.id=ref.revision_id
    where ref.organization_id=$1 and ref.resource_id=$2 and ($3::text[] is null or ref.project_id=any($3::text[]))`;
  const items=(await db.query<{projectId:string;projectName:string;configSetId:string;configSetName:string;versionId:string;version:number;direct:boolean}>(
    `select ref.project_id as "projectId",project.name as "projectName",ref.config_set_id as "configSetId",config.name as "configSetName",
      ref.revision_id as "versionId",version.version,ref.is_direct as direct ${from} order by project.name,ref.project_id,ref.config_set_id limit $4 offset $5`,[...values,input.limit,input.offset])).rows;
  const total=Number((await db.query<{count:string}>(`select count(*) ${from}`,values)).rows[0]!.count);
  return {items,total,visibility:scope.kind==="all"?"organization" as const:"authorized-projects" as const};
}
