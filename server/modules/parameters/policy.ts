import type { AuthContext, BackendPermission, BackendRoleId } from "../auth/types";

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.permissions.includes(permission);
}

function hasRole(auth: AuthContext, roles: BackendRoleId[]) {
  return auth.roles.some((binding) => roles.includes(binding.roleId));
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

export function canMergeParameters(auth: AuthContext) {
  return isActive(auth) && hasRole(auth, ["software-user", "admin"]);
}

export function canAdminParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "admin:access");
}
