import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission } from "../auth/types";

function requirePermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, 403, { permission });
  }
}

export function requireDebugView(auth: AuthContext) {
  requirePermission(auth, "debugging:view");
}

export function requireDebugRead(auth: AuthContext) {
  requirePermission(auth, "debugging:read");
}

export function requireDebugWrite(auth: AuthContext) {
  requirePermission(auth, "debugging:write");
}

export function requireDebugRollback(auth: AuthContext) {
  requirePermission(auth, "debugging:rollback");
}

export function requireDebugAdmin(auth: AuthContext) {
  requirePermission(auth, "debugging:admin");
}
