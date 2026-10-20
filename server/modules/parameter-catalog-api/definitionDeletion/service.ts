import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { Database, Queryable } from "../../../shared/database/client";
import { ApiError } from "../../../shared/http/errors";
import type { AuthContext } from "../../auth/types";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "../../auth/trustedInvocation";
import { writePlatformAuditEvent } from "../../audit/repository";
import { projectTrustedInvocationForAudit } from "../../audit/trustedAudit";
import { prepareCatalogDefinitionErasure } from "../../catalog-publication/definitionErasure";
import {
  cleanupPreparedArchiveErasure, deleteErasedArchiveObject, prepareDefinitionArchiveErasure,
  type DefinitionArchiveStores, type DefinitionArchiveErasure, type DefinitionDeletionInventory,
} from "./archives";

export function requireDefinitionErasureAdministrator(auth: AuthContext): void {
  if (!auth.user.isActive || !auth.roles.some(role => role.roleId === "platform-admin" && role.projectId === null)) {
    throw new ApiError("FORBIDDEN", "只有平台超级管理员可以彻底删除平台参数定义。", { reason: "definition-erasure-platform-admin-required" });
  }
}

async function inventory(db: Queryable, definitionId: string): Promise<DefinitionDeletionInventory> {
  const result = await db.query<{ preview: DefinitionDeletionInventory | null }>(
    "select parameter_catalog.preview_parameter_definition_purge($1) as preview", [definitionId]);
  const preview = result.rows[0]?.preview;
  if (!preview) throw new ApiError("NOT_FOUND", "参数定义不存在或已被彻底删除。");
  return preview;
}

const token = (preview: DefinitionDeletionInventory) => `sha256:${createHash("sha256")
  .update(JSON.stringify([preview.definition.id, preview.catalogRelease, preview.fingerprint])).digest("hex")}`;

function rethrowErasureConflict(error: unknown): never {
  if (error instanceof pg.DatabaseError) {
    if (error.code === "40001") throw new ApiError("CONFLICT", "删除影响已经变化，请重新读取影响后确认。", { reason: "definition-erasure-preview-stale" });
    if (["40P01", "55P03", "PCA05"].includes(error.code ?? "")) {
      throw new ApiError("CONFLICT", "参数数据正在更新，请稍后重试删除。", { reason: "definition-erasure-busy" });
    }
  }
  throw error;
}

export async function previewDefinitionDeletion(db: Database, auth: AuthContext, definitionId: string, stores: DefinitionArchiveStores = {}) {
  requireDefinitionErasureAdministrator(auth);
  return db.transaction(async tx => {
    await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [definitionId]);
    const preview = await inventory(tx, definitionId);
    const archives = await prepareDefinitionArchiveErasure(preview, stores, { dryRun: true });
    const count = (relation: string) => preview.counts[relation] ?? 0;
    return { item: { definition: preview.definition, catalogRelease: preview.catalogRelease,
      affected: { organizations: new Set([...preview.organizationIds, ...archives.affectedOrganizationIds]).size,
        projects: new Set([...preview.projectIds, ...archives.affectedProjectIds]).size,
        bindings: count("parameter_catalog.project_parameter_bindings"), values: count("parameter_catalog.project_parameter_values"),
        revisions: count("parameter_catalog.definition_revisions"), relatedRecords: Object.values(preview.counts).reduce((sum, value) => sum + value, 0) + archives.affectedArchiveRecords },
      originalFilesRetained: true as const, previewToken: token(preview) } };
  }).catch(rethrowErasureConflict);
}

type ErasureState = { counts: Record<string, number>; pending_object_refs: string[] };

async function readErasure(db: Queryable, definitionId: string): Promise<ErasureState | null> {
  const result = await db.query<{ erasure: ErasureState | null }>(
    "select parameter_catalog.read_parameter_definition_erasure($1) as erasure", [definitionId]);
  return result.rows[0]?.erasure ?? null;
}

/** Retry is idempotent; no deleted definition content is retained to finish object cleanup. */
async function finishObjectCleanup(db: Database, definitionId: string, state: ErasureState, stores: DefinitionArchiveStores) {
  for (const reference of state.pending_object_refs) {
    try {
      await deleteErasedArchiveObject(reference, stores, db);
      await db.query("select parameter_catalog.finish_parameter_definition_erasure_object($1,$2)", [definitionId, reference]);
    } catch {
      throw new ApiError("CONFLICT", "定义记录已移除，但归档清理未完成。请重试完成清理。", {
        reason: "definition-erasure-cleanup-pending", definitionId,
      });
    }
  }
}

export async function deleteDefinition(db: Database, invocation: TrustedInvocationContext, definitionId: string,
  previewToken: string, requestId: string, stores: DefinitionArchiveStores = {}) {
  const trusted = assertTrustedInvocationContext(invocation);
  if (trusted.initiator !== "user") throw new ApiError("FORBIDDEN", "彻底删除参数定义必须由平台超级管理员本人执行。");
  const auth = trusted.principal;
  requireDefinitionErasureAdministrator(auth);
  const auditId = randomUUID();
  const actor = projectTrustedInvocationForAudit(trusted);
  let preparedArchive: DefinitionArchiveErasure | undefined;
  let rolledBack = false;
  const result = await db.transaction(async tx => {
    await tx.query("select parameter_catalog.lock_parameter_definition_purge($1)", [definitionId]);
    const completed = await readErasure(tx, definitionId);
    if (completed) return completed;
    const preview = await inventory(tx, definitionId);
    if (previewToken !== token(preview)) throw new ApiError("CONFLICT", "删除影响已经变化，请重新读取影响后确认。", { reason: "definition-erasure-preview-stale" });
    const catalogPlan = await prepareCatalogDefinitionErasure(tx, definitionId).catch(error => {
      if (error instanceof pg.DatabaseError) throw error;
      throw new ApiError("CONFLICT", "当前规范快照无法安全删除，请先修复数据一致性。", { reason: "definition-erasure-catalog-drift" });
    });
    const archiveErasure = await prepareDefinitionArchiveErasure(preview, stores, { db: tx });
    preparedArchive = archiveErasure;
    const erased = await tx.query<{ result: { erased: boolean; counts: Record<string, number>; pendingObjectRefs: string[] } }>(
      "select parameter_catalog.purge_parameter_definition($1,$2::jsonb,$3,$4) as result",
      [definitionId, JSON.stringify({ ...catalogPlan, archiveErasure }), auth.user.id, auditId]);
    const outcome = erased.rows[0]?.result;
    if (!outcome?.erased) throw new ApiError("CONFLICT", "参数定义删除未完成，请刷新后重试。");
    await writePlatformAuditEvent(tx, {
        id: auditId, app: "parameters", kind: "governance", action: "definition-erased", severity: "High",
        projectId: null, targetType: "parameter-definition", targetId: definitionId,
        actorUserId: actor.actorUserId, actorType: actor.actorType, traceId: requestId,
        affectedOrganizationIds: [],
        metadata: { scope: "platform", affectedOrganizationIds: [...new Set([...preview.organizationIds, ...archiveErasure.affectedOrganizationIds])],
          affectedProjectIds: [...new Set([...preview.projectIds, ...archiveErasure.affectedProjectIds])],
          ...actor.metadata,
          counts: outcome.counts, originalFilesRetained: true,
          catalogRewrite: catalogPlan.releases.map(release => ({ id: release.id, oldDigest: release.oldDigest, newDigest: release.newDigest })) },
    });
    return { counts: outcome.counts, pending_object_refs: outcome.pendingObjectRefs };
  }, { onConfirmedRollback: () => { rolledBack = true; } }).catch(async error => {
    if (rolledBack && preparedArchive) await cleanupPreparedArchiveErasure(preparedArchive, stores, db);
    rethrowErasureConflict(error);
  });
  await finishObjectCleanup(db, definitionId, result, stores);
  return { item: { definitionId, deleted: true as const, counts: result.counts, originalFilesRetained: true as const } };
}
