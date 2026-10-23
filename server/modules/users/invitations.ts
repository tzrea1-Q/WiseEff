import { randomBytes, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { canOperateInOrganization } from "../auth/policy";
import { getAuthContext } from "../auth/repository";
import { assertTrustedInvocationContext, createUserInvocation, type UserInvocationContext } from "../auth/trustedInvocation";
import { hashLocalAccountPassword, hashLocalSessionToken, validateLocalAccountPassword, validateLocalAccountUsername } from "../auth/localAccountCredentials";
import type { AuthContext, BackendRoleId } from "../auth/types";
import { insertPasswordCredential, insertUser, updateOrganizationRoles } from "./repository";
import { invitationAcceptSchema, invitationInputSchema } from "../contracts/dtoSchemas/organizationInvitations";
export { invitationAcceptSchema, invitationInputSchema, invitationTokenSchema } from "../contracts/dtoSchemas/organizationInvitations";

type InvitationInput = z.infer<typeof invitationInputSchema>;
export type OrganizationInvitation = { id: string; organizationId: string; label: string; roles: BackendRoleId[]; status: "pending" | "expired" | "revoked" | "accepted"; expiresAt: string; createdAt: string; acceptedUserId: string | null;
  teams: Array<{ id: string; name: string }>; projects: Array<InvitationInput["projects"][number] & { name: string }> };
type InvitationRow = OrganizationInvitation & { createdByUserId: string | null };
const projection = `id,organization_id as "organizationId",label,role_ids as roles,
  case when status='pending' and expires_at<=now() then 'expired' else status end as status,
  expires_at::text as "expiresAt",created_at::text as "createdAt",accepted_user_id as "acceptedUserId",team_presets as teams,project_presets as projects`;

async function membershipPresets(tx: Queryable, organizationId: string, input: Pick<InvitationInput, "teamIds" | "projects">) {
  const teams = (await tx.query<{ id: string; name: string }>("select id,name from public.organization_teams where organization_id=$1 and id=any($2::text[]) order by id for share", [organizationId, input.teamIds])).rows;
  const projects = (await tx.query<{ id: string; name: string }>("select id,name from public.projects where organization_id=$1 and id=any($2::text[]) order by id for share", [organizationId, input.projects.map((item) => item.projectId)])).rows;
  if (teams.length !== input.teamIds.length || projects.length !== input.projects.length) throw new ApiError("CONFLICT", "邀请预设的团队或项目已删除、移动或不属于当前组织，请管理员修正并重新生成邀请。");
  return { teams, projects: projects.map((project) => ({ projectId: project.id, name: project.name, roles: input.projects.find((item) => item.projectId === project.id)!.roles })) };
}

async function currentGrantor(tx: Queryable, userId: string | null, organizationId: string, roles: BackendRoleId[]) {
  // Member-role changes and offboarding lock this row before replacing authority.
  await tx.query("select id from public.users where id=$1 for no key update", [userId]);
  try {
    const creator = await getAuthContext(tx, userId ?? "");
    requireGrantAuthority(creator, organizationId, roles);
  } catch (error) {
    if (error instanceof ApiError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) throw new ApiError("CONFLICT", "邀请人的管理权限或管理范围已失效，请由管理员修正并重新生成邀请。");
    throw error;
  }
}

function requireGrantAuthority(auth: AuthContext, organizationId: string, roles: BackendRoleId[]) {
  const platform = auth.roles.some((role) => role.projectId === null && role.roleId === "platform-admin");
  if (!auth.user.isActive || !auth.permissions.includes("users:manage") || !canOperateInOrganization(auth, organizationId) ||
    !auth.roles.some((role) => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin"))) throw new ApiError("FORBIDDEN", "组织管理员权限不足。");
  if (roles.includes("platform-admin") && !platform) throw new ApiError("FORBIDDEN", "仅平台超级管理员可授予平台管理员角色。");
}

function scope(invocation: UserInvocationContext, roles: BackendRoleId[] = []) {
  assertTrustedInvocationContext(invocation);
  const organizationId = invocation.operatingOrganization?.id ?? invocation.principal.organization.id;
  requireGrantAuthority(invocation.principal, organizationId, roles);
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
    }
    await currentGrantor(tx, invocation.principal.user.id, organizationId, input.roles);
    const presets = await membershipPresets(tx, organizationId, input);
    if (id) await tx.query(`update public.organization_invitations set label=$3,role_ids=$4,token_hash=$5,status='pending',expires_at=now()+($6*interval '1 day'),created_by_user_id=$7,team_presets=$8,project_presets=$9 where id=$1 and organization_id=$2`, [id, organizationId, input.label, input.roles, hashLocalSessionToken(token), input.expiresInDays, invocation.principal.user.id, JSON.stringify(presets.teams), JSON.stringify(presets.projects)]);
    else await tx.query(`insert into public.organization_invitations(id,organization_id,label,role_ids,token_hash,expires_at,created_by_user_id,team_presets,project_presets) values($1,$2,$3,$4,$5,now()+($6*interval '1 day'),$7,$8,$9)`, [invitationId, organizationId, input.label, input.roles, hashLocalSessionToken(token), input.expiresInDays, invocation.principal.user.id, JSON.stringify(presets.teams), JSON.stringify(presets.projects)]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, { app: "user-governance", kind: "organization-invitation", action: id ? "regenerate" : "create", severity: "Medium", projectId: null, targetType: "invitation", targetId: invitationId, metadata: { label: input.label, roles: input.roles, expiresInDays: input.expiresInDays, ...presets } });
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
      const presetInput = invitationInputSchema.safeParse({ label: invitation.label, roles: invitation.roles, expiresInDays: 1,
        teamIds: invitation.teams.map((team) => team.id), projects: invitation.projects.map(({ projectId, roles }) => ({ projectId, roles })) });
      if (!presetInput.success) throw new ApiError("CONFLICT", "邀请预设的角色或目标已不可用，请管理员修正并重新生成邀请。");
      await currentGrantor(tx, invitation.createdByUserId, invitation.organizationId, invitation.roles);
      await membershipPresets(tx, invitation.organizationId, presetInput.data);
      // now() is fixed at BEGIN, including time spent waiting for a competing consumer or role change.
      if (!(await tx.query<{ valid: boolean }>("select expires_at>clock_timestamp() as valid from public.organization_invitations where id=$1", [invitation.id])).rows[0]?.valid) throw new ApiError("CONFLICT", "邀请已过期，请联系管理员重新生成。");
      const existing = await tx.query<{ organization_id: string }>("select u.organization_id from public.users u join public.user_password_credentials c on c.user_id=u.id where lower(c.username)=lower($1)", [input.username]);
      if (existing.rowCount) throw new ApiError("CONFLICT", existing.rows[0].organization_id === invitation.organizationId ? "该账号已是本组织成员，请登录后由管理员调整成员设置。" : "该账号属于其他组织，需由平台管理员办理调动，不能通过邀请更改归属。");
      const user = await insertUser(tx, { id: `u-${randomUUID()}`, organizationId: invitation.organizationId, name: input.name, title: input.title || "User" });
      await insertPasswordCredential(tx, { userId: user.id, username: input.username, passwordHash });
      await updateOrganizationRoles(tx, { organizationId: invitation.organizationId, userId: user.id, roles: invitation.roles });
      await tx.query("insert into public.organization_team_members(team_id,organization_id,user_id) select unnest($1::text[]),$2,$3", [invitation.teams.map((team) => team.id), invitation.organizationId, user.id]);
      for (const project of invitation.projects) await tx.query("insert into public.project_members(organization_id,project_id,user_id,roles) values($1,$2,$3,$4)", [invitation.organizationId, project.projectId, user.id, project.roles]);
      await tx.query("update public.organization_invitations set status='accepted',accepted_user_id=$2,accepted_at=now() where id=$1", [invitation.id, user.id]);
      await writeAuditEventInTx(asAuditTx(tx), createUserInvocation(await getAuthContext(tx, user.id)), { requestId }, { app: "user-governance", kind: "organization-invitation", action: "accept", severity: "Medium", projectId: null, targetType: "invitation", targetId: invitation.id, metadata: { invitedByUserId: invitation.createdByUserId, roles: invitation.roles, teams: invitation.teams, projects: invitation.projects } });
      return { userId: user.id, organizationId: invitation.organizationId };
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") throw new ApiError("CONFLICT", "账号已存在，请登录或联系管理员管理现有成员。");
    throw error;
  }
}
