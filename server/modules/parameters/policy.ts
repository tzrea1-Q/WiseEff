import type { AuthContext, BackendPermission, BackendRoleId } from "../auth/types";
import type { ParameterChangeRequestStatus } from "./status";

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.permissions.includes(permission);
}

function hasRole(auth: AuthContext, roles: BackendRoleId[], projectId?: string) {
  return auth.roles.some(
    (binding) =>
      roles.includes(binding.roleId) &&
      (binding.roleId === "admin" || projectId === undefined || binding.projectId === projectId)
  );
}

function isActive(auth: AuthContext) {
  return auth.user.isActive;
}

export function canViewParameters(auth: AuthContext) {
  return hasPermission(auth, "parameter:view");
}

export function canEditParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "parameter:edit");
}

export function canReviewParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "parameter:review");
}

export function canReviewParameterStage(auth: AuthContext, projectId: string, fromStatus: ParameterChangeRequestStatus) {
  if (!isActive(auth)) return false;
  if (hasRole(auth, ["admin"])) return true;
  if (fromStatus === "submitted" || fromStatus === "hardware_review") {
    return hasRole(auth, ["hardware-committer"], projectId);
  }
  if (fromStatus === "software_review") {
    return hasRole(auth, ["software-committer"], projectId);
  }
  return false;
}

export function canMergeParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth)) return false;
  if (hasRole(auth, ["admin"])) return true;
  if (!projectId) return hasRole(auth, ["software-user"]);
  return hasRole(auth, ["software-user"], projectId);
}

export function canAdminParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "admin:access");
}
