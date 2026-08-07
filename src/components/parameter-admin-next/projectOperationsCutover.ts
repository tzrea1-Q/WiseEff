/**
 * Canonical-route cutover for legacy project-operation views (#240).
 *
 * Legacy deep links (`files` | `config-sets` | `structure` | `conflicts`) redirect to
 * `/parameter-admin/projects/:projectId/configuration` with equivalent workbench context.
 * New navigation must only generate the canonical configuration route.
 */

export const LEGACY_PROJECT_OPERATION_VIEWS = [
  "files",
  "config-sets",
  "structure",
  "conflicts"
] as const;

export type LegacyProjectOperationView = (typeof LEGACY_PROJECT_OPERATION_VIEWS)[number];

/** @deprecated Prefer LegacyProjectOperationView; kept for import compatibility during cutover. */
export type ParameterAdminNextProjectView = LegacyProjectOperationView;

const PRESERVED_QUERY_KEYS = [
  "file",
  "node",
  "property",
  "configSet",
  "q",
  "version",
  "candidate",
  "baseline",
  "sourceMode"
] as const;

export function isLegacyProjectOperationView(
  view: string | null | undefined
): view is LegacyProjectOperationView {
  return (
    typeof view === "string" &&
    (LEGACY_PROJECT_OPERATION_VIEWS as readonly string[]).includes(view)
  );
}

function preserveUsefulQueryParams(existingSearch?: string): URLSearchParams {
  const incoming = new URLSearchParams(
    existingSearch?.startsWith("?") ? existingSearch.slice(1) : (existingSearch ?? "")
  );
  const next = new URLSearchParams();
  for (const key of PRESERVED_QUERY_KEYS) {
    const value = incoming.get(key);
    if (value) {
      next.set(key, value);
    }
  }
  return next;
}

/**
 * Maps a legacy project-operation view to the canonical configuration workbench path,
 * preserving focus-oriented query params when present.
 */
export function buildCanonicalConfigurationPath(
  projectId: string,
  legacyView: LegacyProjectOperationView,
  existingSearch?: string
): string {
  const params = preserveUsefulQueryParams(existingSearch);

  switch (legacyView) {
    case "files":
      params.set("inspector", "file");
      break;
    case "config-sets":
      params.set("inspector", "config-set");
      break;
    case "structure":
      if (!params.get("sourceMode")) {
        params.set("sourceMode", "working");
      }
      break;
    case "conflicts":
      params.set("tasks", "conflicts");
      break;
  }

  const query = params.toString();
  return `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration${
    query ? `?${query}` : ""
  }`;
}
