import type { BackendPermission, BackendRoleId } from "./types";

const roleRank: Record<BackendRoleId, number> = {
  guest: 0,
  "hardware-user": 1,
  "software-user": 1,
  "hardware-committer": 2,
  "software-committer": 2,
  admin: 3
};

const rolePermissions: Record<BackendRoleId, BackendPermission[]> = {
  guest: ["parameter:view", "logs:view"],
  "hardware-user": [
    "parameter:view",
    "parameter:edit",
    "debugging:use",
    "debugging:view",
    "debugging:read",
    "logs:view",
    "logs:upload",
    "logs:feedback"
  ],
  "software-user": [
    "parameter:view",
    "parameter:edit",
    "debugging:use",
    "debugging:view",
    "debugging:read",
    "logs:view",
    "logs:upload",
    "logs:feedback"
  ],
  "hardware-committer": [
    "parameter:view",
    "parameter:edit",
    "debugging:use",
    "debugging:view",
    "debugging:read",
    "debugging:write",
    "debugging:rollback",
    "logs:view",
    "logs:upload",
    "logs:feedback",
    "parameter:review"
  ],
  "software-committer": [
    "parameter:view",
    "parameter:edit",
    "debugging:use",
    "debugging:view",
    "debugging:read",
    "debugging:write",
    "debugging:rollback",
    "logs:view",
    "logs:upload",
    "logs:feedback",
    "parameter:review"
  ],
  admin: [
    "parameter:view",
    "parameter:edit",
    "debugging:use",
    "debugging:view",
    "debugging:read",
    "debugging:write",
    "debugging:rollback",
    "debugging:admin",
    "logs:view",
    "logs:upload",
    "logs:feedback",
    "logs:analyze",
    "logs:archive",
    "parameter:review",
    "admin:access",
    "users:manage"
  ]
};

export function compareRoles(left: BackendRoleId, right: BackendRoleId) {
  return roleRank[left] - roleRank[right];
}

export function permissionsForRoles(roleIds: BackendRoleId[]): BackendPermission[] {
  return Array.from(new Set(roleIds.flatMap((roleId) => rolePermissions[roleId] ?? [])));
}

export function canPerform(roleId: BackendRoleId, permission: BackendPermission) {
  return rolePermissions[roleId].includes(permission);
}
