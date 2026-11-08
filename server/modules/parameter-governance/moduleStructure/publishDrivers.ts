import type pg from "pg";
import { createHash } from "node:crypto";
import { createSavepointDatabase, type Queryable } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { moduleStructureApplyRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { enqueueModuleDriverPublication } from "../../catalog-publication/moduleStructureDrivers";
import { lockOrganizationModuleStructure } from "../../parameter-modules/recognitionLock";
import { planModuleStructure, publicModuleStructurePreview, stable } from "./preview";
import { driverDeclarationsDigest } from "./newDrivers";
import { enrichModuleStructureError } from "./importErrorDetails";

/** Explicit first confirmation. Publication activation stays in the manager process. */
export async function publishModuleStructureDrivers(pool: pg.Pool, organizationId: string,
  invocation: TrustedInvocationContext, requestId: string, raw: unknown) {
  if (invocation.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module driver publication");
  if (!( ["catalog:author", "catalog:publish"] as const).every(permission => invocation.principal.permissions.includes(permission)))
    throw new ApiError("FORBIDDEN", "发布新增驱动需要 Catalog 编制与发布权限。", { reason: "publication-capability-missing" });
  const parsed = moduleStructureApplyRequestSchema.safeParse(raw);
  if (!parsed.success) throw enrichModuleStructureError(new ApiError("VALIDATION_FAILED", "Invalid driver publication confirmation.", { issues: parsed.error.issues }), raw);
  const input = parsed.data;
  const request = { mode: input.mode, document: input.document, resolutions: input.resolutions, mappings: input.mappings };
  const fingerprint = createHash("sha256").update(stable({ organizationId, actorId: invocation.principal.user.id,
    request, reason: input.reason })).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockOrganizationModuleStructure(client as unknown as Queryable, organizationId);
    const authorization = await client.query(`select rb.role_id from public.user_role_bindings rb
      join public.users u on u.id=rb.user_id and u.is_active
      where rb.user_id=$1 and rb.organization_id=$2 and rb.project_id is null
        and (rb.role_id='platform-admin' or (rb.role_id='admin' and rb.organization_id=$3)) for share of rb,u`,
      [invocation.principal.user.id, invocation.principal.organization.id, organizationId]);
    if (!authorization.rowCount) throw new ApiError("FORBIDDEN", "Organization administrator access is required.");
    await client.query(`insert into parameter_catalog.governance_command_idempotency
      (organization_id,command_family,idempotency_key,request_fingerprint,state)
      values ($1,'module-structure-driver-publication',$2,$3,'pending') on conflict do nothing`, [organizationId, input.idempotencyKey, fingerprint]);
    const previous = (await client.query<{ request_fingerprint: string; state: string }>(`select request_fingerprint,state
      from parameter_catalog.governance_command_idempotency where organization_id=$1
      and command_family='module-structure-driver-publication' and idempotency_key=$2 for update`, [organizationId, input.idempotencyKey])).rows[0]!;
    if (previous.request_fingerprint !== fingerprint) throw new ApiError("CONFLICT", "Idempotency key was already used for different driver publication content.");
    const plan = await planModuleStructure(client, organizationId, invocation, request);
    const creation = plan.driverCreation;
    if (!creation) throw new ApiError("VALIDATION_FAILED", "文件中没有待创建的驱动。", { path: "document.newDrivers" });
    // A response lost after the commit must not create another candidate or job.
    const recordResult = async (candidateId: string, jobId: string) => client.query(`update parameter_catalog.governance_command_idempotency
      set state='committed',result_kind='module-driver-publication',result_ref=$3,committed_at=now()
      where organization_id=$1 and command_family='module-structure-driver-publication' and idempotency_key=$2 and state='pending'`,
      [organizationId, input.idempotencyKey, JSON.stringify({ candidateId, jobId })]);
    if (previous.state === "committed" || ["publishing", "ready", "applied"].includes(creation.phase)) {
      if (creation.candidateId && creation.jobId) await recordResult(creation.candidateId, creation.jobId);
      await client.query("commit");
      return publicModuleStructurePreview(plan);
    }
    if (plan.token !== input.token) throw new ApiError("CONFLICT", "Preview is stale; review the current state again.");
    if (plan.conflicts.length) throw new ApiError("CONFLICT", "Resolve all conflicts before publishing drivers.");
    const release = (await client.query<{ digest: string }>("select release_digest as digest from parameter_catalog.catalog_releases where id=$1", [plan.currentCatalogReleaseId])).rows[0];
    if (!release) throw new ApiError("CONFLICT", "Catalog is unavailable.");
    const published = await enqueueModuleDriverPublication({ db: createSavepointDatabase(client), organizationId,
      exportId: input.document.source.exportId, predecessorDigest: release.digest, invocation, drivers: creation.drivers,
      ...(creation.phase === "blocked" && creation.jobId ? { previousJobId: creation.jobId } : {}) });
    if (!published.ok) throw new ApiError(published.reason.startsWith("publication-") ? "FORBIDDEN" : "CONFLICT",
      `新增驱动未能进入发布（${published.reason}）；模块与组织登记尚未应用。`, { reason: published.reason });
    await client.query(`insert into parameter_catalog.module_structure_driver_publications
      (organization_id,export_id,declarations_digest,declarations,candidate_id,job_id,allocated_subjects)
      values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (organization_id,export_id) do update set candidate_id=excluded.candidate_id,
        job_id=excluded.job_id,allocated_subjects=excluded.allocated_subjects`,
      [organizationId, input.document.source.exportId, driverDeclarationsDigest(input.document.newDrivers!),
        JSON.stringify(input.document.newDrivers), published.candidateId, published.jobId, JSON.stringify(published.mapping)]);
    await recordResult(published.candidateId, published.jobId);
    await writeAuditEventInTx(asAuditTx(client), invocation, { requestId }, { app: "parameter-governance", kind: "module-structure-driver-publication",
      action: "module-structure-driver-publication", severity: "High", projectId: null, targetType: "organization", targetId: organizationId,
      metadata: { exportId: input.document.source.exportId, candidateId: published.candidateId, jobId: published.jobId,
        previousJobId: creation.jobId ?? null, driverCount: creation.drivers.length, reason: input.reason } });
    const after = await planModuleStructure(client, organizationId, invocation, request);
    await client.query("commit");
    return publicModuleStructurePreview(after);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw enrichModuleStructureError(error, raw);
  } finally { client.release(); }
}
