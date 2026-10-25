export type OrganizationAdminArea = "overview" | "resources" | "profile" | "members" | "invitations" | "teams" | "bridges" | "integrations" | "projects" | "handovers";

export const ORGANIZATION_ADMIN_PATH = "/organization";
export const ORGANIZATION_ADMIN_MEMBERS_PATH = "/organization/members";
export const ORGANIZATION_ADMIN_BRIDGES_PATH = "/organization/bridges";
export const ORGANIZATION_ADMIN_INTEGRATIONS_PATH = "/organization/integrations";
export const ORGANIZATION_ADMIN_PROJECTS_PATH = "/organization/projects";
export const ORGANIZATION_ADMIN_LEGACY_PATH = "/user-permissions";

export const ORGANIZATION_ADMIN_UI = {
  scopeNavAria: "组织管理范围",
  overviewScope: "概览",
  resourcesScope: "资源",
  profileScope: "组织资料",
  overviewSubtitle: "查看组织状态、协作统计和待办",
  resourcesSubtitle: "访问组织资源和连接管理",
  membersScope: "成员与权限",
  teamsScope: "团队",
  teamsSubtitle: "维护团队与成员分组",
  bridgesScope: "设备代理",
  integrationsScope: "集成凭据",
  projectsScope: "项目参与",
  projectsSubtitle: "管理项目参与者与编辑角色",
  integrationsSubtitle: "管理组织机器凭据与技能绑定",
  bridgesSubtitle: "查看设备连接并管理配对",
  profileSubtitle: "查看组织信息并维护显示名称",
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
  if (path === ORGANIZATION_ADMIN_PATH || path === "/organization/overview") return "overview";
  if (path === "/organization/resources" || path.startsWith("/organization/resources/")) return "resources";
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
  if (area === "overview") return ORGANIZATION_ADMIN_PATH;
  if (area === "resources") return "/organization/resources";
  if (area === "handovers") return "/organization/handovers";
  if (area === "invitations") return "/organization/invitations";
  if (area === "projects") return ORGANIZATION_ADMIN_PROJECTS_PATH;
  if (area === "teams") return "/organization/teams";
  if (area === "integrations") return ORGANIZATION_ADMIN_INTEGRATIONS_PATH;
  if (area === "bridges") return ORGANIZATION_ADMIN_BRIDGES_PATH;
  return area === "members" ? ORGANIZATION_ADMIN_MEMBERS_PATH : "/organization/settings";
}
