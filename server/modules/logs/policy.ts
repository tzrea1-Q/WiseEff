import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import type { Queryable } from "../../shared/database/client";

export function canDeleteLog(auth: AuthContext, log: { status: string; submitted_by_user_id?: string | null }) {
  return auth.user.isActive && auth.user.organizationId === auth.organization.id
    && (auth.permissions.includes("logs:admin-domains") || log.status === "failed" && log.submitted_by_user_id === auth.user.id);
}

/** The database repeats this decision under the existing erasure fence. */
export async function requireLogDeletion(db: Queryable, auth: AuthContext, logId: string) {
  if (!auth.user.isActive || auth.user.organizationId !== auth.organization.id) throw new ApiError("FORBIDDEN", "无权删除此日志。");
  if (auth.permissions.includes("logs:admin-domains")) return;
  const log = (await db.query<{ status: string; submitted_by_user_id: string | null }>(
    "select status,submitted_by_user_id from log_records where organization_id=$1 and id=$2", [auth.organization.id, logId])).rows[0];
  if (log && canDeleteLog(auth, log)) return;
  // A lost DELETE response or storage cleanup retry uses the original actor's receipt.
  if (!log) {
    try {
      if ((await db.query<{ item: unknown }>("select parameter_catalog.read_log_erasure($1,$2,$3) item", [auth.organization.id, logId, auth.user.id])).rows[0]?.item) return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "42501")) throw error;
    }
  }
  throw new ApiError("FORBIDDEN", "只能删除本人上传且分析失败或已取消的日志。");
}

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.permissions.includes(permission);
}

function requirePermission(auth: AuthContext, permission: BackendPermission, options: { requireActive?: boolean } = {}) {
  if (options.requireActive && !auth.user.isActive) {
    throw new ApiError("FORBIDDEN", "无权执行此操作。", { permission });
  }
  if (!hasPermission(auth, permission)) {
    throw new ApiError("FORBIDDEN", "无权执行此操作。", { permission });
  }
}

export function requireLogView(auth: AuthContext) {
  requirePermission(auth, "logs:view");
}

export function requireLogUpload(auth: AuthContext) {
  requirePermission(auth, "logs:upload", { requireActive: true });
}

export function requireLogAnalyze(auth: AuthContext) {
  requirePermission(auth, "logs:analyze", { requireActive: true });
}

export function requireLogArchive(auth: AuthContext) {
  requirePermission(auth, "logs:archive", { requireActive: true });
}

export function requireLogFeedback(auth: AuthContext) {
  requirePermission(auth, "logs:feedback", { requireActive: true });
}

export function requireLogAdminDomains(auth: AuthContext) {
  requirePermission(auth, "logs:admin-domains", { requireActive: true });
}
