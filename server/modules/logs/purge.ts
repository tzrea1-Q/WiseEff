import pg from "pg";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import { assertTrustedInvocationContext, type TrustedInvocationContext } from "../auth/trustedInvocation";
import { asAuditTx, writeTrustedAuditEventInTx } from "../audit/auditedWrite";
import type { ObjectStore } from "./objectStore";
import { requireLogAdminDomains, requireLogDeletion } from "./policy";
import { readLogDeletionPreview, referencedLogObjects } from "./deletionPreview";
import type { LogDeletionStatus } from "../../../src/domain/logs/deletionPreview";

type Receipt = { version: string; pending: string[] };
function normalize(error: unknown): never {
  if (error instanceof pg.DatabaseError) {
    if (error.code === "42501") throw new ApiError("FORBIDDEN", "需要日志管理权限，或删除本人上传且分析失败或已取消的日志。");
    if (["40001", "40P01", "55P03", "55000", "23503"].includes(error.code ?? ""))
      throw new ApiError("CONFLICT", "日志或关联任务正在更新，请重新获取预览后重试。", { reason: "log-purge-busy" });
  }
  throw error;
}
function requireAdministrator(auth: AuthContext) {
  requireLogAdminDomains(auth);
  if (auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权访问此组织的日志。");
}
async function receipt(db: Database, auth: AuthContext, logId: string) {
  return (await db.query<{ item: Receipt | null }>("select parameter_catalog.read_log_erasure($1,$2,$3) item",
    [auth.organization.id, logId, auth.user.id]).catch(normalize)).rows[0]?.item ?? null;
}
const status = (logId: string, item: Receipt): LogDeletionStatus => ({ logId, version: item.version, database: "deleted",
  objects: item.pending.length ? "pending" : "complete", pendingObjects: item.pending.length });

export async function logDeletionStatus(db: Database, auth: AuthContext, logId: string) {
  await requireLogDeletion(db, auth, logId).catch(normalize);
  const item = await receipt(db, auth, logId);
  if (!item) throw new ApiError("NOT_FOUND", "日志尚未永久删除。", { logId });
  return status(logId, item);
}
export async function pendingLogDeletions(db: Database, auth: AuthContext): Promise<LogDeletionStatus[]> {
  if (auth.permissions.includes("logs:admin-domains")) {
    requireAdministrator(auth);
  } else if (!auth.user.isActive || auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权访问此组织的存储清理记录。");
  const rows = (await db.query<{ log_id: string; version: string; pending: string[] }>(
    "select * from parameter_catalog.list_log_erasures($1,$2)", [auth.organization.id, auth.user.id]).catch(normalize)).rows;
  return rows.map((row) => status(row.log_id, row));
}

export async function purgeLog(db: Database, invocation: TrustedInvocationContext, logId: string, version: string, requestId: string, store?: ObjectStore) {
  const trusted = assertTrustedInvocationContext(invocation);
  if (trusted.initiator !== "user") throw new ApiError("FORBIDDEN", "日志永久删除须由用户本人确认。");
  const auth = trusted.principal;
  await requireLogDeletion(db, auth, logId).catch(normalize);
  const values = [auth.organization.id, logId, auth.user.id];
  try {
    await db.transaction(async (tx) => {
      await tx.query("select parameter_catalog.lock_log_erasure($1,$2,$3)", values);
      const previous = await receipt(tx, auth, logId);
      if (previous) {
        if (previous.version !== version) throw new ApiError("CONFLICT", "确认信息与原删除请求不一致，请读取删除状态。", { reason: "log-purge-retry-mismatch" });
        return;
      }
      const preview = await readLogDeletionPreview(tx, auth.organization.id, logId, auth.user.id);
      if (preview.version !== version) throw new ApiError("CONFLICT", "日志数据或引用已变化，请重新获取影响预览后确认。", { reason: "log-purge-preview-stale" });
      await tx.query("select parameter_catalog.purge_log($1,$2,$3,$4)", [...values, version]);
      await writeTrustedAuditEventInTx(asAuditTx(tx), { invocation: trusted, projectId: null, app: "log-analysis",
        kind: "log-purged", action: "永久清理日志记录及专属数据", severity: "High", targetType: "log-record", targetId: logId, traceId: requestId,
        metadata: { version, inventory: preview.inventory, sharedObjectsRetained: preview.objects.shared } });
    });
    // The receipt committed with deletion. Retries never repeat the domain mutation.
    await db.transaction(async (tx) => {
      await tx.query("select parameter_catalog.lock_log_erasure($1,$2,$3)", values);
      const item = await receipt(tx, auth, logId);
      if (!item) throw new ApiError("INTERNAL_ERROR", "日志清理回执不可用。");
      const shared = await referencedLogObjects(tx, item.pending);
      for (const key of item.pending) {
        if (!shared.has(key)) {
          if (!store?.delete) return;
          try { await store.delete(key); } catch { return; }
        }
        await tx.query("select parameter_catalog.finish_log_erasure_object($1,$2,$3,$4)", [...values, key]);
      }
    });
    return logDeletionStatus(db, auth, logId);
  } catch (error) { return normalize(error); }
}
