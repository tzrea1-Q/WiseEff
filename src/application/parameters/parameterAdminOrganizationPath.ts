import { PARAMETER_ADMIN_UI } from "./parameterAdminUiCopy";

export type ParameterAdminOrganizationView =
  | "specs"
  | "spec-review"
  | "modules"
  | "identity-mapping";

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
 */
export function parseParameterAdminOrganizationPath(
  pathname: string
): ParameterAdminOrganizationView | null {
  const match = pathname.match(
    /^\/parameter-admin\/(specs|spec-review|modules|identity-mapping)\/?$/
  );
  if (!match?.[1]) {
    return null;
  }
  return match[1] as ParameterAdminOrganizationView;
}

export function buildParameterAdminOrganizationPath(
  view: ParameterAdminOrganizationView,
  search = ""
): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return `/parameter-admin/${view}${raw ? `?${raw}` : ""}`;
}

export function isParameterAdminOrganizationEntryPath(pathname: string): boolean {
  return pathname === "/parameter-admin" || pathname === "/parameter-admin/";
}
