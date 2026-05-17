import type { PageKey } from "@/appConfig";
import { comparePlatformRoles, migrateLegacyRoleId, type PlatformRoleId } from "@/domain/users/types";

export type ActionKey =
  | "parameter.view"
  | "parameter.edit"
  | "parameter.review"
  | "debugging.use"
  | "logs.upload"
  | "admin.access"
  | "users.manage";

const pageRequiredRoles: Record<PageKey, PlatformRoleId> = {
  home: "guest",
  "parameter-home": "guest",
  parameters: "guest",
  "parameter-submissions": "user",
  "parameter-comparison": "guest",
  "parameter-review": "committer",
  "parameter-admin": "admin",
  "log-dashboard": "user",
  logs: "user",
  "log-admin": "admin",
  debugging: "user",
  "node-debugging": "user",
  "debugging-admin": "admin",
  "user-permissions": "admin"
};

const actionRequiredRoles: Record<ActionKey, PlatformRoleId> = {
  "parameter.view": "guest",
  "parameter.edit": "user",
  "parameter.review": "committer",
  "debugging.use": "user",
  "logs.upload": "user",
  "admin.access": "admin",
  "users.manage": "admin"
};

const roleLabels: Record<PlatformRoleId, string> = {
  guest: "Guest",
  user: "User",
  committer: "Committer",
  admin: "Admin"
};

export function getRequiredRoleForPage(pageKey: PageKey): PlatformRoleId {
  return pageRequiredRoles[pageKey] ?? "guest";
}

export function getRequiredRoleForAction(actionKey: ActionKey): PlatformRoleId {
  return actionRequiredRoles[actionKey];
}

export function canAccessPage(roleId: string, pageKey: PageKey): boolean {
  return comparePlatformRoles(roleId, getRequiredRoleForPage(pageKey)) >= 0;
}

export function canPerform(roleId: string, actionKey: ActionKey): boolean {
  return comparePlatformRoles(roleId, getRequiredRoleForAction(actionKey)) >= 0;
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
