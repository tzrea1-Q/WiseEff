import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { getAuthContext } from "./repository";
import { resolveOperatingContext } from "./operatingContext";
import type { TrustedInvocationContext, UserInvocationContext } from "./trustedInvocation";
import { requireUserInitiatedInvocation } from "./trustedInvocationPolicy";
import { listPlatformOrganizations, requirePlatformOrganizationManager } from "../users/platformOrganizations";

export async function requireActiveOrganization(db: Queryable, organizationId: string, lock = false) {
  const organization = (await db.query<{ id: string; name: string; status: "active" | "suspended" }>(
    `select id,name,status from public.organizations where id=$1${lock ? " for share" : ""}`, [organizationId])).rows[0];
  if (!organization) throw new ApiError("NOT_FOUND", "Organization was not found.");
  if (organization.status !== "active") throw new ApiError("FORBIDDEN", "组织已停用，当前仅可查看。请联系平台管理员恢复组织。", { reason: "organization-suspended", organizationId });
  return organization;
}

/** Only explicit recovery/handover services call this; ordinary platform writes use the normal gate. */
export async function allowOrganizationMaintenance(tx: Database, invocation: TrustedInvocationContext, organizationId: string) {
  requireUserInitiatedInvocation(invocation);
  const organization = (await tx.query<{ status: string }>("select status from public.organizations where id=$1 for share", [organizationId])).rows[0];
  if (!organization) throw new ApiError("NOT_FOUND", "Organization was not found.");
  if (organization.status === "active") return;
  if (organization.status !== "suspended") throw new ApiError("FORBIDDEN", "Organization is unavailable for maintenance.");
  const actor = await getAuthContext(tx, (invocation as UserInvocationContext).principal.user.id);
  requirePlatformOrganizationManager(actor);
  await tx.query("select set_config('wiseeff.lifecycle_maintenance_org',$1,true)", [organizationId]);
}

export async function changeOrganizationLifecycle(db: Database, invocation: UserInvocationContext, organizationId: string,
  input: { status: "active" | "suspended"; expectedStatus: "active" | "suspended" }, requestId: string) {
  requireUserInitiatedInvocation(invocation);
  requirePlatformOrganizationManager(invocation.principal);
  return db.transaction(async tx => {
    requirePlatformOrganizationManager(await getAuthContext(tx, invocation.principal.user.id));
    const scoped = await resolveOperatingContext(tx, invocation, organizationId);
    const row = (await tx.query<{ status: string }>("select status from public.organizations where id=$1 for update", [organizationId])).rows[0];
    if (row.status !== input.expectedStatus) throw new ApiError("CONFLICT", "组织状态已变化，请刷新后重试。");
    if (row.status !== input.status) {
      // Keep the last suspension fence after restore so old device approvals stay invalid.
      // No approval/job row is locked while this exclusive Organization lock is held.
      await tx.query("update public.organizations set status=$2,lifecycle_version=lifecycle_version+1,suspended_at=case when $2='suspended' then clock_timestamp() else suspended_at end where id=$1", [organizationId, input.status]);
      await writeAuditEventInTx(asAuditTx(tx), scoped, { requestId }, { app: "user-governance", kind: "organization-lifecycle", action: input.status === "active" ? "restore" : "suspend", severity: "High", projectId: null,
        targetType: "organization", targetId: organizationId, metadata: { previousStatus: row.status, status: input.status } });
    }
    return (await listPlatformOrganizations(tx, invocation.principal, "", organizationId))[0];
  });
}
