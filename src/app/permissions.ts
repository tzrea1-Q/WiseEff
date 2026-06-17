import type { PageKey } from "@/appConfig";
import { comparePlatformRoles, migrateLegacyRoleId, type PlatformRoleId } from "@/domain/users/types";

export type ActionKey =
  | "parameter.view"
  | "parameter.edit"
  | "parameter.review"
  | "parameter.merge"
  | "debugging.use"
  | "logs.upload"
  | "admin.access"
  | "users.manage";

const pageRequiredRoles: Record<PageKey, PlatformRoleId> = {
  home: "guest",
  "parameter-home": "guest",
  parameters: "guest",
  "parameter-submissions": "hardware-user",
  "parameter-comparison": "guest",
  "parameter-review": "hardware-committer",
  "parameter-admin": "admin",
  "log-dashboard": "hardware-user",
  logs: "hardware-user",
  "log-admin": "admin",
  debugging: "hardware-user",
  "node-debugging": "hardware-user",
  "debugging-admin": "admin",
  "user-permissions": "admin",
  audit: "admin"
};

const actionRequiredRoles: Record<ActionKey, PlatformRoleId> = {
  "parameter.view": "guest",
  "parameter.edit": "hardware-user",
  "parameter.review": "hardware-committer",
  "parameter.merge": "software-user",
  "debugging.use": "hardware-user",
  "logs.upload": "hardware-user",
  "admin.access": "admin",
  "users.manage": "admin"
};

const roleLabels: Record<PlatformRoleId, string> = {
  guest: "Guest",
  "hardware-user": "Hardware User",
  "software-user": "Software User",
  "hardware-committer": "Hardware Committer",
  "software-committer": "Software Committer",
  admin: "Admin"
};

export function getRequiredRoleForPage(pageKey: PageKey): PlatformRoleId {
  return pageRequiredRoles[pageKey] ?? "guest";
}

export function getRequiredRoleForAction(actionKey: ActionKey): PlatformRoleId {
  return actionRequiredRoles[actionKey];
}

export function canAccessParameterReviewPage(roleId: string): boolean {
  const normalizedRole = migrateLegacyRoleId(roleId);
  return canPerform(normalizedRole, "parameter.review") || canPerform(normalizedRole, "parameter.merge");
}

export function canAccessPage(roleId: string, pageKey: PageKey): boolean {
  const normalizedRole = migrateLegacyRoleId(roleId);
  if (pageKey === "parameter-review") {
    return canAccessParameterReviewPage(normalizedRole);
  }
  return comparePlatformRoles(normalizedRole, getRequiredRoleForPage(pageKey)) >= 0;
}

export function canPerform(roleId: string, actionKey: ActionKey): boolean {
  const normalizedRole = migrateLegacyRoleId(roleId);
  if (actionKey === "parameter.merge") {
    return normalizedRole === "software-user" || normalizedRole === "admin";
  }
  return comparePlatformRoles(normalizedRole, getRequiredRoleForAction(actionKey)) >= 0;
}

export function getDisabledReason(roleId: string, actionKey: ActionKey): string | undefined {
  if (canPerform(roleId, actionKey)) {
    return undefined;
  }
  return `Requires ${roleLabels[getRequiredRoleForAction(actionKey)]} role`;
}

export function getRequiredRoleLabel(roleId: PlatformRoleId): string {
  return roleLabels[roleId];
}

export function getAccessibleFallbackPath(roleId: string): string {
  const normalizedRole = migrateLegacyRoleId(roleId);
  if (comparePlatformRoles(normalizedRole, "guest") >= 0) {
    return "/parameter-home";
  }
  return "/";
}
