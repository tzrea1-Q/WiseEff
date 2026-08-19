export type OrganizationAdminArea = "profile" | "members";

export const ORGANIZATION_ADMIN_PATH = "/organization";
export const ORGANIZATION_ADMIN_MEMBERS_PATH = "/organization/members";
export const ORGANIZATION_ADMIN_LEGACY_PATH = "/user-permissions";

export const ORGANIZATION_ADMIN_UI = {
  scopeNavAria: "组织管理范围",
  profileScope: "组织管理",
  membersScope: "人员管理",
  profileSubtitle: "维护本组织档案与显示名称",
  membersSubtitle: "维护成员、角色权限和注册申请",
  profileMainAria: "组织管理",
  membersMainAria: "人员管理"
} as const;

export function isOrganizationAdminPath(path: string) {
  return (
    path === ORGANIZATION_ADMIN_PATH ||
    path === ORGANIZATION_ADMIN_MEMBERS_PATH ||
    path === ORGANIZATION_ADMIN_LEGACY_PATH ||
    path.startsWith(`${ORGANIZATION_ADMIN_PATH}/`) ||
    path.startsWith(`${ORGANIZATION_ADMIN_LEGACY_PATH}/`)
  );
}

export function parseOrganizationAdminArea(path: string): OrganizationAdminArea | null {
  if (
    path === ORGANIZATION_ADMIN_MEMBERS_PATH ||
    path.startsWith(`${ORGANIZATION_ADMIN_MEMBERS_PATH}/`) ||
    path === ORGANIZATION_ADMIN_LEGACY_PATH ||
    path.startsWith(`${ORGANIZATION_ADMIN_LEGACY_PATH}/`)
  ) {
    return "members";
  }
  if (path === ORGANIZATION_ADMIN_PATH || path.startsWith(`${ORGANIZATION_ADMIN_PATH}/`)) {
    return "profile";
  }
  return null;
}

export function buildOrganizationAdminPath(area: OrganizationAdminArea) {
  return area === "members" ? ORGANIZATION_ADMIN_MEMBERS_PATH : ORGANIZATION_ADMIN_PATH;
}
