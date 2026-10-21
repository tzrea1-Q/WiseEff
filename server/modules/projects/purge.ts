import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { ObjectStore } from "../logs/objectStore";
import type { ProjectDeletionStatus } from "../../../src/domain/parameters/projectDeletionPreview";
import { readProjectDeletionPreview } from "./deletionPreview";

type Receipt = { digest: string; pending: string[] };
function requireCurrentAdministrator(error: unknown): never {
  if (error instanceof pg.DatabaseError && error.code === "42501") throw new ApiError("FORBIDDEN", "需要本组织当前有效的管理员权限。");
  throw error;
}
async function receipt(db: Database, auth: AuthContext, projectId: string) {
  return (await db.query<{ item: Receipt | null }>("select parameter_catalog.read_project_erasure($1,$2,$3) as item",
    [auth.organization.id, projectId, auth.user.id]).catch(requireCurrentAdministrator)).rows[0]?.item ?? null;
}
const status = (projectId: string, item: Receipt): ProjectDeletionStatus => ({ projectId, stateDigest: item.digest, database: "deleted",
  objects: item.pending.length ? "pending" : "complete", pendingObjects: item.pending.length });

/** Reusing a display code creates a new project, never the erased identity. */
export async function resolveProjectCreateId(db: Database, auth: AuthContext, proposedId: string, explicitId: boolean) {
  if (!await receipt(db, auth, proposedId)) return proposedId;
  if (explicitId) throw new ApiError("CONFLICT", "此项目 ID 已永久删除。请不指定 ID 创建新项目，项目代号可以复用。", { reason: "project-id-erased" });
  return `${proposedId}-${randomUUID()}`;
}

export async function projectDeletionStatus(db: Database, auth: AuthContext, projectId: string): Promise<ProjectDeletionStatus> {
  const item = await receipt(db, auth, projectId);
  if (!item) throw new ApiError("NOT_FOUND", "项目尚未彻底删除。", { projectId });
  return status(projectId, item);
}

export async function listProjectDeletions(db: Database, auth: AuthContext): Promise<ProjectDeletionStatus[]> {
  const rows = (await db.query<{ project_id: string; digest: string; pending: string[] }>(
    "select * from parameter_catalog.list_project_erasures($1,$2)", [auth.organization.id, auth.user.id]).catch(requireCurrentAdministrator)).rows;
  return rows.map(row => status(row.project_id, row));
}

export async function purgeProject(db: Database, invocation: TrustedInvocationContext, projectId: string, stateDigest: string, requestId: string, store?: ObjectStore) {
  const trusted = assertTrustedInvocationContext(invocation);
  if (trusted.initiator !== "user") throw new ApiError("FORBIDDEN", "项目彻底删除必须由管理员本人确认。");
  const auth = trusted.principal;
  const values = [auth.organization.id, projectId, auth.user.id];
  try {
    await db.transaction(async tx => {
      await tx.query("select parameter_catalog.lock_project_erasure($1,$2,$3)", values);
      const previous = await receipt(tx, auth, projectId);
      if (previous) {
        if (previous.digest !== stateDigest) throw new ApiError("CONFLICT", "删除确认与原请求不一致，请读取删除状态。", { reason: "project-purge-retry-mismatch" });
        return;
      }
      const preview = await readProjectDeletionPreview(tx, auth.organization.id, projectId, auth.user.id);
      if (preview.stateDigest !== stateDigest) throw new ApiError("CONFLICT", "项目数据已变化，请刷新删除影响预览后确认。", { reason: "project-purge-preview-stale" });
      if (preview.blockers.length) throw new ApiError("CONFLICT", "项目仍有运行或保留阻塞，请先处理后刷新。", { reason: "project-purge-blocked", blockers: preview.blockers });
      await tx.query("select parameter_catalog.purge_project($1,$2,$3,$4)", [...values, stateDigest]);
      await writeTrustedAuditEventInTx(asAuditTx(tx), { invocation: trusted, projectId: null,
        app: "parameter-admin", kind: "project-purged", action: "永久清理项目专属数据", severity: "High",
        targetType: "project", targetId: projectId, traceId: requestId,
        metadata: { stateDigest, inventory: preview.inventory, exclusiveObjects: preview.storage.exclusiveObjects,
          sharedObjectsRetained: preview.storage.sharedObjects } });
    });
    // A durable receipt survives object-store failure. Each retry rechecks all
    // retained references under the same write fence before removing any bytes.
    await db.transaction(async tx => {
      await tx.query("select parameter_catalog.lock_project_erasure($1,$2,$3)", values);
      const item = await receipt(tx, auth, projectId);
      if (!item) throw new ApiError("INTERNAL_ERROR", "项目清理回执不可用。");
      for (const key of item.pending) {
        const referenced = (await tx.query<{ referenced: boolean }>(
          "select parameter_catalog.definition_erasure_object_is_referenced('plane',$1) as referenced", [key])).rows[0]?.referenced;
        if (referenced === false) {
          if (!store?.delete) return;
          try { await store.delete(key); } catch { return; }
        } else if (referenced !== true) return;
        await tx.query("select parameter_catalog.finish_project_erasure_object($1,$2,$3,$4)", [...values, key]);
      }
    });
    return projectDeletionStatus(db, auth, projectId);
  } catch (error) {
    if (error instanceof pg.DatabaseError) {
      if (error.code === "42501") throw new ApiError("FORBIDDEN", "需要本组织当前有效的管理员权限。");
      if (["40001", "40P01", "55P03", "PCA05"].includes(error.code ?? "")) throw new ApiError("CONFLICT", "项目正在更新，请刷新预览后重试。", { reason: "project-purge-busy" });
      if (["23503", "55000"].includes(error.code ?? "")) throw new ApiError("CONFLICT", "项目仍有关联的保留数据，请先处理后刷新。", { reason: "project-purge-retained-reference" });
    }
    throw error;
  }
}
