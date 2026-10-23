import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { assertTrustedInvocationContext, type UserInvocationContext } from "../auth/trustedInvocation";
import { canOperateInOrganization } from "../auth/policy";

export const teamNameSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const teamMembersSchema = z.object({ userIds: z.array(z.string().trim().min(1).max(200)).transform((ids) => [...new Set(ids)].sort()) }).strict();
export type OrganizationTeam = { id: string; organizationId: string; name: string; memberIds: string[] };

function teamScope(invocation: UserInvocationContext) {
  assertTrustedInvocationContext(invocation);
  const auth = invocation.principal, organizationId = invocation.operatingOrganization?.id ?? auth.organization.id;
  if (!auth.user.isActive || !auth.permissions.includes("users:manage") ||
    !auth.roles.some((role) => role.projectId === null && (role.roleId === "admin" || role.roleId === "platform-admin")) ||
    !canOperateInOrganization(auth, organizationId)) throw new ApiError("FORBIDDEN", "组织管理员权限不足。");
  return organizationId;
}

export async function listOrganizationTeams(db: Queryable, invocation: UserInvocationContext): Promise<OrganizationTeam[]> {
  const organizationId = teamScope(invocation);
  return (await db.query<OrganizationTeam>(`select t.id,t.organization_id as "organizationId",t.name,
    coalesce(array_agg(m.user_id order by m.user_id) filter(where m.user_id is not null),'{}') as "memberIds"
    from public.organization_teams t left join public.organization_team_members m on m.team_id=t.id and m.organization_id=t.organization_id
    where t.organization_id=$1 group by t.id order by lower(t.name),t.id`, [organizationId])).rows;
}

export async function mutateOrganizationTeam(db: Database, invocation: UserInvocationContext, requestId: string,
  operation: { action: "create"; name: string } | { action: "rename"; id: string; name: string } | { action: "replace-members"; id: string; userIds: string[] } | { action: "delete"; id: string }) {
  const organizationId = teamScope(invocation), id = operation.action === "create" ? randomUUID() : operation.id;
  try {
    return await db.transaction(async (tx) => {
      let previousName: string | undefined;
      if (operation.action !== "create") {
        const found = await tx.query<{ name: string }>("select name from public.organization_teams where id=$1 and organization_id=$2 for update", [id, organizationId]);
        if (!found.rowCount) throw new ApiError("NOT_FOUND", "该团队不存在。");
        previousName = found.rows[0].name;
      }
      if (operation.action === "create") await tx.query("insert into public.organization_teams(id,organization_id,name) values($1,$2,$3)", [id, organizationId, operation.name]);
      if (operation.action === "rename") await tx.query("update public.organization_teams set name=$3 where id=$1 and organization_id=$2", [id, organizationId, operation.name]);
      if (operation.action === "replace-members") {
        const members = await tx.query("select id from public.users where organization_id=$1 and id=any($2::text[]) for key share", [organizationId, operation.userIds]);
        if (members.rowCount !== operation.userIds.length) throw new ApiError("NOT_FOUND", "所选成员已不存在或不属于当前组织，请刷新后重试。");
        await tx.query("delete from public.organization_team_members where team_id=$1 and organization_id=$2", [id, organizationId]);
        await tx.query("insert into public.organization_team_members(team_id,organization_id,user_id) select $1,$2,unnest($3::text[])", [id, organizationId, operation.userIds]);
      }
      if (operation.action === "delete") await tx.query("delete from public.organization_teams where id=$1 and organization_id=$2", [id, organizationId]);
      await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId }, { app: "user-governance", kind: "organization-team", action: operation.action,
        severity: "Medium", projectId: null, targetType: "team", targetId: id, metadata: {
          name: "name" in operation ? operation.name : previousName,
          ...(operation.action === "rename" ? { previousName } : {}),
          ...(operation.action === "replace-members" ? { memberIds: operation.userIds } : {})
        } });
      return operation.action === "delete" ? null : (await listOrganizationTeams(tx, invocation)).find((team) => team.id === id)!;
    });
  } catch (error) {
    if (error && typeof error === "object" && "constraint" in error && error.constraint === "organization_teams_name_unique") throw new ApiError("CONFLICT", "当前组织已存在同名团队。");
    throw error;
  }
}
