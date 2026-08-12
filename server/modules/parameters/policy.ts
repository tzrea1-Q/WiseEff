import type { AuthContext, BackendPermission, BackendRoleId } from "../auth/types";
import type { ParameterChangeRequestStatus } from "./status";

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

/**
 * `parameter:edit` is a flat permission unioned across every role binding, so a
 * user bound to project A still carries it while acting on project B. When a
 * target project is known, additionally require an edit-capable role bound to
 * that project (admins remain global) so a write cannot cross project scope.
 */
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
  // The merge (softwareUser) slot accepts either role at assignment time
  // (see assertWorkflowAssigneesEligible), so the merge gate must match or a
  // software-committer assigned to merge can never advance the round.
  const mergeRoles: BackendRoleId[] = ["software-user", "software-committer"];
  if (!projectId) return hasRole(auth, mergeRoles);
  return hasRole(auth, mergeRoles, projectId);
}

export function canAdminParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "admin:access");
}
