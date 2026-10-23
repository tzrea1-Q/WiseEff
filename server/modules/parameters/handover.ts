import type { z } from "zod";
import { createHash } from "node:crypto";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { getAuthContext } from "../auth/repository";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import { canAdminParameters, canEditParameters, canMergeParameters, canReviewParameters, canReviewParameterStage } from "../parameter-kernel/policy";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { parameterInvocation, parameterOrganizationId, withParameterAccess } from "./operatingScope";
import { notifyUsers } from "../notifications/service";
import { isSourceRevisionReviewer } from "../parameter-files/sourceRevisionService";
import { writeTrustedGovernanceAudit } from "../parameter-topology/governanceAudit";
import { canOperateInOrganization } from "../auth/policy";
import { projectHandoverKinds, projectHandoverBodySchema } from "../contracts/dtoSchemas/organizationAssetHandover";
export { projectHandoverParamsSchema, projectHandoverBodySchema } from "../contracts/dtoSchemas/organizationAssetHandover";

type Kind = typeof projectHandoverKinds[number];
type Work = { id: string; kind: Kind; projectId: string; projectName: string; title: string; responsibleUserId: string | null; responsibleUserName: string | null; updatedAt: string; historicalAttribution: unknown; submitterUserId: string | null; requestKind: string | null; proofDigest: string | null };
export type ProjectHandoverItem = Work & { version: string; responsibleUserName: string | null; pending: boolean; candidates: Array<{ id: string; name: string }> };

function requireAdministrator(auth: AuthContext) {
  if (!canAdminParameters(auth) || !auth.permissions.includes("users:manage") || !auth.roles.some(role => role.projectId === null && ["admin", "platform-admin"].includes(role.roleId))) {
    throw new ApiError("FORBIDDEN", "业务交接需要组织管理员权限。");
  }
}
function version(work: Work) { return createHash("sha256").update(JSON.stringify([work.kind,work.id,work.projectId,work.responsibleUserId,work.updatedAt,work.proofDigest])).digest("hex"); }
async function readWork(db: Queryable, organizationId: string): Promise<Work[]> {
  return (await db.query<Work>(`select a.*,p.name as "projectName",responsible.name as "responsibleUserName" from (
    select id,'parameter-draft' as kind,project_id as "projectId",coalesce(nullif(reason,''),'参数草稿') as title,user_id as "responsibleUserId",updated_at::text as "updatedAt",historical_attribution-'execution' as "historicalAttribution",null::text as "submitterUserId",null::text as "requestKind",null::text as "proofDigest" from parameter_drafts d where organization_id=$1
      and not exists(select 1 from parameter_change_requests r where r.organization_id=d.organization_id and r.project_id=d.project_id and r.status in ('submitted','hardware_review','software_review','software_merge') and r.candidate_config_revision_id=d.candidate_config_revision_id and r.candidate_config_revision_id is not null)
    union all
    select id,'value-draft',project_id,coalesce(nullif(reason,''),'参数值草稿'),user_id,updated_at::text,historical_attribution,null,null,null from project_parameter_value_drafts d where organization_id=$1
      and not exists(select 1 from project_parameter_value_change_requests r where r.organization_id=d.organization_id and r.project_id=d.project_id and r.draft_id=d.id and r.status='pending')
    union all
    select d.id,'source-draft',d.project_id,'配置源码 · ' || d.file_name,d.responsible_user_id,d.updated_at::text,d.historical_attribution,null,null,null
      from project_parameter_file_candidates d where d.organization_id=$1 and d.status in ('ready','blocked','failed','stale') and d.activated_at is null and d.abandoned_at is null
        and not exists(select 1 from project_parameter_value_change_requests r where r.organization_id=d.organization_id and r.project_id=d.project_id and r.candidate_id=d.id)
        and not exists(select 1 from project_parameter_value_drafts v where v.organization_id=d.organization_id and v.project_id=d.project_id and v.candidate_id=d.id)
    union all
    select d.id,'initialization-draft',d.project_id,'项目初始化草稿',d.owner_user_id,d.updated_at::text,d.historical_attribution,null,null,null from project_parameter_initialization_drafts d join projects p on p.id=d.project_id and p.organization_id=d.organization_id
      where d.organization_id=$1 and p.initialization_status in ('initialization_draft','initialization_pending_review','initialization_rejected')
    union all
    select r.id,stage.kind,r.project_id,'参数变更 · ' || left(r.target_value,80),stage.owner,r.updated_at::text,r.historical_attribution,r.submitter_user_id,null,null
      from parameter_change_requests r cross join lateral (values
        ('hardware-review',coalesce(r.workflow_hardware_committer_user_id,case when r.status in ('submitted','hardware_review') then r.assigned_to_user_id end),r.status in ('submitted','hardware_review')),
        ('software-review',coalesce(r.workflow_software_committer_user_id,case when r.status='software_review' then r.assigned_to_user_id end),r.status='software_review' or (r.staged_workflow and r.status in ('submitted','hardware_review'))),
        ('software-merge',coalesce(r.workflow_software_user_id,case when r.status='software_merge' then r.assigned_to_user_id end),r.status='software_merge' or (r.staged_workflow and r.status in ('submitted','hardware_review','software_review')))
      ) stage(kind,owner,visible) where r.organization_id=$1 and stage.visible
    union all
    select r.id,'value-review',r.project_id,coalesce(nullif(r.reason,''),'配置变更审核'),r.assigned_to_user_id,r.updated_at::text,r.historical_attribution,r.submitter_user_id,r.request_kind,r.source_revision_proof_digest
      from project_parameter_value_change_requests r where r.organization_id=$1 and r.status='pending'
  ) a join projects p on p.id=a."projectId" and p.organization_id=$1 left join users responsible on responsible.id=a."responsibleUserId" order by a."updatedAt" desc,a.id`, [organizationId])).rows;
}
export async function listProjectHandovers(db: Database, auth: AuthContext) {
  requireAdministrator(auth); const organizationId = parameterOrganizationId(auth);
  const work = await readWork(db, organizationId);
  const users = (await db.query<{ id: string }>("select id from users where (organization_id=$1 or id=any($2::text[])) and is_active order by name,id", [organizationId, work.flatMap(item => item.responsibleUserId ? [item.responsibleUserId] : [])])).rows;
  const contexts = (await Promise.all(users.map(user => activeContext(db, user.id)))).filter((context): context is AuthContext => context !== null);
  if (!contexts.some(context => context.user.id === auth.user.id)) contexts.push(auth);
  const items: ProjectHandoverItem[] = await Promise.all(work.map(async item => {
    const eligible = await Promise.all(contexts.map(candidate => qualifies(db, candidate, item, organizationId)));
    const candidates = contexts.filter((candidate, index) => eligible[index] && (candidate.organization.id === organizationId || candidate.user.id === auth.user.id)).map(candidate => ({ id: candidate.user.id, name: candidate.user.name }));
    const responsible = contexts.find((candidate, index) => candidate.user.id === item.responsibleUserId && candidate.organization.id === organizationId && eligible[index]);
    return { ...item, version: version(item), candidates, pending: !responsible };
  }));
  return { items };
}
async function activeContext(db: Queryable, userId: string) {
  try { return await getAuthContext(db, userId); }
  catch (error) { if (error instanceof ApiError && ["NOT_FOUND", "FORBIDDEN", "UNAUTHENTICATED"].includes(error.code)) return null; throw error; }
}
async function qualifies(db: Database, candidate: AuthContext, item: Work, organizationId: string) {
  if (!canOperateInOrganization(candidate, organizationId)) return false;
  if (item.kind === "source-draft") return canAdminParameters(candidate) && canEditParameters(candidate, item.projectId);
  if (item.kind.endsWith("draft")) return canEditParameters(candidate, item.projectId);
  if (candidate.user.id === item.submitterUserId) return false;
  if (item.kind === "software-merge") return canMergeParameters(candidate, item.projectId);
  const stage = item.kind === "hardware-review" ? "hardware_review" : "software_review";
  if (!canReviewParameters(candidate) || !canReviewParameterStage(candidate, item.projectId, stage)) return false;
  if (item.kind === "value-review" && item.requestKind !== "single" && !canEditParameters(candidate, item.projectId)) return false;
  if (item.requestKind === "source_revision") return isSourceRevisionReviewer(db, candidate, item.projectId);
  return true;
}
async function lockWork(db: Queryable, kind: Kind, id: string, organizationId: string) {
  const args = [id, organizationId];
  if (kind === "parameter-draft") return db.query("select id from parameter_drafts where id=$1 and organization_id=$2 for update", args);
  if (kind === "value-draft") return db.query("select id from project_parameter_value_drafts where id=$1 and organization_id=$2 for update", args);
  if (kind === "source-draft") return db.query("select id from project_parameter_file_candidates where id=$1 and organization_id=$2 for update", args);
  if (kind === "initialization-draft") return db.query("select id from project_parameter_initialization_drafts where id=$1 and organization_id=$2 for update", args);
  if (kind === "value-review") return db.query("select id from project_parameter_value_change_requests where id=$1 and organization_id=$2 for update", args);
  return db.query("select id from parameter_change_requests where id=$1 and organization_id=$2 for update", args);
}
async function updateOwner(db: Queryable, item: Work, organizationId: string, successor: string | null) {
  const args = [item.id, organizationId, successor];
  if (item.kind === "parameter-draft") return db.query(`update parameter_drafts set user_id=$3,updated_at=clock_timestamp(),
    initiator_type=case when $3::text is null then 'legacy' else 'user' end,initiator_session_id=null,initiator_tool_call_id=null,initiator_approval_id=null,initiator_system_kind=null,initiator_system_name=null where id=$1 and organization_id=$2`, args);
  if (item.kind === "value-draft") return db.query("update project_parameter_value_drafts set user_id=$3,updated_at=clock_timestamp() where id=$1 and organization_id=$2", args);
  if (item.kind === "source-draft") return db.query("update project_parameter_file_candidates set responsible_user_id=$3,updated_at=clock_timestamp() where id=$1 and organization_id=$2", args);
  if (item.kind === "initialization-draft") return db.query("update project_parameter_initialization_drafts set owner_user_id=$3,updated_at=clock_timestamp() where id=$1 and organization_id=$2", args);
  if (item.kind === "value-review") return db.query("update project_parameter_value_change_requests set assigned_to_user_id=$3,updated_at=clock_timestamp() where id=$1 and organization_id=$2 and status='pending'", args);
  if (item.kind === "hardware-review") return db.query("update parameter_change_requests set workflow_hardware_committer_user_id=$3,assigned_to_user_id=case when status in ('submitted','hardware_review') then $3 else assigned_to_user_id end,updated_at=clock_timestamp() where id=$1 and organization_id=$2", args);
  if (item.kind === "software-review") return db.query("update parameter_change_requests set workflow_software_committer_user_id=$3,assigned_to_user_id=case when status='software_review' then $3 else assigned_to_user_id end,updated_at=clock_timestamp() where id=$1 and organization_id=$2", args);
  return db.query("update parameter_change_requests set workflow_software_user_id=$3,assigned_to_user_id=case when status='software_merge' then $3 else assigned_to_user_id end,updated_at=clock_timestamp() where id=$1 and organization_id=$2", args);
}
export async function assignProjectHandover(db: Database, auth: AuthContext, kind: Kind, id: string, body: z.infer<typeof projectHandoverBodySchema>, requestId: string) {
  requireAdministrator(auth); const organizationId = parameterOrganizationId(auth);
  const invocation = parameterInvocation(auth);
  if (!invocation) throw new ApiError("INTERNAL_ERROR", "业务交接缺少真实操作来源。");
  requireUserInitiatedInvocation(invocation);
  try {
    return await db.transaction(async tx => {
      // Role edits, activation and transfers take the same user locks. Read
      // authority after obtaining them so a committed revocation wins.
      await tx.query("select id from users where id=any($1::text[]) order by id for no key update", [[auth.user.id, ...(body.responsibleUserId ? [body.responsibleUserId] : [])].sort()]);
      const actor = await getAuthContext(tx, auth.user.id);
      const scoped = withParameterAccess(actor, invocation);
      requireAdministrator(scoped);
      const locked = await lockWork(tx, kind, id, organizationId);
      if (!locked.rowCount) throw new ApiError("NOT_FOUND", "待交接项目业务不存在。");
      const item = (await readWork(tx, organizationId)).find(work => work.kind === kind && work.id === id);
      if (!item) throw new ApiError("CONFLICT", "该业务已经提交或结束，请刷新清单。");
      if (version(item) !== body.expectedVersion) throw new ApiError("CONFLICT", "草稿或责任人已变化，请刷新后重试。");
      if (body.responsibleUserId) {
        const successor = await activeContext(tx, body.responsibleUserId);
        if (!successor || !await qualifies(tx, successor, item, organizationId) || (successor.organization.id !== organizationId && successor.user.id !== actor.user.id)) throw new ApiError("VALIDATION_FAILED", "接任者须为当前组织有效成员，并已具备对应项目编辑、审核或合入资格；提交人不能接任自己的审核。");
      }
      if (item.responsibleUserId === body.responsibleUserId) return;
      if (item.requestKind === "source_revision") {
        await writeTrustedGovernanceAudit(asAuditTx(tx), invocation, { action: "source-request-reassigned", organizationId, projectId: item.projectId,
          targetType: "project-parameter-value-change-request", targetId: item.id,
          metadata: { requestKind: "source_revision", proofDigest: item.proofDigest, fromAssignedToUserId: item.responsibleUserId, toAssignedToUserId: body.responsibleUserId } }, requestId);
      }
      await updateOwner(tx, item, organizationId, body.responsibleUserId);
      await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, { app: "parameters", kind: "project-handover", action: "assign-responsibility", severity: "Medium", projectId: item.projectId, targetType: kind, targetId: id,
        metadata: { previousResponsibleUserId: item.responsibleUserId, responsibleUserId: body.responsibleUserId } });
      if (body.responsibleUserId && !kind.endsWith("draft")) await notifyUsers(tx, { organizationId, recipientUserIds: [body.responsibleUserId], category: "parameter.review.handover", title: `项目待办交接 · ${item.projectName}`,
        body: item.title, severity: "info", actionUrl: `/parameter-review?project=${encodeURIComponent(item.projectId)}&request=${encodeURIComponent(item.id)}`,
        sourceKind: kind, sourceId: `${item.id}:${body.expectedVersion}`, metadata: { projectId: item.projectId, requestId: item.id } });
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new ApiError("CONFLICT", "接任者已有同一参数的草稿；请先处理该草稿，再交接，避免覆盖。 ");
    throw error;
  }
}
