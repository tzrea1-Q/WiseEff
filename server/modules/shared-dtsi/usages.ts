import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { canAdminParameters } from "../parameter-kernel/policy";
import { parameterOrganizationId } from "../parameters/operatingScope";
import { getSharedDtsiResourceDetail } from "./publication";

export async function listSharedDtsiUsages(db:Database,auth:AuthContext,resourceId:string,input:{offset:number;limit:number}) {
  await getSharedDtsiResourceDetail(db,auth,resourceId);
  const values=[parameterOrganizationId(auth),resourceId,canAdminParameters(auth),auth.user.id];
  const from=`from public.project_shared_dtsi_references ref
    join public.projects project on project.id=ref.project_id and project.organization_id=ref.organization_id
    join public.dts_config_set config on config.id=ref.config_set_id and config.project_id=project.id
    join public.shared_dtsi_revisions version on version.id=ref.revision_id
    where ref.organization_id=$1 and ref.resource_id=$2 and ($3 or exists(select 1 from public.user_role_bindings membership
      where membership.organization_id=$1 and membership.user_id=$4 and membership.project_id=ref.project_id))`;
  const items=(await db.query<{projectId:string;projectName:string;configSetId:string;configSetName:string;versionId:string;version:number;direct:boolean}>(
    `select ref.project_id as "projectId",project.name as "projectName",ref.config_set_id as "configSetId",config.name as "configSetName",
      ref.revision_id as "versionId",version.version,ref.is_direct as direct ${from} order by project.name,ref.project_id,ref.config_set_id limit $5 offset $6`,[...values,input.limit,input.offset])).rows;
  const total=Number((await db.query<{count:string}>(`select count(*) ${from}`,values)).rows[0]!.count);
  return {items,total};
}
