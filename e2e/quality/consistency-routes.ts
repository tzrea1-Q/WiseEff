import type { ConsistencyCategory } from "./consistency-collector";
import { parseParameterAdminModulesSubView } from "../../src/application/parameters/parameterAdminOrganizationPath";

const catalogPaths = [
  "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/identity-mapping",
  "/parameter-admin/spec-review", "/parameter-admin/specs/identity-mapping", "/parameters/definitions"
];
const projectConfigurationPaths = ["/configuration", "/files", "/config-sets", "/structure", "/conflicts"]
  .map((suffix) => `/parameter-admin/projects/aurora${suffix}`);
const moduleGovernancePaths = ["/parameter-admin/modules"];
const moduleListPaths = ["/parameter-admin/modules/queue", "/parameter-admin/modules/registry"];
const adminListPaths = ["/parameter-admin/projects", "/organization/members", "/user-permissions",
  "/debugging-admin/nodes", "/feedback-admin", "/audit", "/knowledge"];
export const collectionPaths = ["/knowledge-admin", "/log-admin"];
export const viewSwitchStyleExpectations: Readonly<Record<string, readonly ("section" | "tabs" | "toggle")[]>> = {
  "/knowledge-admin": ["tabs"],
  "/log-admin": ["tabs", "toggle"],
  "/log-admin?tab=domains": ["tabs"],
  "/log-admin?tab=quality": ["tabs"],
  ...Object.fromEntries(projectConfigurationPaths.map((path) => [path, ["tabs"] as const])),
  "/organization": ["section"],
  "/organization/members": ["section", "tabs"],
  "/parameter-home": ["toggle"],
  "/logs": ["tabs"],
  "/parameters": ["tabs"],
  "/debugging-admin": ["section"],
  "/debugging-admin/nodes": ["section"],
  "/node-debugging": ["tabs"],
  "/dts-reload": ["tabs"],
  "/parameter-admin": ["section"],
  "/parameter-admin/specs": ["section"],
  "/parameter-admin/specs/identity-mapping": ["section"],
  "/parameter-admin/modules": ["section", "tabs"],
  "/parameter-admin/modules/queue": ["section", "tabs"],
  "/parameter-admin/modules/registry": ["section", "tabs"],
  "/parameter-admin/identity-mapping": ["section"],
  "/parameter-admin/spec-review": ["section"],
  "/parameter-admin/projects": ["section"],
  "/parameter-admin/projects/aurora/review-roles": ["section"],
  "/parameter-review": ["tabs"],
  "/parameter-submissions": ["tabs"],
  "/user-permissions": ["section", "tabs"]
};
export const viewSwitchStylePaths = Object.keys(viewSwitchStyleExpectations);
const applicablePaths: Omit<Record<ConsistencyCategory, readonly string[]>, "xiaozeLaunchers" | "xiaozeHints" | "stickyActionAreas" | "unmarkedCompactControls" | "titles" | "buttons" | "typeScale" | "pageEdges" | "workbenchTables"> = {
  viewSwitches: viewSwitchStylePaths,
  viewSwitchSignatures: viewSwitchStylePaths,
  primaryActions: ["/dts-reload", "/knowledge", "/log-dashboard", "/log-admin", "/logs", "/node-debugging", "/organization/members", "/parameter-admin", "/parameter-admin/specs", "/user-permissions", "/parameter-admin/projects", "/parameter-comparison", "/debugging"],
  rowActions: [...catalogPaths, "/parameters", ...adminListPaths, ...projectConfigurationPaths],
  tableScrollports: [...catalogPaths, "/parameters", "/node-debugging", "/audit", "/logs", "/user-permissions", "/organization/members",
    // /debugging-admin defaults to the DTS reload settings form, which renders no table.
    "/debugging-admin/nodes", "/feedback-admin", ...collectionPaths, "/dts-reload",
    "/parameter-admin/projects", "/parameter-admin/projects/aurora/review-roles", "/knowledge", "/parameter-admin/modules/registry"],
  moduleTreeLabels: [...catalogPaths, ...moduleGovernancePaths, "/parameters", "/node-debugging", "/dts-reload"],
  filterControls: ["/audit", "/debugging-admin/nodes", "/dts-reload", "/feedback-admin", "/organization/members", "/parameter-home", "/user-permissions", "/parameter-admin/projects", ...moduleListPaths],
  sortControls: ["/parameter-admin/projects"],
  paginationControls: catalogPaths,
  navigatorWorkbenches: ["/parameters", "/logs", ...catalogPaths, "/node-debugging", "/dts-reload", ...moduleGovernancePaths, ...projectConfigurationPaths],
  adminLists: [...adminListPaths, ...collectionPaths],
  overviewPages: ["/parameter-home", "/log-dashboard"],
  retiredNotices: ["/parameter-comparison", "/debugging"],
  settingsForms: ["/organization", "/debugging-admin", "/parameter-admin/projects/aurora/review-roles"]
};
const otherPhaseTwoPaths = [
  "/knowledge-admin",
  "/log-admin", "/parameter-admin/projects/aurora", "/parameter-admin/projects/aurora/config-sets",
  "/parameter-admin/projects/aurora/configuration", "/parameter-admin/projects/aurora/conflicts",
  "/parameter-admin/projects/aurora/files", "/parameter-admin/projects/aurora/structure"
];

export const consistencyRoutes = [...new Set([...Object.values(applicablePaths).flat(), ...otherPhaseTwoPaths])]
  .map((path) => ({ path }))
  .flatMap((route) => [
    route,
    ...(route.path === "/knowledge-admin"
      ? ["drafts", "index", "archived"].map((tab) => ({ ...route, path: `${route.path}?tab=${tab}` })) : []),
    ...(route.path === "/log-admin"
      ? [{ ...route, path: `${route.path}?tab=records` }] : []),
    ...(projectConfigurationPaths.includes(route.path)
      ? ["history", "candidate", "unified-diff", "side-by-side"].map((mode) => ({ ...route, path: `${route.path}?sourceMode=${mode}` }))
      : []),
    ...(route.path === "/parameter-admin/projects/aurora/configuration"
      ? ["tab=structure", "tab=conflicts", "inspector=file"].map((query) => ({ ...route, path: `${route.path}?${query}` }))
      : []),
    ...(route.path === "/parameter-admin/modules"
      ? ["queue", "registry"].map((tab) => ({ ...route, path: `${route.path}?tab=${tab}` })) : []),
    ...(["/parameter-admin/spec-review", "/parameter-admin/specs", "/parameter-admin/identity-mapping", "/parameter-admin/specs/identity-mapping"].includes(route.path)
      ? [{ ...route, path: `${route.path}?review=open` }]
      : [])
  ])
  .map(({ path }) => {
    const [pathname, search = ""] = path.split("?");
    const moduleView = parseParameterAdminModulesSubView(pathname, search);
    const contractPath = moduleView && moduleView !== "tree" ? `/parameter-admin/modules/${moduleView}` : pathname;
    return {
      path,
      required: [
        "titles", "buttons", "typeScale", "pageEdges", "xiaozeLaunchers",
        ...(Object.keys(applicablePaths) as (keyof typeof applicablePaths)[]).filter((category) => applicablePaths[category].includes(path) || applicablePaths[category].includes(contractPath))
      ] satisfies ConsistencyCategory[]
    };
  });

const parameterRoute = consistencyRoutes.find((route) => route.path === "/parameters")!;
export const consistencyReadOnlyRoutes = [
  ...consistencyRoutes,
  ...["atlas", "aurora", "nebula"].map((project) => ({ ...parameterRoute, path: `/parameters?project=${project}` }))
];
