import { getPlatformRole, migrateLegacyRoleId, roleSupportsWorkflowSlot } from "../../../../src/domain/users/types";

export type PersonalRoleLevel = "guest" | "user" | "committer" | "admin";

const OPEN_REVIEW_STATUSES = ["submitted", "hardware_review", "software_review", "software_merge"] as const;

export function resolvePersonalRoleLevel(roleId: string): PersonalRoleLevel {
  return getPlatformRole(migrateLegacyRoleId(roleId)).level;
}

export function actionableReviewStatusesForRole(roleId: string): string[] {
  const normalizedRoleId = migrateLegacyRoleId(roleId);
  if (roleSupportsWorkflowSlot(normalizedRoleId, "hardwareCommitter")) {
    return ["hardware_review"];
  }
  if (roleSupportsWorkflowSlot(normalizedRoleId, "softwareCommitter")) {
    return ["software_review"];
  }
  if (roleSupportsWorkflowSlot(normalizedRoleId, "softwareUser")) {
    return ["software_merge"];
  }
  if (getPlatformRole(normalizedRoleId).level === "committer") {
    return [...OPEN_REVIEW_STATUSES];
  }
  return [];
}

export function sqlInList(values: readonly string[]) {
  return values.map((value) => `'${value}'`).join(", ");
}

export const ADMIN_GOVERNANCE_AUDIT_KINDS = [
  "batch-import",
  "parameter-review-advance",
  "parameter-review-reject",
  "parameter-merge",
  "parameter-submit",
  "parameter-submission-withdraw"
] as const;

export const ADMIN_GOVERNANCE_AUDIT_APPS = ["parameter-admin", "user-admin", "parameter-management"] as const;
