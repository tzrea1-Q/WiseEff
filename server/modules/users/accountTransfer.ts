import { createHash } from "node:crypto";
import type { z } from "zod";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { resolveOperatingContext } from "../auth/operatingContext";
import { getAuthContext } from "../auth/repository";
import { allowOrganizationMaintenance, requireActiveOrganization } from "../auth/organizationLifecycle";
import type { UserInvocationContext } from "../auth/trustedInvocation";
import { requireUserInitiatedInvocation } from "../auth/trustedInvocationPolicy";
import { accountTransferRequestSchema } from "../contracts/dtoSchemas/accountTransfer";
import { assertAdministratorContinuity, hasOrganizationRole, lockAdministratorMutation, type AdministratorMutationContext } from "./administratorContinuity";
import { requirePlatformOrganizationManager } from "./platformOrganizations";
import { getUserById, updateOrganizationRoles } from "./repository";
import { revokePersonalAccess } from "./personalAccess";
import { releaseTransferredProjectResponsibilities } from "../parameters/handover";
import { withParameterAccess } from "../parameters/operatingScope";
import { normalizeOidcIssuer } from "../auth/oidcIdentity";

async function transferSnapshot(db: Queryable, sourceId: string, userId: string, targetId: string, context: AdministratorMutationContext) {
  const user = await getUserById(db, { organizationId: sourceId, userId });
  if (!user) throw new ApiError("NOT_FOUND", "源组织成员不存在或已经调动，请刷新成员列表。");
  if (sourceId === targetId) throw new ApiError("VALIDATION_FAILED", "请选择不同的目标组织。");
  const organizations = (await db.query<{ id: string; name: string }>("select id,name from organizations where id=any($1::text[])", [[sourceId, targetId]])).rows;
  const source = organizations.find(org => org.id === sourceId), target = organizations.find(org => org.id === targetId);
  if (!source || !target) throw new ApiError("NOT_FOUND", "目标组织不存在。");
  const identity = (await db.query<{ issuer: string | null; subject: string | null; updatedAt: string }>(`select issuer,subject,updated_at::text as "updatedAt",
    transfer_pending_since::text,transfer_verified_at::text from user_oidc_identities where user_id=$1`, [userId])).rows[0];
  const teams = (await db.query<{ id: string; name: string }>("select t.id,t.name from organization_teams t join organization_team_members m on m.team_id=t.id and m.organization_id=t.organization_id where m.user_id=$1 order by t.id", [userId])).rows;
  const projectMemberships = (await db.query<{ projectId: string; name: string; roles: string[] }>("select m.project_id as \"projectId\",p.name,m.roles from project_members m join projects p on p.id=m.project_id and p.organization_id=m.organization_id where m.user_id=$1 order by m.project_id", [userId])).rows;
  const personalAccess = (await db.query<{ sessions: number; pairings: number; pairingCodes: number }>(`select
    (select count(*)::int from auth_sessions where user_id=$1 and revoked_at is null and expires_at>clock_timestamp()) as sessions,
    (select count(*)::int from device_bridges where user_id=$1 and revoked_at is null) as pairings,
    (select count(*)::int from device_bridge_pairing_codes where user_id=$1 and consumed_at is null and expires_at>clock_timestamp()) as "pairingCodes"`, [userId])).rows[0];
  const retainedWork = (await db.query<{ project: number; knowledge: number; feedback: number }>(`select
    ((select count(*) from parameter_drafts where organization_id=$1 and user_id=$2)
      +(select count(*) from project_parameter_value_drafts where organization_id=$1 and user_id=$2)
      +(select count(*) from project_parameter_file_candidates where organization_id=$1 and responsible_user_id=$2 and activated_at is null and abandoned_at is null)
      +(select count(*) from project_parameter_initialization_drafts d join projects p on p.id=d.project_id and p.organization_id=d.organization_id where d.organization_id=$1 and d.owner_user_id=$2 and p.initialization_status in ('initialization_draft','initialization_pending_review','initialization_rejected'))
      +(select count(*) from parameter_change_requests where organization_id=$1 and status in ('submitted','hardware_review','software_review','software_merge') and $2 in (assigned_to_user_id,workflow_hardware_committer_user_id,workflow_software_committer_user_id,workflow_software_user_id))
      +(select count(*) from project_parameter_value_change_requests where organization_id=$1 and status='pending' and assigned_to_user_id=$2))::int as project,
    ((select count(*) from knowledge_entries where organization_id=$1 and responsible_user_id=$2 and status='draft')
      +(select count(*) from knowledge_import_batches where organization_id=$1 and responsible_user_id=$2 and completed_at is null))::int as knowledge,
    (select count(*)::int from product_feedback where organization_id=$1 and ((submitted_at is null and draft_owner_user_id=$2) or (status in ('open','in_progress') and assignee_user_id=$2))) as feedback`, [sourceId, userId])).rows[0];
  const oidcIdentity = context.authenticationProvider === "oidc" && context.oidcIssuer && identity?.issuer === normalizeOidcIssuer(context.oidcIssuer) && identity.subject
    ? { issuer: identity.issuer, subject: identity.subject } : null;
  const supported = Boolean(oidcIdentity) || (context.authenticationProvider !== "oidc" && Boolean(user.username) && !identity?.issuer && !identity?.subject);
  const snapshot = { user: { id: user.id, name: user.name, username: user.username, isActive: user.isActive }, source, target,
    roles: user.roles, platformAdministrator: hasOrganizationRole(user.roles, "platform-admin"), teams, projectMemberships, personalAccess, retainedWork,
    oidcIdentity, supported, unavailableReason: supported ? null : context.authenticationProvider === "oidc"
      ? "请先将该成员显式绑定到当前身份系统的 Issuer 和 Subject，再预览调动。"
      : "此入口仅支持本地密码账号；外部身份账号需要身份系统同步流程。" };
  return { user, item: { ...snapshot, version: createHash("sha256").update(JSON.stringify([snapshot, identity])).digest("hex") } };
}

export async function previewAccountTransfer(db: Database, caller: UserInvocationContext, sourceId: string, userId: string, targetId: string, context: AdministratorMutationContext = {}) {
  requireUserInitiatedInvocation(caller); requirePlatformOrganizationManager(caller.principal);
  return db.transaction(async tx => {
    await requireActiveOrganization(tx, targetId);
    return (await transferSnapshot(tx, sourceId, userId, targetId, context)).item;
  });
}

export async function transferAccount(db: Database, caller: UserInvocationContext, sourceId: string, userId: string,
  input: z.infer<typeof accountTransferRequestSchema>, context: AdministratorMutationContext & { requestId: string }) {
  requireUserInitiatedInvocation(caller); requirePlatformOrganizationManager(caller.principal);
  const result = await db.transaction(async tx => {
    await lockAdministratorMutation(tx);
    for (const organizationId of [...new Set([sourceId, input.targetOrganizationId])].sort()) {
      if (organizationId === input.targetOrganizationId) await requireActiveOrganization(tx, organizationId, true);
      else await allowOrganizationMaintenance(tx, caller, organizationId);
    }
    for (const organizationId of [sourceId, input.targetOrganizationId].sort()) await tx.query("select pg_advisory_xact_lock(hashtextextended('oidc-identity:'||$1,0))", [organizationId]);
    // Member, role, handover and pairing mutations share these row locks.
    await tx.query("select id from users where id=any($1::text[]) order by id for update", [[caller.principal.user.id, userId].sort()]);
    const actor = await getAuthContext(tx, caller.principal.user.id); requirePlatformOrganizationManager(actor);
    const { user, item } = await transferSnapshot(tx, sourceId, userId, input.targetOrganizationId, context);
    if (item.version !== input.expectedVersion) throw new ApiError("CONFLICT", "账号权限、配对或待办已变化，请重新预览后调动。");
    if (!item.supported) throw new ApiError("CONFLICT", item.unavailableReason!);
    if ((await tx.query(`select 1 from user_oidc_identities where organization_id=$1 and user_id<>$2
      and (subject=$2 or ($3::text is not null and ((issuer=$3 and subject=$4) or user_id=$4)))`, [input.targetOrganizationId, userId, item.oidcIdentity?.issuer ?? null, item.oidcIdentity?.subject ?? null])).rowCount) {
      throw new ApiError("CONFLICT", "目标组织存在与该账号标识冲突的外部身份，请先核对身份绑定。");
    }
    const roles = [...new Set(input.targetRoles)], platform = item.platformAdministrator;
    await assertAdministratorContinuity(tx, user, { organizationId: input.targetOrganizationId, ...(item.oidcIdentity ? { loginUsable: false } : {}), roles: [...roles.map(roleId => ({ projectId: null, roleId })), ...(platform ? [{ projectId: null, roleId: "platform-admin" as const }] : [])] }, context);
    const invocation = await resolveOperatingContext(tx, caller, sourceId);
    const revokedBridgeIds = await revokePersonalAccess(tx, sourceId, userId);
    await releaseTransferredProjectResponsibilities(tx, withParameterAccess(actor, invocation), userId, context.requestId);
    await tx.query("delete from organization_team_members where user_id=$1", [userId]);
    await tx.query("delete from project_members where user_id=$1", [userId]);
    await tx.query("delete from user_role_bindings where user_id=$1", [userId]);
    // Rebind only the explicit identity. Migration aliases never follow a transfer.
    await tx.query("delete from user_oidc_identities where user_id=$1", [userId]);
    await tx.query("update users set organization_id=$2 where id=$1", [userId, input.targetOrganizationId]);
    await tx.query(`insert into user_oidc_identities(user_id,organization_id,issuer,subject,transfer_pending_since)
      values($1,$2,$3,$4,case when $3::text is null then null else clock_timestamp() end)`, [userId, input.targetOrganizationId, item.oidcIdentity?.issuer ?? null, item.oidcIdentity?.subject ?? null]);
    await updateOrganizationRoles(tx, { organizationId: input.targetOrganizationId, userId, roles: [...roles, ...(platform ? ["platform-admin" as const] : [])] });
    await tx.query("update local_registration_role_requests set account_changed_at=clock_timestamp() where user_id=$1 and status='pending'", [userId]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, context, { app: "user-governance", kind: "account-transfer", action: "transfer", severity: "High", projectId: null, targetType: "user", targetId: userId,
      metadata: { sourceOrganizationId: sourceId, targetOrganizationId: input.targetOrganizationId, previousRoles: item.roles, targetRoles: roles, retainedPlatformAdministrator: platform, retainedWork: item.retainedWork, externalIdentitySyncRequired: Boolean(item.oidcIdentity) } });
    return { item: { userId, organizationId: input.targetOrganizationId, isActive: user.isActive }, revokedBridgeIds };
  }).catch(error => { if ((error as { code?: string })?.code === "23505" || (error as { code?: string })?.code === "23503") throw new ApiError("CONFLICT", "目标组织身份或成员关系发生冲突，账号未调动。请刷新后重试。"); throw error; });
  for (const id of result.revokedBridgeIds) context.bridgeConnectionPool?.disconnect(id);
  return result.item;
}
