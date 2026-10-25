import { createHash } from "node:crypto";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { getAuthContext } from "../auth/repository";
import { resolveOperatingContext } from "../auth/operatingContext";
import { canOperateInOrganization } from "../auth/policy";
import { asAuditTx, writeAuditEventInTx } from "../audit/auditedWrite";
import { parameterInvocation, parameterOrganizationId, withParameterAccess } from "../parameters/operatingScope";
import { sharedDtsiLifecycleResultSchema, type SharedDtsiLifecycleInput, type SharedDtsiLifecycleResult } from "../contracts/dtoSchemas/sharedDtsi";
import { requireWrite, type WriteContext } from "./service";

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
  const invocation=requireWrite(auth, context);
  const organizationId = parameterOrganizationId(auth);
  const auditId=`shared-dtsi-lifecycle:${createHash("sha256").update(JSON.stringify([organizationId,resourceId,auth.user.id,input.idempotencyKey])).digest("hex")}`;
  return db.transaction(async tx => {
    // Match the project writer's actor -> reference-admission lock order.
    if(!(await tx.query("select id from public.users where id=$1 and organization_id=$2 and is_active for no key update",[auth.user.id,auth.organization.id])).rowCount)
      throw new ApiError("FORBIDDEN","需要当前有效的参数管理员账户。");
    const current=await getAuthContext(tx,auth.user.id);
    if(!canOperateInOrganization(current,organizationId))throw new ApiError("FORBIDDEN","当前账户不能管理此组织的共享资源。");
    const authorized=withParameterAccess(current,await resolveOperatingContext(tx,invocation,organizationId));
    requireWrite(authorized,{...context,invocation:parameterInvocation(authorized)!});
    await lockSharedDtsiReferences(tx, auth);
    const replay=(await tx.query<{metadata:{request:SharedDtsiLifecycleInput;result:SharedDtsiLifecycleResult}}>(`select metadata from public.audit_events
      where id=$1 and organization_id=$2 and actor_user_id=$3 and kind='shared-dtsi-lifecycle' and target_id=$4`,[auditId,organizationId,auth.user.id,resourceId])).rows[0];
    if(replay){
      if(replay.metadata.request.state!==input.state || replay.metadata.request.expectedLifecycleRevision!==input.expectedLifecycleRevision || replay.metadata.request.idempotencyKey!==input.idempotencyKey)
        throw new ApiError("CONFLICT", "此重试标识已用于另一项资源状态操作。");
      return sharedDtsiLifecycleResultSchema.parse(replay.metadata.result);
    }
    const row = (await tx.query<{ state: string; revision: number }>(
      `select state,lifecycle_revision as revision from public.shared_dtsi_resources where id=$1 and organization_id=$2 for update`, [resourceId, organizationId])).rows[0];
    if (!row) throw new ApiError("NOT_FOUND", "共享 DTSI 资源不存在。");
    if (row.revision !== input.expectedLifecycleRevision || row.state === input.state)
      throw new ApiError("CONFLICT", "资源状态已变化，请重新载入后核对。", { reason: "shared-resource-state-changed" });
    const updated=(await tx.query<{updatedAt:Date}>(`update public.shared_dtsi_resources set state=$3,lifecycle_revision=lifecycle_revision+1,updated_at=now()
      where id=$1 and organization_id=$2 returning updated_at as "updatedAt"`, [resourceId, organizationId, input.state])).rows[0]!;
    const result:SharedDtsiLifecycleResult={resourceId,state:input.state,lifecycleRevision:row.revision+1,updatedAt:updated.updatedAt.toISOString()};
    await writeAuditEventInTx(asAuditTx(tx), invocation, { requestId: context.requestId }, {
      id:auditId,
      app: "parameters", kind: "shared-dtsi-lifecycle", action: input.state === "retired" ? "retire" : "restore", severity: "Medium", projectId: null,
      targetType: "shared-dtsi-resource", targetId: resourceId, metadata: { before: row.state, after: input.state, lifecycleRevision: row.revision + 1,request:input,result }
    });
    return result;
  });
}
