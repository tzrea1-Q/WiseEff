import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { parameterInvocation, parameterOrganizationId, withParameterAccess } from "../parameters/operatingScope";
import type { SharedDtsiLifecycleInput } from "../contracts/dtoSchemas/sharedDtsi";
import { requireWrite, type WriteContext } from "./service";
import { getSharedDtsiResourceDetail } from "./publication";

/** Both lifecycle transitions and new-reference writers hold this until commit. */
export async function lockSharedDtsiReferences(db: Database, auth: AuthContext) {
  // ponytail: one organization lock; use sorted resource locks if reference-write throughput warrants it.
  await db.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`shared-dtsi-references:${parameterOrganizationId(auth)}`]);
}

type Pin = { resourceId: string; versionId: string; mountPath: string };
/** Retention is exact current provenance supplied by the project owner, never a caller flag. */
export async function assertSharedDtsiNewReferences(db: Database, auth: AuthContext, resources: Pin[], retained: Pin[] = []) {
  const additions = resources.filter(pin => !retained.some(old => old.resourceId === pin.resourceId && old.versionId === pin.versionId && old.mountPath === pin.mountPath));
  if (!additions.length) return;
  const retired = (await db.query<{ name: string }>(`select name from public.shared_dtsi_resources
    where organization_id=$1 and id=any($2::text[]) and state='retired' order by id`,
  [parameterOrganizationId(auth), additions.map(pin => pin.resourceId)])).rows[0];
  if (retired) throw new ApiError("CONFLICT", `${retired.name}：资源已停用，不能建立新的直接或传递引用；请选择可用资源。`, { reason: "shared-resource-retired" });
}

export async function changeSharedDtsiLifecycle(db: Database, auth: AuthContext, resourceId: string, input: SharedDtsiLifecycleInput, context: WriteContext) {
  requireWrite(auth, context);
  const organizationId = parameterOrganizationId(auth);
  return db.transaction(async tx => {
    // Match the project writer's actor -> reference-admission lock order.
    if(!(await tx.query("select id from public.users where id=$1 and organization_id=$2 and is_active for no key update",[auth.user.id,auth.organization.id])).rowCount)
      throw new ApiError("FORBIDDEN","需要当前有效的参数管理员账户。");
    const current=await getAuthContext(tx,auth.user.id);
    const authorized=withParameterAccess(current,await resolveOperatingContext(tx,createUserInvocation(current),organizationId));
    const invocation=requireWrite(authorized,{...context,invocation:parameterInvocation(authorized)!});
    await lockSharedDtsiReferences(tx, auth);
    const row = (await tx.query<{ state: string; revision: number; request: { state: string; expectedLifecycleRevision: number; idempotencyKey: string; userId: string } | null }>(
      `select state,lifecycle_revision as revision,lifecycle_request as request from public.shared_dtsi_resources where id=$1 and organization_id=$2 for update`, [resourceId, organizationId])).rows[0];
    if (!row) throw new ApiError("NOT_FOUND", "共享 DTSI 资源不存在。");
    if (row.request?.idempotencyKey === input.idempotencyKey && row.request.userId === auth.user.id) {
      if (row.request.state !== input.state || row.request.expectedLifecycleRevision !== input.expectedLifecycleRevision)
        throw new ApiError("CONFLICT", "此重试标识已用于另一项资源状态操作。");
      return getSharedDtsiResourceDetail(tx, auth, resourceId);
    }
    if (row.revision !== input.expectedLifecycleRevision || row.state === input.state)
      throw new ApiError("CONFLICT", "资源状态已变化，请重新载入后核对。", { reason: "shared-resource-state-changed" });
    await tx.query(`update public.shared_dtsi_resources set state=$3,lifecycle_revision=lifecycle_revision+1,lifecycle_request=$4::jsonb,updated_at=now()
      where id=$1 and organization_id=$2`, [resourceId, organizationId, input.state, JSON.stringify({ ...input, userId: auth.user.id })]);
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: context.requestId }, {
      app: "parameters", kind: "shared-dtsi-lifecycle", action: input.state === "retired" ? "retire" : "restore", severity: "Medium", projectId: null,
      targetType: "shared-dtsi-resource", targetId: resourceId, metadata: { before: row.state, after: input.state, lifecycleRevision: row.revision + 1 }
    });
    return getSharedDtsiResourceDetail(tx, auth, resourceId);
  });
}
