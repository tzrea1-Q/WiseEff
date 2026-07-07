import type { AuthContext, BackendPermission } from "../auth/types";
import { ApiError } from "../../shared/http/errors";

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.permissions.includes(permission);
}

function requirePermission(auth: AuthContext, permission: BackendPermission, options: { requireActive?: boolean } = {}) {
  if (options.requireActive && !auth.user.isActive) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission });
  }
  if (!hasPermission(auth, permission)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission });
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
