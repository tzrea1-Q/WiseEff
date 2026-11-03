import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { ApiError } from "../../../shared/http/errors";
import type { Queryable } from "../../../shared/database/client";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { lockOrganizationModuleStructure } from "../../parameter-modules/recognitionLock";
import { createParameterModule, deleteParameterModule, updateParameterModule } from "../../parameters/parameterModuleRepository";
import { planModuleStructure, stable } from "./preview";
import { moduleStructureApplyRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { applyRecognition } from "./recognition";
import type { Database } from "../../../shared/database/client";
import { applySubjectPlacement } from "./subjects";
import { applyLifecycle } from "./lifecycle";
import { applyCopySubjects } from "./copySubjects";

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
    // FK writers take key-share locks; wait for them before reading deletion impact and block new references until commit.
    if (input.mode === "update" && input.document.modules.some(module => module.operation === "delete")) await client.query(
      "select id from parameter_modules where organization_id=$1 order by id for update", [organizationId]);
    const plan = await planModuleStructure(client, organizationId, invocation, { mode: input.mode, document: input.document, resolutions: input.resolutions, mappings: input.mappings });
    if (plan.token !== input.token) throw new ApiError("CONFLICT", "Preview is stale; review the current state again.");
    if (plan.conflicts.length) throw new ApiError("CONFLICT", "Resolve all conflicts before applying.");
    for (const mapping of plan.copyMappings) await client.query(`insert into parameter_catalog.module_structure_created_refs
      (organization_id,source_organization_id,export_id,package_ref,module_id,initial_snapshot) values ($1,$2,$3,$4,$5,$6)`,
      [organizationId, input.document.source.organizationId, input.document.source.exportId, mapping.ref, mapping.moduleId, JSON.stringify(mapping.snapshot)]);
    const createdRefs = new Set(plan.changes.filter(change => change.field === "create").map(change => change.moduleId));
    const changes = new Map<string, Record<string, unknown>>();
    for (const change of plan.changes) if (!change.moduleId.startsWith("subject:") && !createdRefs.has(change.moduleId) && !["parentRef", "delete", "legacyImpact"].includes(change.field)) changes.set(change.moduleId, { ...changes.get(change.moduleId), [change.field]: change.after });
    // Temporary names make valid swaps safe under the immediate sibling-name index.
    const structural = new Set(plan.changes.filter(change => !createdRefs.has(change.moduleId) && (change.field === "name" || change.field === "parentRef")).map(change => change.moduleId));
    for (const moduleId of new Set([...structural, ...plan.deleted])) await client.query(
      "update parameter_modules set name=$3 where organization_id=$1 and id=$2 and archived_at is null", [organizationId, moduleId, `__wiseeff_transfer_${randomUUID()}`]);
    const pending = input.document.modules.filter(module => createdRefs.has(module.ref));
    const children = new Map<string, typeof pending>();
    const ready: typeof pending = [];
    for (const module of pending) {
      if (module.parentRef && createdRefs.has(module.parentRef)) {
        const siblings = children.get(module.parentRef) ?? [];
        siblings.push(module);
        children.set(module.parentRef, siblings);
      } else ready.push(module);
    }
    for (let index = 0; index < ready.length; index++) {
      const module = ready[index]!;
      const created = await createParameterModule(client as unknown as Queryable, { organizationId, name: `__wiseeff_transfer_${randomUUID()}`,
        parentId: module.parentRef ? plan.moduleIds.get(module.parentRef) ?? module.parentRef : null, description: module.description?.trim(),
        scope: module.scope?.trim(), sortOrder: module.sortOrder, importance: module.importance });
      plan.moduleIds.set(module.ref, created.id);
      await client.query(`insert into parameter_catalog.module_structure_created_refs
        (organization_id,source_organization_id,export_id,package_ref,module_id,initial_snapshot) values ($1,$2,$3,$4,$5,$6)`,
        [organizationId, input.document.source.organizationId, input.document.source.exportId, module.ref, created.id, JSON.stringify({ ...module,
          name: module.name?.trim(), description: module.description?.trim(), scope: module.scope?.trim() })]);
      ready.push(...(children.get(module.ref) ?? []));
    }
    if (ready.length !== pending.length) throw new ApiError("CONFLICT", "Invalid module hierarchy.");
    for (const module of input.document.modules.filter(module => input.mode !== "copy" || module.operation !== "delete")) {
      const id = plan.moduleIds.get(module.ref)!;
      if (plan.deleted.has(id)) continue;
      const originalId = plan.parents.has(id) ? id : module.ref;
      const parent = plan.parents.get(originalId) ?? null;
      const parentId = parent ? plan.moduleIds.get(parent) ?? parent : null;
      if (structural.has(id) || createdRefs.has(module.ref)) {
        await client.query("update parameter_modules set parent_id=$3 where organization_id=$1 and id=$2", [organizationId, id, parentId]);
        const values = changes.get(id) ?? {};
        if (values.name === undefined) values.name = plan.namesById.get(originalId);
        changes.set(id, values);
      }
    }
    const moved = plan.changes.filter(change => change.field === "parentRef" || change.field === "create")
      .map(change => plan.moduleIds.get(change.moduleId) ?? change.moduleId);
    if (moved.length) await client.query(`with recursive tree as (
      select id, id::text as path, 1 as depth from parameter_modules where organization_id=$1 and parent_id is null and archived_at is null
      union all select m.id, tree.path || '/' || m.id, tree.depth+1 from parameter_modules m join tree on m.parent_id=tree.id
      where m.organization_id=$1 and m.archived_at is null), affected as (
      select id from parameter_modules where organization_id=$1 and id=any($2::text[])
      union all select m.id from parameter_modules m join affected a on m.parent_id=a.id where m.organization_id=$1 and m.archived_at is null)
      update parameter_modules m set path=tree.path,depth=tree.depth from tree where m.organization_id=$1 and m.id=tree.id
      and m.id in (select id from affected) and (m.path,m.depth) is distinct from (tree.path,tree.depth)`, [organizationId, moved]);
    for (const [moduleId, values] of changes) await updateParameterModule(client as unknown as Queryable, { organizationId, moduleId, ...values });
    const copiedRecognition = await applyCopySubjects(client, organizationId, plan.copyCreates, plan.moduleIds, input.reason);
    await applyLifecycle(client, organizationId, invocation, requestId, input.idempotencyKey, input.reason, plan.lifecycle, plan.moduleIds);
    await applySubjectPlacement(client, organizationId, plan.subjectChanges, plan.moduleIds);
    await applyRecognition(client as unknown as Database, organizationId, plan.currentCatalogReleaseId, invocation, requestId, input.idempotencyKey, [...plan.recognitionChanges, ...copiedRecognition]);
    const deletions = await client.query<{ id: string }>("select id from parameter_modules where organization_id=$1 and id=any($2::text[]) order by depth desc,id", [organizationId, [...plan.deleted]]);
    for (const row of deletions.rows) await deleteParameterModule(client as unknown as Queryable, { organizationId, moduleId: row.id });
    const changedModules = new Set(plan.changes.filter(change => !change.moduleId.startsWith("subject:")).map(change => change.moduleId)).size;
    const receipt = { id: `msr_${randomUUID()}`, organizationId, changedModules, changedFields: plan.changes.length + plan.recognitionChanges.length };
    if (receipt.changedFields || plan.copyMappings.length) await writeAuditEventInTx(asAuditTx(client), invocation, { requestId }, { app: "parameter-governance", kind: "module-structure-update",
      action: "module-structure-update", severity: "Medium", projectId: null, targetType: "organization", targetId: organizationId,
      metadata: { receiptId: receipt.id, reason: input.reason, exportId: input.document.source.exportId,
        sourceOrganizationId: input.document.source.organizationId, catalogReleaseId: plan.currentCatalogReleaseId,
        changedModules: receipt.changedModules, changedFields: receipt.changedFields } });
    await client.query(`update parameter_catalog.governance_command_idempotency set state='committed',result_kind='module-structure-receipt',result_ref=$3,committed_at=now()
      where organization_id=$1 and command_family='module-structure-update' and idempotency_key=$2`, [organizationId, input.idempotencyKey, JSON.stringify(receipt)]);
    await client.query("commit"); return receipt;
  } catch (error) { await client.query("rollback").catch(() => undefined); throw error; }
  finally { client.release(); }
}
