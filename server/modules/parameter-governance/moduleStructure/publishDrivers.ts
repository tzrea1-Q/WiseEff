import type pg from "pg";
import { createHash } from "node:crypto";
import { createSavepointDatabase, type Database } from "../../../shared/database/client";
import { linkCatalogStageToPublication } from "../../../observability/catalogPublicationStages";
import { ApiError } from "../../../shared/http/errors";
import { assertTrustedInvocationMatchesScope, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { asAuditTx, writeAuditEventInTx } from "../../audit/auditedWrite";
import { moduleStructureApplyRequestSchema } from "../../contracts/dtoSchemas/moduleStructure";
import { enqueueModuleDriverPublication, prepareModuleDriverPublication, publicationPreparationReason } from "../../catalog-publication/moduleStructureDrivers";
import { isPublicationFrozen } from "../../catalog-publication/runtime/freeze";
import { lockOrganizationModuleStructure } from "../../parameter-modules/recognitionLock";
import { planModuleStructure, publicModuleStructurePreview, stable } from "./preview";
import { driverDeclarationsDigest, type DriverCreation } from "./newDrivers";
import { enrichModuleStructureError } from "./importErrorDetails";

type DriverBase = { digest: string; proof: string };

// Erasure takes the exclusive pointer lock but can leave the current release id unchanged.
// Prefer the constant-size generation. Older stores can compare their physical ancestor pins.
async function readDriverBase(client: pg.PoolClient, releaseId: string): Promise<DriverBase> {
  const release = (await client.query<{ digest: string; has_epoch: boolean }>(`select release_digest as digest,
      coalesce(has_table_privilege(to_regclass('catalog_publication.checkpoint_epoch'), 'select'), false) as has_epoch
    from parameter_catalog.catalog_releases where id=$1`, [releaseId])).rows[0];
  if (!release) throw new ApiError("CONFLICT", "Catalog is unavailable.");
  if (release.has_epoch) {
    const epoch = (await client.query<{ generation: string }>(
      "select generation::text from catalog_publication.checkpoint_epoch where singleton")).rows[0];
    if (!epoch) throw new ApiError("CONFLICT", "Catalog checkpoint is unavailable.");
    return { digest: release.digest, proof: epoch.generation };
  }
  const pins = (await client.query<{ lineage: string }>(`with recursive chain as (
    select a.artifact_digest, a.predecessor_release_digest, a.id, a.bytes_checksum
      from catalog_publication.release_artifacts a where a.artifact_digest=$1
    union
    select a.artifact_digest, a.predecessor_release_digest, a.id, a.bytes_checksum
      from catalog_publication.release_artifacts a join chain c on a.artifact_digest=c.predecessor_release_digest
  ) select coalesce(jsonb_agg(jsonb_build_array(id,artifact_digest,predecessor_release_digest,bytes_checksum)
      order by id), '[]'::jsonb)::text as lineage from chain`, [release.digest])).rows[0]!;
  return { digest: release.digest, proof: pins.lineage };
}

function publicationFailure(reason: string) {
  if (reason === "artifact-too-large") return new ApiError("PAYLOAD_TOO_LARGE", "目录工件超出数据库单次写入限制。", { reason });
  if (reason === "persist-failed") return new ApiError("INTERNAL_ERROR", "新增驱动的发布候选写入失败。", { reason });
  return new ApiError(reason.startsWith("publication-") ? "FORBIDDEN" : "CONFLICT",
    `新增驱动未能进入发布（${reason}）；模块与组织登记尚未应用。`, { reason });
}

/** Explicit first confirmation. Publication activation stays in the manager process. */
export async function publishModuleStructureDrivers(db: Database, pool: pg.Pool, organizationId: string,
  trustedActor: TrustedInvocationContext, requestId: string, raw: unknown) {
  if (trustedActor.initiator !== "user") throw new ApiError("FORBIDDEN", "A human administrator is required.");
  const invocation = trustedActor;
  assertTrustedInvocationMatchesScope(invocation.principal, invocation, organizationId, "module driver publication");
  if (!( ["catalog:author", "catalog:publish"] as const).every(permission => invocation.principal.permissions.includes(permission)))
    throw new ApiError("FORBIDDEN", "发布新增驱动需要 Catalog 编制与发布权限。", { reason: "publication-capability-missing" });
  const parsed = moduleStructureApplyRequestSchema.safeParse(raw);
  if (!parsed.success) throw enrichModuleStructureError(new ApiError("VALIDATION_FAILED", "Invalid driver publication confirmation.", { issues: parsed.error.issues }), raw);
  const input = parsed.data;
  const request = { mode: input.mode, document: input.document, resolutions: input.resolutions, mappings: input.mappings };
  const fingerprint = createHash("sha256").update(stable({ organizationId, actorId: invocation.principal.user.id,
    request, reason: input.reason })).digest("hex");
  // The organization lock serializes this idempotency namespace. Avoid leaving a pending
  // reservation when a request disconnects or preparation fails before the write transaction.
  const recordResult = (client: pg.PoolClient, candidateId: string, jobId: string) => client.query(`
    insert into parameter_catalog.governance_command_idempotency as i
      (organization_id,command_family,idempotency_key,request_fingerprint,state,result_kind,result_ref,committed_at)
    values ($1,'module-structure-driver-publication',$2,$3,'committed','module-driver-publication',$4,now())
    on conflict (organization_id,command_family,idempotency_key) do update
      set state='committed',result_kind=excluded.result_kind,result_ref=excluded.result_ref,committed_at=excluded.committed_at
      where i.state='pending' and i.request_fingerprint=excluded.request_fingerprint`,
    [organizationId, input.idempotencyKey, fingerprint, JSON.stringify({ candidateId, jobId })]);

  async function withReviewedPlan<T>(onApproval: (client: pg.PoolClient, creation: DriverCreation, base: DriverBase) => Promise<T>) {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("begin");
      await lockOrganizationModuleStructure(client, organizationId);
      const authorization = await client.query(`select rb.role_id from public.user_role_bindings rb
        join public.users u on u.id=rb.user_id and u.is_active
        where rb.user_id=$1 and rb.organization_id=$2 and rb.project_id is null
          and (rb.role_id='platform-admin' or (rb.role_id='admin' and rb.organization_id=$3)) for share of rb,u`,
        [invocation.principal.user.id, invocation.principal.organization.id, organizationId]);
      if (!authorization.rowCount) throw new ApiError("FORBIDDEN", "Organization administrator access is required.");
      const previous = (await client.query<{ request_fingerprint: string; state: string }>(`select request_fingerprint,state
        from parameter_catalog.governance_command_idempotency where organization_id=$1
        and command_family='module-structure-driver-publication' and idempotency_key=$2 for update`, [organizationId, input.idempotencyKey])).rows[0];
      if (previous && previous.request_fingerprint !== fingerprint) throw new ApiError("CONFLICT", "Idempotency key was already used for different driver publication content.");
      const plan = await planModuleStructure(client, organizationId, invocation, request);
      const creation = plan.driverCreation;
      if (!creation) throw new ApiError("VALIDATION_FAILED", "文件中没有待创建的驱动。", { path: "document.newDrivers" });
      if (previous?.state === "committed" || ["publishing", "ready", "applied"].includes(creation.phase)) {
        if (previous?.state !== "committed" && creation.candidateId && creation.jobId) await recordResult(client, creation.candidateId, creation.jobId);
        await client.query("commit");
        return { replay: true as const, result: publicModuleStructurePreview(plan) };
      }
      if (plan.token !== input.token) throw new ApiError("CONFLICT", "Preview is stale; review the current state again.");
      if (plan.conflicts.length) throw new ApiError("CONFLICT", "Resolve all conflicts before publishing drivers.");
      if (await isPublicationFrozen(client)) throw publicationFailure("publication-frozen");
      const base = await readDriverBase(client, plan.currentCatalogReleaseId);
      const result = await onApproval(client, creation, base);
      await client.query("commit");
      return { replay: false as const, result };
    } catch (error) {
      await client.query("rollback").catch(() => { discard = true; });
      throw error;
    } finally { client.release(discard || undefined); }
  }

  try {
    const first = await withReviewedPlan(async (_client, creation, base) => ({ drivers: creation.drivers, base }));
    if (first.replay) return first.result;
    const { drivers, base } = first.result;
    const prepared = await prepareModuleDriverPublication(db, organizationId, base.digest, invocation, drivers);
    // Repeat all mutable approval checks. A concurrent confirmation can now replay its result;
    // a stale review, revoked administrator, or rewritten predecessor can never use prepared bytes.
    const committed = await withReviewedPlan(async (client, creation, currentBase) => {
      if (currentBase.digest !== base.digest || currentBase.proof !== base.proof)
        throw new ApiError("CONFLICT", "Catalog changed during driver preparation; review the current state again.");
      if (!prepared.ok) throw publicationFailure(publicationPreparationReason(prepared.error));
      const published = await enqueueModuleDriverPublication({ db: createSavepointDatabase(client), organizationId,
        exportId: input.document.source.exportId, prepared: prepared.value, invocation, drivers: creation.drivers,
        ...(creation.phase === "blocked" && creation.jobId ? { previousJobId: creation.jobId } : {}) });
      if (!published.ok) throw publicationFailure(published.reason);
      await client.query(`insert into parameter_catalog.module_structure_driver_publications
        (organization_id,export_id,declarations_digest,declarations,candidate_id,job_id,allocated_subjects)
        values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (organization_id,export_id) do update set candidate_id=excluded.candidate_id,
          job_id=excluded.job_id,allocated_subjects=excluded.allocated_subjects`,
        [organizationId, input.document.source.exportId, driverDeclarationsDigest(input.document.newDrivers!),
          JSON.stringify(input.document.newDrivers), published.candidateId, published.jobId, JSON.stringify(published.mapping)]);
      await recordResult(client, published.candidateId, published.jobId);
      await writeAuditEventInTx(asAuditTx(client), invocation, { requestId }, { app: "parameter-governance", kind: "module-structure-driver-publication",
        action: "module-structure-driver-publication", severity: "High", projectId: null, targetType: "organization", targetId: organizationId,
        metadata: { exportId: input.document.source.exportId, candidateId: published.candidateId, jobId: published.jobId,
          previousJobId: creation.jobId ?? null, driverCount: creation.drivers.length, reason: input.reason } });
      return publicModuleStructurePreview(await planModuleStructure(client, organizationId, invocation, request));
    });
    const ids = committed.result.driverCreation;
    linkCatalogStageToPublication(ids?.candidateId, ids?.jobId);
    return committed.result;
  } catch (error) { throw enrichModuleStructureError(error, raw); }
}
