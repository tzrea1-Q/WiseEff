export type PlatformRoleId = "guest" | "user" | "committer" | "admin";

export type PermissionKey =
  | "parameter:view"
  | "parameter:edit"
  | "debugging:use"
  | "logs:upload"
  | "parameter:review"
  | "admin:access"
  | "users:manage";

export type PlatformRole = {
  id: PlatformRoleId;
  name: "Guest" | "User" | "Committer" | "Admin";
  description: string;
  permissions: PermissionKey[];
};

export type UserAccount = {
  id: string;
  name: string;
  email: string;
  title: string;
  roleId: PlatformRoleId;
  isActive: boolean;
  createdAt: string;
  lastActive: string;
};

export const platformRoles: PlatformRole[] = [
  {
    id: "guest",
    name: "Guest",
    description: "Can view parameter pages only.",
    permissions: ["parameter:view"]
  },
  {
    id: "user",
    name: "User",
    description: "Can view and modify parameters, debug devices and nodes, and upload logs for analysis.",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]
  },
  {
    id: "committer",
    name: "Committer",
    description: "Can perform User actions and review parameter submissions.",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]
  },
  {
    id: "admin",
    name: "Admin",
    description: "Can perform Committer actions and access application admin pages and user management.",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]
  }
];

const roleRank: Record<PlatformRoleId, number> = {
  guest: 0,
  user: 1,
  committer: 2,
  admin: 3
};

export function isPlatformRoleId(value: string): value is PlatformRoleId {
  return value === "guest" || value === "user" || value === "committer" || value === "admin";
}

export function migrateLegacyRoleId(roleId: string): PlatformRoleId {
  if (isPlatformRoleId(roleId)) {
    return roleId;
  }

  switch (roleId) {
    case "hardware":
      return "guest";
    case "project":
      return "user";
    case "parameter-admin":
      return "committer";
    case "admin":
      return "admin";
    default:
      return "guest";
  }
}

export function getPlatformRole(roleId: string): PlatformRole {
  const migratedRoleId = migrateLegacyRoleId(roleId);
  return platformRoles.find((role) => role.id === migratedRoleId) ?? platformRoles[0];
}

export function roleHasPermission(roleId: string, permission: PermissionKey): boolean {
  return getPlatformRole(roleId).permissions.includes(permission);
}

export function comparePlatformRoles(left: string, right: string): number {
  return roleRank[migrateLegacyRoleId(left)] - roleRank[migrateLegacyRoleId(right)];
}
