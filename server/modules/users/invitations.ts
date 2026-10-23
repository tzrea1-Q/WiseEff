import { randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { canOperateInOrganization } from "../auth/policy";
import { getAuthContext } from "../auth/repository";
import { assertTrustedInvocationContext, createUserInvocation, type UserInvocationContext } from "../auth/trustedInvocation";
import { hashLocalAccountPassword, hashLocalSessionToken, validateLocalAccountPassword, validateLocalAccountUsername } from "../auth/localAccountCredentials";
import type { BackendRoleId } from "../auth/types";
import { insertPasswordCredential, insertUser, updateOrganizationRoles } from "./repository";
import { invitationAcceptSchema, invitationInputSchema } from "../contracts/dtoSchemas/organizationInvitations";
export { invitationAcceptSchema, invitationInputSchema, invitationTokenSchema } from "../contracts/dtoSchemas/organizationInvitations";

type InvitationInput = z.infer<typeof invitationInputSchema>;
export type OrganizationInvitation = { id: string; organizationId: string; label: string; roles: BackendRoleId[]; status: "pending" | "expired" | "revoked" | "accepted"; expiresAt: string; createdAt: string; acceptedUserId: string | null };
type InvitationRow = OrganizationInvitation & { createdByUserId: string | null };
const projection = `id,organization_id as "organizationId",label,role_ids as roles,
  case when status='pending' and expires_at<=now() then 'expired' else status end as status,
  expires_at::text as "expiresAt",created_at::text as "createdAt",accepted_user_id as "acceptedUserId"`;

function scope(invocation: UserInvocationContext, roles: BackendRoleId[] = []) {
  assertTrustedInvocationContext(invocation);
  const auth = invocation.principal, organizationId = invocation.operatingOrganization?.id ?? auth.organization.id;
  const platform = auth.roles.some((role) => role.projectId === null && role.roleId === "platform-admin");
  if (!auth.user.isActive || !auth.permissions.includes("users:manage") || !canOperateInOrganization(auth, organizationId) ||
    !auth.roles.some((role) => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin"))) throw new ApiError("FORBIDDEN", "组织管理员权限不足。");
  if (roles.includes("platform-admin") && !platform) throw new ApiError("FORBIDDEN", "仅平台超级管理员可授予平台管理员角色。");
  return organizationId;
}

export async function listOrganizationInvitations(db: Queryable, invocation: UserInvocationContext) {
  return (await db.query<OrganizationInvitation>(`select ${projection} from public.organization_invitations where organization_id=$1 order by created_at desc,id`, [scope(invocation)])).rows;
}

export async function issueOrganizationInvitation(db: Database, invocation: UserInvocationContext, input: InvitationInput, requestId: string, id?: string) {
  const organizationId = scope(invocation, input.roles), token = randomBytes(32).toString("base64url"), invitationId = id ?? randomUUID();
  return db.transaction(async (tx) => {
    if (id) {
      const current = (await tx.query<OrganizationInvitation>(`select ${projection} from public.organization_invitations where id=$1 and organization_id=$2 for update`, [id, organizationId])).rows[0];
      if (!current) throw new ApiError("NOT_FOUND", "邀请不存在。");
      if (current.status === "accepted") throw new ApiError("CONFLICT", "邀请已接受，请直接管理成员。");
      await tx.query(`update public.organization_invitations set label=$3,role_ids=$4,token_hash=$5,status='pending',expires_at=now()+($6*interval '1 day'),created_by_user_id=$7 where id=$1 and organization_id=$2`, [id, organizationId, input.label, input.roles, hashLocalSessionToken(token), input.expiresInDays, invocation.principal.user.id]);
    } else await tx.query(`insert into public.organization_invitations(id,organization_id,label,role_ids,token_hash,expires_at,created_by_user_id) values($1,$2,$3,$4,$5,now()+($6*interval '1 day'),$7)`, [invitationId, organizationId, input.label, input.roles, hashLocalSessionToken(token), input.expiresInDays, invocation.principal.user.id]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, { app: "user-governance", kind: "organization-invitation", action: id ? "regenerate" : "create", severity: "Medium", projectId: null, targetType: "invitation", targetId: invitationId, metadata: { label: input.label, roles: input.roles, expiresInDays: input.expiresInDays } });
    return { item: (await listOrganizationInvitations(tx, invocation)).find((item) => item.id === invitationId)!, token };
  });
}

export async function revokeOrganizationInvitation(db: Database, invocation: UserInvocationContext, id: string, requestId: string) {
  const organizationId = scope(invocation);
  return db.transaction(async (tx) => {
    const current = (await tx.query<OrganizationInvitation>(`select ${projection} from public.organization_invitations where id=$1 and organization_id=$2 for update`, [id, organizationId])).rows[0];
    if (!current) throw new ApiError("NOT_FOUND", "邀请不存在。");
    if (current.status === "accepted") throw new ApiError("CONFLICT", "邀请已接受，请直接管理成员。");
    await tx.query("update public.organization_invitations set status='revoked' where id=$1", [id]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, { app: "user-governance", kind: "organization-invitation", action: "revoke", severity: "Medium", projectId: null, targetType: "invitation", targetId: id, metadata: {} });
    return { ...current, status: "revoked" as const };
  });
}

export async function readOrganizationInvitation(db: Queryable, token: string) {
  const invitation = (await db.query<OrganizationInvitation & { organizationName: string }>(`select ${projection},(select name from public.organizations where id=organization_id) as "organizationName" from public.organization_invitations where token_hash=$1`, [hashLocalSessionToken(token)])).rows[0];
  if (!invitation) throw new ApiError("NOT_FOUND", "邀请链接无效或已被重新生成，请联系管理员。");
  return invitation;
}

export async function acceptOrganizationInvitation(db: Database, token: string, input: z.infer<typeof invitationAcceptSchema>, requestId: string) {
  validateLocalAccountUsername(input.username); validateLocalAccountPassword(input.password);
  const passwordHash = await hashLocalAccountPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const invitation = (await tx.query<InvitationRow>(`select ${projection},created_by_user_id as "createdByUserId" from public.organization_invitations where token_hash=$1 for update`, [hashLocalSessionToken(token)])).rows[0];
      if (!invitation) throw new ApiError("NOT_FOUND", "邀请链接无效或已被重新生成，请联系管理员。");
      if (invitation.status !== "pending") throw new ApiError("CONFLICT", "邀请已接受、撤销或过期，请联系管理员。");
      // Governance role changes lock this same user before replacing bindings.
      await tx.query("select id from public.users where id=$1 for update", [invitation.createdByUserId]);
      let creator;
      try { creator = await getAuthContext(tx, invitation.createdByUserId ?? ""); }
      catch (error) { if (error instanceof ApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) throw new ApiError("CONFLICT", "邀请人的管理权限已失效，请由管理员重新生成邀请。"); throw error; }
      try { scope(createUserInvocation(creator), invitation.roles); }
      catch (error) { if (error instanceof ApiError && error.code === "FORBIDDEN") throw new ApiError("CONFLICT", "邀请人的管理权限已失效，请由管理员重新生成邀请。"); throw error; }
      if (!canOperateInOrganization(creator, invitation.organizationId)) throw new ApiError("CONFLICT", "邀请人的管理范围已失效，请由管理员重新生成邀请。");
      // now() is fixed at BEGIN, including time spent waiting for a competing consumer or role change.
      if (!(await tx.query<{ valid: boolean }>("select expires_at>clock_timestamp() as valid from public.organization_invitations where id=$1", [invitation.id])).rows[0]?.valid) throw new ApiError("CONFLICT", "邀请已过期，请联系管理员重新生成。");
      const existing = await tx.query<{ organization_id: string }>("select u.organization_id from public.users u join public.user_password_credentials c on c.user_id=u.id where lower(c.username)=lower($1)", [input.username]);
      if (existing.rowCount) throw new ApiError("CONFLICT", existing.rows[0].organization_id === invitation.organizationId ? "该账号已是本组织成员，请登录后由管理员调整成员设置。" : "该账号属于其他组织，需由平台管理员办理调动，不能通过邀请更改归属。");
      const user = await insertUser(tx, { id: `u-${randomUUID()}`, organizationId: invitation.organizationId, name: input.name, title: input.title || "User" });
      await insertPasswordCredential(tx, { userId: user.id, username: input.username, passwordHash });
      await updateOrganizationRoles(tx, { organizationId: invitation.organizationId, userId: user.id, roles: invitation.roles });
      await tx.query("update public.organization_invitations set status='accepted',accepted_user_id=$2,accepted_at=now() where id=$1", [invitation.id, user.id]);
      await writeAuditEventInTx(asAuditTx(tx), createUserInvocation(await getAuthContext(tx, user.id)), { requestId }, { app: "user-governance", kind: "organization-invitation", action: "accept", severity: "Medium", projectId: null, targetType: "invitation", targetId: invitation.id, metadata: { invitedByUserId: invitation.createdByUserId, roles: invitation.roles } });
      return { userId: user.id, organizationId: invitation.organizationId };
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") throw new ApiError("CONFLICT", "账号已存在，请登录或联系管理员管理现有成员。");
    throw error;
  }
}
