export type OrganizationAdminArea = "profile" | "members" | "invitations" | "teams" | "bridges" | "integrations" | "projects" | "handovers";

export const ORGANIZATION_ADMIN_PATH = "/organization";
export const ORGANIZATION_ADMIN_MEMBERS_PATH = "/organization/members";
export const ORGANIZATION_ADMIN_BRIDGES_PATH = "/organization/bridges";
export const ORGANIZATION_ADMIN_INTEGRATIONS_PATH = "/organization/integrations";
export const ORGANIZATION_ADMIN_PROJECTS_PATH = "/organization/projects";
export const ORGANIZATION_ADMIN_LEGACY_PATH = "/user-permissions";

export const ORGANIZATION_ADMIN_UI = {
  scopeNavAria: "组织管理范围",
  profileScope: "组织信息",
  membersScope: "成员与权限",
  teamsScope: "团队",
  teamsSubtitle: "管理扁平团队和成员分组",
  bridgesScope: "设备代理",
  integrationsScope: "集成凭据",
  projectsScope: "项目参与",
  projectsSubtitle: "查看项目参与名单与编辑角色",
  integrationsSubtitle: "管理组织机器凭据与技能绑定",
  bridgesSubtitle: "盘点组织成员的 Bridge 并撤销失效配对",
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
  if (path === "/organization/handovers" || path.startsWith("/organization/handovers/")) return "handovers";
  if (path === "/organization/invitations") return "invitations";
  if (path === ORGANIZATION_ADMIN_PROJECTS_PATH || path.startsWith(`${ORGANIZATION_ADMIN_PROJECTS_PATH}/`)) return "projects";
  if (path === "/organization/teams" || path.startsWith("/organization/teams/")) return "teams";
  if (path === ORGANIZATION_ADMIN_INTEGRATIONS_PATH || path.startsWith(`${ORGANIZATION_ADMIN_INTEGRATIONS_PATH}/`)) return "integrations";
  if (path === ORGANIZATION_ADMIN_BRIDGES_PATH || path.startsWith(`${ORGANIZATION_ADMIN_BRIDGES_PATH}/`)) return "bridges";
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
  if (area === "handovers") return "/organization/handovers";
  if (area === "invitations") return "/organization/invitations";
  if (area === "projects") return ORGANIZATION_ADMIN_PROJECTS_PATH;
  if (area === "teams") return "/organization/teams";
  if (area === "integrations") return ORGANIZATION_ADMIN_INTEGRATIONS_PATH;
  if (area === "bridges") return ORGANIZATION_ADMIN_BRIDGES_PATH;
  return area === "members" ? ORGANIZATION_ADMIN_MEMBERS_PATH : ORGANIZATION_ADMIN_PATH;
}
