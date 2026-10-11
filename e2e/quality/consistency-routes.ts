import type { ConsistencyCategory } from "./consistency-collector";

const catalogPaths = [
  "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/identity-mapping",
  "/parameter-admin/spec-review", "/parameter-admin/specs/identity-mapping", "/parameters/definitions"
];
export const viewSwitchStyleExpectations: Readonly<Record<string, readonly ("section" | "tabs" | "toggle")[]>> = {
  "/organization": ["section"],
  "/organization/members": ["section", "tabs"],
  "/parameter-home": ["toggle"],
  "/audit": ["toggle"],
  "/logs": ["tabs"],
  "/parameters": ["tabs"],
  "/debugging-admin": ["section"],
  "/debugging-admin/nodes": ["section"],
  "/node-debugging": ["tabs"],
  "/dts-reload": ["tabs"],
  "/parameter-admin": ["section"],
  "/parameter-admin/specs": ["section"],
  "/parameter-admin/specs/identity-mapping": ["section"],
  "/parameter-admin/modules": ["section"],
  "/parameter-admin/modules/queue": ["section"],
  "/parameter-admin/modules/registry": ["section"],
  "/parameter-admin/identity-mapping": ["section"],
  "/parameter-admin/spec-review": ["section"],
  "/parameter-admin/projects": ["section"],
  "/parameter-admin/projects/aurora/review-roles": ["section"],
  "/parameter-review": ["tabs"],
  "/parameter-submissions": ["tabs"],
  "/user-permissions": ["section", "tabs"]
};
export const viewSwitchStylePaths = Object.keys(viewSwitchStyleExpectations);
const applicablePaths: Omit<Record<ConsistencyCategory, readonly string[]>, "xiaozeLaunchers" | "xiaozeHints" | "stickyActionAreas" | "unmarkedCompactControls"> = {
  viewSwitches: [...viewSwitchStylePaths, "/log-admin"],
  viewSwitchSignatures: viewSwitchStylePaths,
  primaryActions: ["/dts-reload", "/knowledge", "/log-dashboard", "/log-admin", "/logs", "/node-debugging", "/organization/members", "/parameter-admin", "/parameter-admin/specs", "/user-permissions"],
  rowActions: [...catalogPaths, "/parameters"],
  tableScrollports: [...catalogPaths, "/parameters", "/node-debugging", "/audit", "/logs", "/user-permissions", "/organization/members",
    // /debugging-admin defaults to the DTS reload settings form, which renders no table.
    "/debugging-admin/nodes", "/feedback-admin", "/log-admin", "/dts-reload",
    "/parameter-admin/projects", "/parameter-admin/projects/aurora/review-roles"],
  moduleTreeLabels: [...catalogPaths, "/parameters", "/node-debugging", "/dts-reload"],
  filterControls: ["/audit", "/debugging-admin/nodes", "/dts-reload", "/feedback-admin", "/organization/members", "/parameter-home", "/user-permissions"],
  sortControls: [],
  paginationControls: catalogPaths
};
const otherPhaseTwoPaths = [
  "/log-admin", "/parameter-admin/projects/aurora", "/parameter-admin/projects/aurora/config-sets",
  "/parameter-admin/projects/aurora/configuration", "/parameter-admin/projects/aurora/conflicts",
  "/parameter-admin/projects/aurora/files", "/parameter-admin/projects/aurora/structure"
];

export const consistencyRoutes = [...new Set([...Object.values(applicablePaths).flat(), ...otherPhaseTwoPaths])]
  .map((path) => ({
    path,
    required: [
      "xiaozeLaunchers",
      ...(Object.keys(applicablePaths) as (keyof typeof applicablePaths)[]).filter((category) => applicablePaths[category].includes(path))
    ] satisfies ConsistencyCategory[]
  }));
