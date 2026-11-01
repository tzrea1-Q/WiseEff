import type { Database } from "../../shared/database/client";
import type { AuthContext } from "../auth/types";
import { canAdminParameters, canEditParameters, parameterUsageProjectScope } from "../parameter-kernel/policy";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { ApiError } from "../../shared/http/errors";
import { requireRead } from "./service";
import { parameterOrganizationId, withParameterAccess } from "../parameters/operatingScope";
import { getSharedDtsiResourceDetail } from "./publication";
import { sharedDtsiManifestSchema, type SharedDtsiProjectUsages } from "../contracts/dtoSchemas/sharedDtsi";

async function authorizeUsageRead(db:Database,auth:AuthContext) {
  const requestedOrganizationId=parameterOrganizationId(auth),current=await getAuthContext(db,auth.user.id);
  if(current.organization.id!==auth.organization.id)throw new ApiError("FORBIDDEN","账户所属组织已变化，请重新登录后访问共享资源。",{reason:"authentication-scope-changed"});
  requireRead(current);
  const authorized=withParameterAccess(current,await resolveOperatingContext(db,createUserInvocation(current),requestedOrganizationId));
  return {current,authorized};
}

export async function listSharedDtsiProjectUsages(db:Database,auth:AuthContext,input:{q:string;status:"all"|"referenced"|"unreferenced";offset:number;limit:number;projectId?:string;configSetId?:string}):Promise<SharedDtsiProjectUsages> {
  const {current,authorized}=await authorizeUsageRead(db,auth);
  const scope=parameterUsageProjectScope(authorized);
  if(!scope)throw new ApiError("FORBIDDEN","当前项目使用范围不可用。");
  const values=[parameterOrganizationId(authorized),scope.kind==="all"?null:scope.ids,input.q,input.status];
  const referenced=`exists(select 1 from public.project_shared_dtsi_references r where r.organization_id=p.organization_id and r.project_id=p.id and r.config_set_id=c.id)`;
  const from=`from public.projects p left join public.dts_config_set c on c.organization_id=p.organization_id and c.project_id=p.id
    left join lateral (select latest.id,latest.entry_file from public.dts_config_revisions latest where latest.organization_id=p.organization_id
      and latest.project_id=p.id and latest.config_set_id=c.id and latest.status='resolved' order by latest.revision_number desc limit 1) rev on true
    where p.organization_id=$1 and ($2::text[] is null or p.id=any($2::text[]))
    and ($7::text is null or p.id=$7) and ($8::text is null or c.id=$8)
    and ($3='' or position(lower($3) in lower(p.name))>0 or position(lower($3) in lower(p.code))>0
      or position(lower($3) in lower(c.name))>0 or exists(select 1 from public.project_shared_dtsi_references r
        join public.shared_dtsi_revisions v on v.id=r.revision_id and v.organization_id=r.organization_id
        where r.organization_id=p.organization_id and r.project_id=p.id and r.config_set_id=c.id and position(lower($3) in lower(v.name))>0))
    and ($4='all' or ($4='referenced' and ${referenced}) or ($4='unreferenced' and not ${referenced}))`;
  type Row={projectId:string;projectName:string;projectCode:string;configSetId:string|null;configSetName:string|null;configurationIssue:"no-configuration"|"no-resolved-source"|"missing-root"|"source-changed"|null};
  type Ref={configSetId:string;resourceId:string;resourceName:string;versionId:string;version:number;direct:boolean;state:"active"|"retired";upgradeAvailable:boolean;manifest:unknown};
  const result=(await db.query<{items:Row[];total:number;references:Ref[]}>(`with page as materialized (
    select p.id as "projectId",p.name as "projectName",p.code as "projectCode",c.id as "configSetId",c.name as "configSetName",
    case when c.id is null then 'no-configuration' when rev.id is null then 'no-resolved-source'
      when not exists(select 1 from public.dts_config_revision_members m join public.project_parameter_files root on root.id=m.file_id
        and root.organization_id=p.organization_id and root.project_id=p.id and root.config_set_id=c.id and root.format='dts'
        where m.config_revision_id=rev.id and m.source_name=rev.entry_file and m.role='base'
        and not exists(select 1 from public.project_shared_dtsi_snapshots snapshot where snapshot.file_id=root.id)) then 'missing-root'
      when (select count(*) from public.dts_config_revision_members m where m.config_revision_id=rev.id)<>
        (select count(*) from public.project_parameter_files f where f.organization_id=p.organization_id and f.project_id=p.id and f.config_set_id=c.id)
      or exists(select 1 from public.dts_config_revision_members m left join public.project_parameter_files f
        on f.id=m.file_id and f.organization_id=p.organization_id and f.project_id=p.id and f.config_set_id=c.id
        where m.config_revision_id=rev.id and (f.id is null or f.current_version_id is distinct from m.file_version_id
          or f.config_set_role is distinct from case when m.role='include' then 'misc' else m.role end
          or f.config_set_sort_order is distinct from m.sort_order)) then 'source-changed' else null end as "configurationIssue"
    ${from} order by p.name,p.id,c.name,c.id limit $5 offset $6
    ), refs as (
    select r.config_set_id as "configSetId",r.resource_id as "resourceId",v.name as "resourceName",
    r.revision_id as "versionId",v.version,r.is_direct as direct,s.state,
    exists(select 1 from public.shared_dtsi_revisions newer where newer.organization_id=r.organization_id and newer.resource_id=r.resource_id and newer.version>v.version) as "upgradeAvailable",v.manifest
    from public.project_shared_dtsi_references r join public.shared_dtsi_resources s on s.id=r.resource_id and s.organization_id=r.organization_id
    join public.shared_dtsi_revisions v on v.id=r.revision_id and v.organization_id=r.organization_id and v.resource_id=r.resource_id
    where r.organization_id=$1 and r.config_set_id in (select "configSetId" from page)
    ) select (select count(*)::integer ${from}) as total,
      coalesce((select jsonb_agg(to_jsonb(page) order by page."projectName",page."projectId",page."configSetName",page."configSetId") from page),'[]'::jsonb) as items,
      coalesce((select jsonb_agg(to_jsonb(refs) order by refs."resourceName",refs."resourceId") from refs),'[]'::jsonb) as references`,
    [...values,input.limit,input.offset,input.projectId??null,input.configSetId??null])).rows[0]!;
  const {items:rows,total,references:refs}=result;
  const refsByConfig=new Map<string,Ref[]>();
  for(const ref of refs){const group=refsByConfig.get(ref.configSetId)??[];group.push(ref);refsByConfig.set(ref.configSetId,group);}
  const hasAdminRole=current.roles.some(role=>role.roleId==="admin"||role.roleId==="platform-admin");
  const items=rows.map(row=>{
    const group=row.configSetId?refsByConfig.get(row.configSetId)??[]:[];
    const direct=group.filter(ref=>ref.direct).map(ref=>({ref,closure:sharedDtsiManifestSchema.parse(ref.manifest).dependencyClosure??[]}));
    const references=group.map(({configSetId:_,manifest:__,...ref})=>({...ref,requiredBy:direct.filter(parent=>parent.ref.resourceId!==ref.resourceId
      && parent.closure.some(pin=>pin.resourceId===ref.resourceId&&pin.versionId===ref.versionId))
      .map(parent=>({resourceId:parent.ref.resourceId,resourceName:parent.ref.resourceName}))}));
    return {...row,configurationReady:row.configurationIssue===null,canConfigure:Boolean(row.configSetId&&hasAdminRole&&canAdminParameters(current)&&canEditParameters(current,row.projectId)),references};
  });
  return {items,total,visibility:scope.kind==="all"?"organization":"authorized-projects"};
}

export async function listSharedDtsiUsages(db:Database,auth:AuthContext,resourceId:string,input:{offset:number;limit:number}) {
  const {authorized}=await authorizeUsageRead(db,auth);
  const detail=await getSharedDtsiResourceDetail(db,authorized,resourceId);
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
  return {items:items.map(item=>({...item,upgradeAvailable:item.version<(detail.currentVersion?.version??item.version),evaluation:"not-evaluated" as const})),total,
    visibility:scope.kind==="all"?"organization" as const:"authorized-projects" as const};
}
