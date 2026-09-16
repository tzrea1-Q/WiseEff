import type { AuthContext, BackendPermission, BackendRoleId } from "../auth/types";
import type { ParameterChangeRequestStatus } from "./workflowStatus";

function hasPermission(auth: AuthContext, permission: BackendPermission) {
  return auth.permissions.includes(permission);
}

function hasRole(auth: AuthContext, roles: BackendRoleId[], projectId?: string) {
  return auth.roles.some(
    (binding) =>
      roles.includes(binding.roleId) &&
      (binding.roleId === "admin" ||
        binding.roleId === "platform-admin" ||
        projectId === undefined ||
        // A null-project binding is an organization-wide grant of the role:
        // self-service registration approval and the M0 seed both produce
        // business roles with projectId null. Project-bound bindings stay
        // scoped to their project (the QA P1-E cross-project fix).
        binding.projectId === null ||
        binding.projectId === projectId)
  );
}

function isActive(auth: AuthContext) {
  return auth.user.isActive;
}

export function canViewParameters(auth: AuthContext) {
  return hasPermission(auth, "parameter:view");
}

/** Roles whose binding to a project grants parameter editing there. */
const projectEditRoles: BackendRoleId[] = ["hardware-user", "software-user", "hardware-committer", "software-committer"];

export function canEditParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth) || !hasPermission(auth, "parameter:edit")) return false;
  if (projectId === undefined) return true;
  if (hasRole(auth, ["admin", "platform-admin"])) return true;
  return hasRole(auth, projectEditRoles, projectId);
}

export function canEditCriticalParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "parameter:edit-critical");
}

export function canReviewParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "parameter:review");
}

export function canReviewParameterStage(auth: AuthContext, projectId: string, fromStatus: ParameterChangeRequestStatus) {
  if (!isActive(auth)) return false;
  if (hasRole(auth, ["admin"])) return true;
  if (fromStatus === "submitted" || fromStatus === "hardware_review") {
    return auth.roles.some((b) => b.projectId === projectId && b.roleId === "hardware-committer");
  }
  if (fromStatus === "software_review") {
    return auth.roles.some((b) => b.projectId === projectId && b.roleId === "software-committer");
  }
  return false;
}

export function canMergeParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth)) return false;
  if (hasRole(auth, ["admin"])) return true;
  const mergeRoles: BackendRoleId[] = ["software-user", "software-committer"];
  if (!projectId) return hasRole(auth, mergeRoles);
  return auth.roles.some((b) => b.projectId === projectId && mergeRoles.includes(b.roleId));
}

export function canAdminParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "admin:access");
}
