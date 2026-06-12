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

export function getAllowedDebugProjectIds(auth: AuthContext) {
  if (auth.roles.some((role) => role.projectId === null)) {
    return null;
  }

  return auth.roles
    .map((role) => role.projectId)
    .filter((projectId): projectId is string => typeof projectId === "string" && projectId.length > 0);
}

export function canAccessDebugProject(auth: AuthContext, projectId: string) {
  const allowedProjectIds = getAllowedDebugProjectIds(auth);
  return allowedProjectIds === null || allowedProjectIds.includes(projectId);
}

export function requireDebugProjectAccess(auth: AuthContext, projectId: string) {
  if (!canAccessDebugProject(auth, projectId)) {
    throw new ApiError("FORBIDDEN", "Debug project access is required.", 403, { projectId });
  }
}
