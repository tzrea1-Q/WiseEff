import { PARAMETER_ADMIN_UI } from "./parameterAdminUiCopy";

export type ParameterAdminOrganizationView =
  | "specs"
  | "spec-review"
  | "modules"
  | "identity-mapping";

/** Nested peer under `/parameter-admin/modules` — tree is default; queue is optional. */
export type ParameterAdminModulesSubView = "tree" | "queue";

export const PARAMETER_ADMIN_ORGANIZATION_VIEWS: readonly ParameterAdminOrganizationView[] = [
  "specs",
  "spec-review",
  "modules",
  "identity-mapping"
] as const;

export const PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS: Record<
  ParameterAdminOrganizationView,
  string
> = {
  specs: PARAMETER_ADMIN_UI.specLibrary,
  "spec-review": PARAMETER_ADMIN_UI.specReview,
  modules: PARAMETER_ADMIN_UI.moduleMapping,
  "identity-mapping": PARAMETER_ADMIN_UI.identityMapping
};

/**
 * Parse organization-scoped admin sub-routes under `/parameter-admin`.
 * Exact `/parameter-admin` returns null (caller redirects to `/specs`).
 * `/parameter-admin/modules` and `/parameter-admin/modules/queue` both map to `modules`.
 */
export function parseParameterAdminOrganizationPath(
  pathname: string
): ParameterAdminOrganizationView | null {
  const ORG_ADMIN_PATH =
    /^\/parameter-admin\/(specs|spec-review|modules|identity-mapping)(?:\/(queue|registry))?\/?$/;
  const match = pathname.match(ORG_ADMIN_PATH);
  if (!match?.[1]) {
    return null;
  }
  return match[1] as ParameterAdminOrganizationView;
}

export function parseParameterAdminModulesSubView(
  pathname: string
): ParameterAdminModulesSubView | null {
  if (/^\/parameter-admin\/modules\/?$/.test(pathname)) {
    return "tree";
  }
  if (/^\/parameter-admin\/modules\/queue\/?$/.test(pathname)) {
    return "queue";
  }
  // Legacy /modules/registry bookmarks: organization path still resolves to modules;
  // callers redirect to tree. Treat as tree so subtitle/nav do not blank.
  if (/^\/parameter-admin\/modules\/registry\/?$/.test(pathname)) {
    return "tree";
  }
  return null;
}

export function buildParameterAdminOrganizationPath(
  view: ParameterAdminOrganizationView,
  search = ""
): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return `/parameter-admin/${view}${raw ? `?${raw}` : ""}`;
}

export function buildParameterAdminModulesPath(
  subView: ParameterAdminModulesSubView = "tree",
  search = ""
): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const base = subView === "queue" ? "/parameter-admin/modules/queue" : "/parameter-admin/modules";
  return `${base}${raw ? `?${raw}` : ""}`;
}

export function isParameterAdminOrganizationEntryPath(pathname: string): boolean {
  return pathname === "/parameter-admin" || pathname === "/parameter-admin/";
}
