import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { canOperateInOrganization } from "../auth/policy";
import { assertTrustedInvocationContext, type UserInvocationContext } from "../auth/trustedInvocation";
import type { OrganizationWorkspaceSummary } from "../contracts/dtoSchemas/organizationWorkspace";
import { listKnowledgeHandovers } from "../knowledge/handover";
import { withKnowledgeInvocation } from "../knowledge/scope";
import { listProjectHandovers } from "../parameters/handover";
import { withParameterAccess } from "../parameters/operatingScope";
import { listFeedbackHandovers } from "../product-feedback/handover";
import { withProductFeedbackInvocation } from "../product-feedback/scope";

export async function getOrganizationWorkspaceSummary(db: Database, invocation: UserInvocationContext, localInvitationsEnabled: boolean): Promise<OrganizationWorkspaceSummary> {
  assertTrustedInvocationContext(invocation);
  const auth = invocation.principal, organizationId = invocation.operatingOrganization?.id ?? auth.organization.id;
  if (!canOperateInOrganization(auth, organizationId)) throw new ApiError("FORBIDDEN", "无法查看该组织。");
  const organization = (await db.query<OrganizationWorkspaceSummary["organization"]>("select id,name,status from organizations where id=$1", [organizationId])).rows[0];
  if (!organization) throw new ApiError("NOT_FOUND", "组织不存在。");
  const counts = (await db.query<OrganizationWorkspaceSummary["counts"]>(`select
    (select count(*)::int from users where organization_id=$1) as members,
    (select count(*)::int from organization_teams where organization_id=$1) as teams,
    (select count(*)::int from projects where organization_id=$1) as projects`, [organizationId])).rows[0];
  const administrator = auth.permissions.includes("users:manage") && auth.roles.some(role => role.projectId === null && ["admin", "platform-admin"].includes(role.roleId));
  if (!administrator) return { organization, counts, administration: null };
  const pending = (await db.query<{ pendingInvitations: number; pendingIdentitySync: number }>(`select
    (select count(*)::int from organization_invitations where organization_id=$1 and status='pending' and expires_at>now()) as "pendingInvitations",
    (select count(*)::int from user_oidc_identities i join users u on u.id=i.user_id and u.organization_id=i.organization_id
      where i.organization_id=$1 and i.transfer_pending_since is not null and i.transfer_verified_at is null) as "pendingIdentitySync"`, [organizationId])).rows[0];
  // Reuse the domain's current responsibility/eligibility rules, including transferred and disabled owners.
  const handovers = await Promise.all([
    listProjectHandovers(db, withParameterAccess(auth, invocation)),
    listKnowledgeHandovers(db, withKnowledgeInvocation(auth, invocation)),
    listFeedbackHandovers(db, withProductFeedbackInvocation(auth, invocation))
  ]);
  return { organization, counts, administration: { ...pending, pendingInvitations: localInvitationsEnabled ? pending.pendingInvitations : null,
    pendingHandovers: handovers.reduce((count, handover) => count + handover.items.filter(item => item.pending).length, 0) } };
}
