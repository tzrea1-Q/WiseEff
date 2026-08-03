import { PARAMETER_ADMIN_UI } from "./parameterAdminUiCopy";

/** Organization-scoped peer areas under `/parameter-admin` (ADR-0015). */
export type ParameterAdminOrganizationView = "specs" | "modules";

/** Nested peer under `/parameter-admin/specs` — library is default; identity mapping is optional. */
export type ParameterAdminSpecsSubView = "library" | "identity-mapping";

/** Nested peer under `/parameter-admin/modules` — tree is default; queue is optional. */
export type ParameterAdminModulesSubView = "tree" | "queue";

export const PARAMETER_ADMIN_ORGANIZATION_VIEWS: readonly ParameterAdminOrganizationView[] = [
  "specs",
  "modules"
] as const;

export const PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS: Record<
  ParameterAdminOrganizationView,
  string
> = {
  specs: PARAMETER_ADMIN_UI.specDefinitionManagement,
  modules: PARAMETER_ADMIN_UI.moduleManagement
};

/**
 * Parse organization-scoped admin sub-routes under `/parameter-admin`.
 * Exact `/parameter-admin` returns null (caller redirects to `/specs`).
 * `/parameter-admin/specs` and `/parameter-admin/specs/identity-mapping` both map to `specs`.
 * `/parameter-admin/modules` and `/parameter-admin/modules/queue` both map to `modules`.
 * Legacy `/spec-review` and `/identity-mapping` return null — callers redirect via
 * `resolveParameterAdminOrganizationRedirect`.
 */
export function parseParameterAdminOrganizationPath(
  pathname: string
): ParameterAdminOrganizationView | null {
  const match = pathname.match(/^\/parameter-admin\/(specs|modules)(?:\/([a-z-]+))?\/?$/);
  if (!match?.[1]) {
    return null;
  }
  const view = match[1] as ParameterAdminOrganizationView;
  const nested = match[2];
  if (view === "specs") {
    if (nested && nested !== "identity-mapping") {
      return null;
    }
    return "specs";
  }
  if (nested && nested !== "queue" && nested !== "registry") {
    return null;
  }
  return "modules";
}

export function parseParameterAdminSpecsSubView(
  pathname: string
): ParameterAdminSpecsSubView | null {
  if (/^\/parameter-admin\/specs\/?$/.test(pathname)) {
    return "library";
  }
  if (/^\/parameter-admin\/specs\/identity-mapping\/?$/.test(pathname)) {
    return "identity-mapping";
  }
  return null;
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

export function buildParameterAdminSpecsPath(
  subView: ParameterAdminSpecsSubView = "library",
  search = ""
): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const base =
    subView === "identity-mapping"
      ? "/parameter-admin/specs/identity-mapping"
      : "/parameter-admin/specs";
  return `${base}${raw ? `?${raw}` : ""}`;
}

export function buildParameterAdminModulesPath(
  subView: ParameterAdminModulesSubView = "tree",
  search = ""
): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const base = subView === "queue" ? "/parameter-admin/modules/queue" : "/parameter-admin/modules";
  return `${base}${raw ? `?${raw}` : ""}`;
}

/**
 * Permanent redirects for retired organization peer routes (ADR-0015).
 * Preserves the query string. Returns null when no redirect is needed.
 */
export function resolveParameterAdminOrganizationRedirect(
  pathname: string,
  search = ""
): string | null {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const qs = raw ? `?${raw}` : "";
  if (/^\/parameter-admin\/spec-review\/?$/.test(pathname)) {
    return `/parameter-admin/specs${qs}`;
  }
  if (/^\/parameter-admin\/identity-mapping\/?$/.test(pathname)) {
    return `/parameter-admin/specs/identity-mapping${qs}`;
  }
  return null;
}

export function isParameterAdminOrganizationEntryPath(pathname: string): boolean {
  return pathname === "/parameter-admin" || pathname === "/parameter-admin/";
}
