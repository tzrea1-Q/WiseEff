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

export function canViewParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth)) return false;
  if (hasPermission(auth, "parameter:view") || isOrgAdmin(auth)) return true;
  if (projectId !== undefined) {
    return auth.roles.some(
      (binding) =>
        (binding.projectId === projectId || binding.projectId === null) &&
        ["guest", "hardware-user", "software-user", "hardware-committer", "software-committer", "admin", "platform-admin"].includes(
          binding.roleId
        )
    );
  }
  return false;
}

/** Roles whose binding to a project grants parameter editing there. */
const projectEditRoles: BackendRoleId[] = ["hardware-user", "software-user", "hardware-committer", "software-committer"];
const criticalEditRoles: BackendRoleId[] = ["hardware-committer", "software-committer"];

function isOrgAdmin(auth: AuthContext) {
  return auth.roles.some((b) => b.projectId === null && (b.roleId === "admin" || b.roleId === "platform-admin"));
}

export function canEditParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth)) return false;
  if (isOrgAdmin(auth)) return true;
  if (projectId === undefined) {
    return hasPermission(auth, "parameter:edit");
  }
  const hasOrgEdit = auth.roles.some(
    (b) => b.projectId === null && projectEditRoles.includes(b.roleId)
  );
  if (hasOrgEdit) return true;
  return auth.roles.some(
    (b) => b.projectId === projectId && projectEditRoles.includes(b.roleId)
  );
}

export function canEditCriticalParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth)) return false;
  if (hasPermission(auth, "parameter:edit-critical")) return true;
  if (projectId !== undefined) {
    return auth.roles.some(
      (b) => b.projectId === projectId && criticalEditRoles.includes(b.roleId)
    );
  }
  return false;
}

export function canReviewParameters(auth: AuthContext, projectId?: string) {
  if (!isActive(auth)) return false;
  if (isOrgAdmin(auth)) return true;
  if (projectId === undefined) {
    return hasPermission(auth, "parameter:review");
  }
  const hasOrgReview = auth.roles.some(
    (b) => b.projectId === null && criticalEditRoles.includes(b.roleId)
  );
  if (hasOrgReview) return true;
  return auth.roles.some(
    (b) => b.projectId === projectId && criticalEditRoles.includes(b.roleId)
  );
}

export function canReviewParameterStage(auth: AuthContext, projectId: string, fromStatus: ParameterChangeRequestStatus) {
  if (!isActive(auth)) return false;
  if (isOrgAdmin(auth)) return true;
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
  if (isOrgAdmin(auth)) return true;
  if (!projectId) return false;
  return auth.roles.some(
    (b) => b.projectId === projectId && (b.roleId === "software-user" || b.roleId === "software-committer")
  );
}

export function canAdminParameters(auth: AuthContext) {
  return isActive(auth) && hasPermission(auth, "admin:access");
}
