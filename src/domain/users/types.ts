export type RoleDiscipline = "hardware" | "software";

export type PlatformRoleId =
  | "guest"
  | "hardware-user"
  | "software-user"
  | "hardware-committer"
  | "software-committer"
  | "admin";

export type PermissionKey =
  | "parameter:view"
  | "parameter:edit"
  | "debugging:use"
  | "logs:upload"
  | "parameter:review"
  | "admin:access"
  | "users:manage";

export type RoleCapability = "view" | "edit" | "publish" | "manage-permissions";

export type PlatformRole = {
  id: PlatformRoleId;
  name: "Guest" | "Hardware User" | "Software User" | "Hardware Committer" | "Software Committer" | "Admin";
  description: string;
  discipline?: RoleDiscipline;
  level: "guest" | "user" | "committer" | "admin";
  permissions: readonly PermissionKey[];
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

export const platformRoles = [
  {
    id: "guest",
    name: "Guest",
    description: "Can view parameter pages only.",
    level: "guest",
    permissions: ["parameter:view"]
  },
  {
    id: "hardware-user",
    name: "Hardware User",
    description: "Hardware-side user who can submit parameter changes and operate analysis/debugging tools.",
    discipline: "hardware",
    level: "user",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]
  },
  {
    id: "software-user",
    name: "Software User",
    description: "Software-side user who can perform Hardware User actions and close merged parameter rounds.",
    discipline: "software",
    level: "user",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload"]
  },
  {
    id: "hardware-committer",
    name: "Hardware Committer",
    description: "Can perform Hardware User actions and review hardware-side parameter submissions.",
    discipline: "hardware",
    level: "committer",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]
  },
  {
    id: "software-committer",
    name: "Software Committer",
    description: "Can perform Hardware User actions and review software-side parameter submissions.",
    discipline: "software",
    level: "committer",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review"]
  },
  {
    id: "admin",
    name: "Admin",
    description: "Can perform all User and Committer actions and access application admin pages and user management.",
    level: "admin",
    permissions: ["parameter:view", "parameter:edit", "debugging:use", "logs:upload", "parameter:review", "admin:access", "users:manage"]
  }
] as const satisfies readonly PlatformRole[];

const roleRank: Record<PlatformRoleId, number> = {
  guest: 0,
  "hardware-user": 1,
  "software-user": 1,
  "hardware-committer": 2,
  "software-committer": 2,
  admin: 3
};

export function isPlatformRoleId(value: string): value is PlatformRoleId {
  return (
    value === "guest" ||
    value === "hardware-user" ||
    value === "software-user" ||
    value === "hardware-committer" ||
    value === "software-committer" ||
    value === "admin"
  );
}

export function migrateLegacyRoleId(roleId: string): PlatformRoleId {
  if (isPlatformRoleId(roleId)) {
    return roleId;
  }

  switch (roleId) {
    case "hardware":
      return "hardware-user";
    case "project":
      return "software-user";
    case "user":
      return "hardware-user";
    case "committer":
      return "hardware-committer";
    case "parameter-admin":
      return "software-committer";
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

export function getRolesByDiscipline(discipline: RoleDiscipline): PlatformRole[] {
  return platformRoles.filter((role) => "discipline" in role && role.discipline === discipline);
}

export function roleIncludesRole(roleId: string, includedRoleId: string): boolean {
  const role = migrateLegacyRoleId(roleId);
  const includedRole = migrateLegacyRoleId(includedRoleId);

  if (role === includedRole || role === "admin") {
    return true;
  }

  if (includedRole === "hardware-user") {
    return role === "software-user" || role === "hardware-committer" || role === "software-committer";
  }

  return false;
}

export type WorkflowRoleSlot = "hardwareCommitter" | "softwareCommitter" | "softwareUser";

export function roleSupportsWorkflowSlot(roleId: string, slot: WorkflowRoleSlot): boolean {
  const role = getPlatformRole(roleId);

  if (role.id === "admin") {
    return true;
  }

  if (slot === "hardwareCommitter") {
    return role.discipline === "hardware" && role.level === "committer";
  }

  if (slot === "softwareCommitter") {
    return role.discipline === "software" && role.level === "committer";
  }

  return role.discipline === "software" && (role.level === "user" || role.level === "committer");
}

export function roleCanBeAssignedToWorkflowSlot(roleId: string, slot: WorkflowRoleSlot): boolean {
  const role = getPlatformRole(roleId);

  if (role.id === "admin") {
    return false;
  }

  return roleSupportsWorkflowSlot(role.id, slot);
}
