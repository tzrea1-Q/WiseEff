import { randomUUID } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import { requireActiveOrganization } from "../auth/organizationLifecycle";
import type { AuthContext } from "../auth/types";
import { parameterOrganizationId } from "../parameters/operatingScope";
import { requireCanonicalUserInvocation, type CanonicalSourceSecurityContext } from "./canonicalSource";
import { isCurrentSourceAdministrator, requireCurrentSourceAdministrator } from "./sourceRevisionService";

type Intent={id:string;organization_id:string;project_id:string;config_set_id:string;actor_user_id:string;registration_id:string;mutation_id:string;status:"pending"|"applied"|"stopped";acknowledged:boolean};
type Target={projectId:string;configSetId:string};
export function canonicalMemberMutationId(mutationId:string){
  // Accept a safe superset of PostgreSQL UUID spellings so aliases share a fence.
  const text=mutationId.startsWith("{")&&mutationId.endsWith("}")?mutationId.slice(1,-1):mutationId;
  if(!/^[0-9a-f-]+$/i.test(text))return mutationId;
  const hex=text.replaceAll("-","").toLowerCase();if(!/^[0-9a-f]{32}$/.test(hex))return mutationId;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export const lockMemberAdditionOperation=(tx:Database,organizationId:string,projectId:string,userId:string,mutationId:string)=>{
  const key=canonicalMemberMutationId(mutationId);
  return tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`member-addition:${organizationId}:${projectId}:${userId}:${key}`]);
};
async function authorize(tx:Database,auth:AuthContext,projectId:string){
  await requireActiveOrganization(tx,parameterOrganizationId(auth),true);
  return requireCurrentSourceAdministrator(tx,auth,projectId);
}
async function checkTarget(tx:Database,organizationId:string,target:Target){
  const row=(await tx.query<{project_name:string;config_name:string}>(`select p.name as project_name,s.name as config_name
    from public.dts_config_set s join public.projects p on p.id=s.project_id and p.organization_id=s.organization_id
    where s.id=$1 and s.project_id=$2 and s.organization_id=$3`,[target.configSetId,target.projectId,organizationId])).rows[0];
  if(!row)throw new ApiError("NOT_FOUND","配置不存在或不可访问。");return row;
}
async function present(tx:Database,row:Intent){
  const names=await checkTarget(tx,row.organization_id,{projectId:row.project_id,configSetId:row.config_set_id});
  const receipt=row.status==='applied'?(await tx.query<{applied_source_result:{requestId:string;fileId:string;fileVersionId:string;configRevisionId:string}}>(`select applied_source_result from public.project_parameter_value_change_requests
    where organization_id=$1 and project_id=$2 and submitter_user_id=$3 and source_revision_mutation_id=$4
      and source_revision_config_set_id=$5 and request_kind='member_addition' and status='approved'`,
    [row.organization_id,row.project_id,row.actor_user_id,row.mutation_id,row.config_set_id])).rows[0]?.applied_source_result:undefined;
  const result=receipt?{requestId:receipt.requestId,fileId:receipt.fileId,fileVersionId:receipt.fileVersionId,configRevisionId:receipt.configRevisionId}:undefined;
  return {id:row.id,clientMutationId:row.mutation_id,projectId:row.project_id,projectName:names.project_name,
    configSetId:row.config_set_id,configSetName:names.config_name,status:row.status,...(result?{result}:{})};
}
async function audit(tx:Database,security:CanonicalSourceSecurityContext,row:Intent,action:string){
  const id=randomUUID();await writeTrustedAuditEventInTx(asAuditTx(tx),{id,invocation:security.invocation,app:"parameters",kind:"parameter-topology-governance",
    action,severity:"Medium",projectId:row.project_id,targetType:"member-addition-intent",targetId:row.id,
    metadata:{configSetId:row.config_set_id},traceId:security.requestId});return id;
}
export async function reserveMemberAddition(db:Database,auth:AuthContext,target:Target,registrationId:string,security:CanonicalSourceSecurityContext){
  await requireCanonicalUserInvocation(auth,security,{projectId:target.projectId,operation:"configuration member addition reservation",targetType:"dts-config-set",targetId:target.configSetId});
  return db.transaction(async tx=>{
    auth=await authorize(tx,auth,target.projectId);const organizationId=parameterOrganizationId(auth);await checkTarget(tx,organizationId,target);
    const saved=(await tx.query<Intent>("select * from public.member_addition_intents where organization_id=$1 and actor_user_id=$2 and registration_id=$3",[organizationId,auth.user.id,registrationId])).rows[0];
    if(saved && (saved.project_id!==target.projectId||saved.config_set_id!==target.configSetId))throw new ApiError("CONFLICT","此登记编号已用于其他配置。");
    const mutationId=saved?.mutation_id??randomUUID();await lockMemberAdditionOperation(tx,organizationId,target.projectId,auth.user.id,mutationId);
    if(saved)return present(tx,saved);
    if((await tx.query("select 1 from public.member_addition_intents where organization_id=$1 and actor_user_id=$2 and project_id=$3 and config_set_id=$4 and not acknowledged",[organizationId,auth.user.id,target.projectId,target.configSetId])).rowCount)
      throw new ApiError("CONFLICT","此配置有待核对的操作，请先处理。",{reason:"member-operation-pending"});
    const row:Intent={id:randomUUID(),organization_id:organizationId,project_id:target.projectId,config_set_id:target.configSetId,actor_user_id:auth.user.id,registration_id:registrationId,mutation_id:mutationId,status:"pending",acknowledged:false};
    const auditId=await audit(tx,security,row,"member-operation-reserved");
    await tx.query(`insert into public.member_addition_intents(id,organization_id,project_id,config_set_id,actor_user_id,registration_id,mutation_id,registration_audit_id)
      values($1,$2,$3,$4,$5,$6,$7,$8)`,[row.id,organizationId,row.project_id,row.config_set_id,row.actor_user_id,registrationId,mutationId,auditId]);
    return present(tx,row);
  });
}
export async function resolveMemberAdditionIntent(db:Database,auth:AuthContext,target:Target,id:string,action:"stop"|"ack",security:CanonicalSourceSecurityContext){
  await requireCanonicalUserInvocation(auth,security,{projectId:target.projectId,operation:`configuration member addition ${action}`,targetType:"dts-config-set",targetId:target.configSetId});
  return db.transaction(async tx=>{
    auth=await authorize(tx,auth,target.projectId);const organizationId=parameterOrganizationId(auth);await checkTarget(tx,organizationId,target);
    let row=(await tx.query<Intent>("select * from public.member_addition_intents where id=$1 and organization_id=$2 and project_id=$3 and config_set_id=$4 and actor_user_id=$5",[id,organizationId,target.projectId,target.configSetId,auth.user.id])).rows[0];
    if(!row)throw new ApiError("NOT_FOUND","待核对操作不存在或不可访问。");
    await lockMemberAdditionOperation(tx,organizationId,target.projectId,auth.user.id,row.mutation_id);
    row=(await tx.query<Intent>("select * from public.member_addition_intents where id=$1 for update",[id])).rows[0]!;
    if(action==="stop" && row.status==="pending"){
      const auditId=await audit(tx,security,row,"member-operation-stopped");
      row=(await tx.query<Intent>("update public.member_addition_intents set status='stopped',stop_audit_id=$2 where id=$1 returning *",[id,auditId])).rows[0]!;
    }else if(action==="ack" && !row.acknowledged){
      if(row.status==="pending")throw new ApiError("CONFLICT","操作尚未确认，请先核对或停止。");
      const auditId=await audit(tx,security,row,"member-operation-acknowledged");
      row=(await tx.query<Intent>("update public.member_addition_intents set acknowledged=true,ack_audit_id=$2 where id=$1 returning *",[id,auditId])).rows[0]!;
    }
    return present(tx,row);
  });
}
export async function listMemberAdditionIntents(db:Database,auth:AuthContext,limit:number,offset:number,security:CanonicalSourceSecurityContext,filter:{projectId?:string;configSetId?:string}={}){
  const organizationId=parameterOrganizationId(auth);
  await requireCanonicalUserInvocation(auth,security,{projectId:"",operation:"list configuration member additions",targetType:"organization",targetId:organizationId});
  return db.transaction(async tx=>{
    await requireActiveOrganization(tx,organizationId,true);
    const user=(await tx.query("select id from public.users where id=$1 and organization_id=$2 and is_active for no key update",[auth.user.id,auth.organization.id])).rows[0];
    if(!user)throw new ApiError("FORBIDDEN","当前用户无权查看待核对操作。");
    // Source administrators have organization-wide project edit rights. The user fence above
    // holds the current role snapshot stable through both the count and page reads.
    if(!await isCurrentSourceAdministrator(tx,auth,filter.projectId??""))return {items:[],total:0};
    const values=[organizationId,auth.user.id,filter.projectId??null,filter.configSetId??null];
    const where=`i.organization_id=$1 and i.actor_user_id=$2 and not i.acknowledged
      and ($3::text is null or i.project_id=$3) and ($4::text is null or i.config_set_id=$4)`;
    const total=Number((await tx.query<{count:string}>(`select count(*) as count from public.member_addition_intents i where ${where}`,values)).rows[0]!.count);
    const rows=(await tx.query<Intent & {project_name:string;config_name:string;applied_source_result:{requestId:string;fileId:string;fileVersionId:string;configRevisionId:string}|null}>(`
      select i.*,p.name as project_name,s.name as config_name,receipt.applied_source_result
      from public.member_addition_intents i
      join public.projects p on p.id=i.project_id and p.organization_id=i.organization_id
      join public.dts_config_set s on s.id=i.config_set_id and s.project_id=i.project_id and s.organization_id=i.organization_id
      left join lateral (select r.applied_source_result from public.project_parameter_value_change_requests r
        where i.status='applied' and r.organization_id=i.organization_id and r.project_id=i.project_id and r.submitter_user_id=i.actor_user_id
          and r.source_revision_mutation_id=i.mutation_id::text and r.source_revision_config_set_id=i.config_set_id
          and r.request_kind='member_addition' and r.status='approved' limit 1) receipt on true
      where ${where} order by i.created_at desc,i.id limit $5 offset $6`,[...values,limit,offset])).rows;
    return {items:rows.map(row=>({id:row.id,clientMutationId:row.mutation_id,projectId:row.project_id,projectName:row.project_name,
      configSetId:row.config_set_id,configSetName:row.config_name,status:row.status,...(row.applied_source_result?{result:{requestId:row.applied_source_result.requestId,fileId:row.applied_source_result.fileId,fileVersionId:row.applied_source_result.fileVersionId,configRevisionId:row.applied_source_result.configRevisionId}}:{})})),total};
  });
}
