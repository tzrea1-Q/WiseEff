export const compactQualityRoutes = [
  { path: "/parameter-admin", template: "NavigatorWorkbench", heading: "项目参数管理后台" },
  { path: "/parameter-admin/specs", template: "NavigatorWorkbench", heading: "项目参数管理后台" },
  { path: "/parameter-admin/modules", template: "NavigatorWorkbench", heading: "项目参数管理后台" },
  { path: "/parameter-admin/specs/identity-mapping", template: "NavigatorWorkbench", heading: "项目参数管理后台" },
  { path: "/parameter-home", template: "OverviewPage", heading: "我的工作台", headingScope: ".topbar-title" },
  { path: "/parameter-admin/projects", template: "AdminListPage", heading: "项目参数管理后台" },
  { path: "/organization", template: "SettingsFormPage", heading: "组织管理", headingScope: ".topbar-title" },
  { path: "/parameter-review", template: "ReviewInbox", heading: "参数管理员工作台" },
  { path: "/debugging", template: "RetiredNotice", heading: "页面暂时不可用" }
] as const;
