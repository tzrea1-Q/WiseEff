import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import type { Queryable } from "../../../shared/database/client";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { lockOrganizationModuleStructure } from "../../parameter-modules/recognitionLock";
import { updateParameterModule } from "../../parameters/parameterModuleRepository";
import { planModuleStructure, stable } from "./preview";
import { moduleStructureApplyRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { applySubjectPlacement } from "./subjects";

export async function applyModuleStructure(pool: pg.Pool, organizationId: string, invocation: TrustedInvocationContext, requestId: string, raw: unknown) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module structure apply");
  const parsed = moduleStructureApplyRequestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_FAILED", "Invalid module structure confirmation.", { issues: parsed.error.issues });
  const input = parsed.data;
  const actor = { id: invocation.principal.user.id, organizationId: invocation.principal.organization.id,
    roles: invocation.principal.roles.map(role => `${role.roleId}:${role.projectId ?? ""}`).sort(), permissions: [...invocation.principal.permissions].sort() };
  const fingerprint = createHash("sha256").update(stable({ organizationId, actor, input })).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockOrganizationModuleStructure(client as unknown as Queryable, organizationId);
    const authorization = await client.query(`select rb.role_id from public.user_role_bindings rb
      join public.users u on u.id=rb.user_id and u.is_active
      where rb.user_id=$1 and rb.organization_id=$2 and rb.project_id is null
        and (rb.role_id='platform-admin' or (rb.role_id='admin' and rb.organization_id=$3))
      for share of rb,u`, [invocation.principal.user.id, invocation.principal.organization.id, organizationId]);
    if (!authorization.rowCount) throw new ApiError("FORBIDDEN", "Organization administrator access is required.");
    await client.query(`insert into parameter_catalog.governance_command_idempotency
      (organization_id,command_family,idempotency_key,request_fingerprint,state)
      values ($1,'module-structure-update',$2,$3,'pending') on conflict do nothing`, [organizationId, input.idempotencyKey, fingerprint]);
    const existing = (await client.query<{ request_fingerprint: string; state: string; result_ref: string | null }>(
      `select request_fingerprint,state,result_ref from parameter_catalog.governance_command_idempotency
       where organization_id=$1 and command_family='module-structure-update' and idempotency_key=$2 for update`, [organizationId, input.idempotencyKey])).rows[0]!;
    if (existing.request_fingerprint !== fingerprint) throw new ApiError("CONFLICT", "Idempotency key was already used for different content.");
    if (existing.state === "committed" && existing.result_ref) { await client.query("commit"); return JSON.parse(existing.result_ref); }
    const plan = await planModuleStructure(client, organizationId, invocation, { mode: input.mode, document: input.document, resolutions: input.resolutions });
    if (plan.token !== input.token) throw new ApiError("CONFLICT", "Preview is stale; review the current state again.");
    if (plan.conflicts.length) throw new ApiError("CONFLICT", "Resolve all conflicts before applying.");
    const changes = new Map<string, Record<string, unknown>>();
    for (const change of plan.changes) if (change.field !== "placement" && change.field !== "displayAlias") changes.set(change.moduleId, { ...changes.get(change.moduleId), [change.field]: change.after });
    // Temporary names make valid swaps safe under the immediate sibling-name index.
    for (const [moduleId, values] of changes) if (values.name !== undefined) await client.query(
      "update parameter_modules set name=$3 where organization_id=$1 and id=$2 and archived_at is null", [organizationId, moduleId, `__wiseeff_transfer_${randomUUID()}`]);
    for (const [moduleId, values] of changes) await updateParameterModule(client as unknown as Queryable, { organizationId, moduleId, ...values });
    await applySubjectPlacement(client, organizationId, plan.subjectChanges, plan.moduleIds);
    const receipt = { id: `msr_${randomUUID()}`, organizationId, changedModules: changes.size, changedFields: plan.changes.length };
    if (plan.changes.length) await writeAuditEventInTx(asAuditTx(client), invocation, { requestId }, { app: "parameter-governance", kind: "module-structure-update",
      action: "module-structure-update", severity: "Medium", projectId: null, targetType: "organization", targetId: organizationId,
      metadata: { receiptId: receipt.id, reason: input.reason, exportId: input.document.source.exportId,
        sourceOrganizationId: input.document.source.organizationId, catalogReleaseId: input.document.source.catalogReleaseId,
        changedModules: receipt.changedModules, changedFields: receipt.changedFields } });
    await client.query(`update parameter_catalog.governance_command_idempotency set state='committed',result_kind='module-structure-receipt',result_ref=$3,committed_at=now()
      where organization_id=$1 and command_family='module-structure-update' and idempotency_key=$2`, [organizationId, input.idempotencyKey, JSON.stringify(receipt)]);
    await client.query("commit"); return receipt;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
