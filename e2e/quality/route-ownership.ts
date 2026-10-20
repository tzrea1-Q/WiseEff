const catalogRoutes = [
  "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/identity-mapping",
  "/parameter-admin/spec-review", "/parameter-admin/specs/identity-mapping",
  "/parameter-admin/modules", "/parameter-admin/modules/queue", "/parameter-admin/modules/registry",
  "/parameter-admin/projects", "/parameter-admin/projects/aurora",
  ...["configuration", "files", "config-sets", "structure", "conflicts", "review-roles"]
    .map((area) => `/parameter-admin/projects/aurora/${area}`),
];
const parameterRoutes = ["/parameters", "/parameters/definitions", "/parameter-comparison", "/parameter-review", "/parameter-submissions", "/parameter-home", ...catalogRoutes];

export const routeOwnership: Readonly<Record<string, readonly string[]>> = {
  "src/linear-template/": ["/"],
  "src/features/log-analysis/": ["/logs", "/log-admin"],
  "src/LogAdminPage.tsx": ["/log-admin"],
  "src/features/knowledge/": ["/knowledge", "/knowledge-admin", "/logs", "/dts-reload", ...parameterRoutes],
  "src/features/dts-reload/": ["/dts-reload"],
  "src/NodeDebuggingPage.tsx": ["/node-debugging"],
  "src/DebuggingPage.tsx": ["/debugging"],
  "src/DebuggingAdminPage.tsx": ["/debugging-admin", "/debugging-admin/nodes"],
  "src/OrganizationPage.tsx": ["/organization", "/organization/members", "/user-permissions"],
  "src/UserPermissionsPage.tsx": ["/organization", "/organization/members", "/user-permissions"],
  "src/AuditCenterPage.tsx": ["/audit"],
  "src/features/product-feedback/FeedbackAdminPage.tsx": ["/feedback-admin"],
  "src/ParametersPage.tsx": ["/parameters"],
  "src/features/parameter-home/": ["/parameter-home"],
  "src/features/parameter-review/": parameterRoutes,
  "src/ParameterAdminNextPage.tsx": catalogRoutes,
  "src/components/parameter-admin-next/": parameterRoutes,
  "src/components/project-configuration-workbench/": catalogRoutes,
  "src/features/parameter-catalog/": ["/parameters/definitions", ...catalogRoutes],
  "src/features/parameter-catalog-governance/": parameterRoutes,
  "src/components/parameter-compare/": parameterRoutes,
};

export const qualityRoutePaths = [...new Set(Object.values(routeOwnership).flat())].sort();
