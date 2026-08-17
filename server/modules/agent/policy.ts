import { ApiError } from "../../shared/http/errors";
import type { AuthContext, BackendPermission } from "../auth/types";

export function requireAgentPermission(auth: AuthContext, permission: BackendPermission) {
  if (!auth.user.isActive || !auth.permissions.includes(permission)) {
    throw new ApiError("FORBIDDEN", `Missing permission: ${permission}.`, { permission });
  }
}

export function requireAgentProjectAccess(auth: AuthContext, projectId?: string) {
  if (!projectId) {
    return;
  }
  const hasGlobalAdmin = auth.roles.some(
    (role) => (role.roleId === "admin" || role.roleId === "platform-admin") && role.projectId === null
  );
  const hasProjectRole = auth.roles.some((role) => role.projectId === projectId);
  if (!hasGlobalAdmin && !hasProjectRole) {
    throw new ApiError("FORBIDDEN", "Agent project access is required.", { projectId });
  }
}
