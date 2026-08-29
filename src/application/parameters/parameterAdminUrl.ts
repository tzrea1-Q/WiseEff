import type { ParameterSpecLibraryFilters } from "@/components/parameter-topology/ParameterSpecLibrary";

export type ParameterAdminUrlState = {
  catalogView: "effective" | "governance";
  q: string;
  lifecycles: string[];
  driverModules: string[];
  compatibles: string[];
  schemaSources: string[];
  moduleNames: string[];
  moduleNodeId: string | null;
  sort: string;
  specId: string | null;
};

const DEFAULT_SORT = "propertyKey-asc";

export const EMPTY_PARAMETER_ADMIN_FILTERS: ParameterSpecLibraryFilters = {
  q: "",
  driverModules: [],
  compatibles: [],
  schemaSources: [],
  lifecycles: [],
  moduleNames: []
};

/** Parse comma-separated query values; treat missing/"all" as inactive []. */
export function parseCsvQueryParam(raw: string | null): string[] {
  if (!raw || raw === "all") return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );
}

export function formatCsvQueryParam(values: readonly string[]): string | null {
  const cleaned = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return cleaned.length > 0 ? cleaned.join(",") : null;
}

export function parseParameterAdminUrl(search: string): ParameterAdminUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    catalogView:
      params.get("catalogView") === "governance"
        ? "governance"
        : "effective",
    q: params.get("q") ?? "",
    lifecycles: parseCsvQueryParam(params.get("lifecycle")),
    driverModules: parseCsvQueryParam(params.get("driver")),
    compatibles: parseCsvQueryParam(params.get("compatible")),
    schemaSources: parseCsvQueryParam(params.get("schema")),
    moduleNames: parseCsvQueryParam(params.get("module")),
    moduleNodeId: params.get("moduleNode"),
    sort: params.get("sort") ?? DEFAULT_SORT,
    specId: params.get("spec")
  };
}

export function toParameterAdminFilters(url: ParameterAdminUrlState): ParameterSpecLibraryFilters {
  return {
    q: url.q,
    lifecycles: url.lifecycles,
    driverModules: url.driverModules,
    compatibles: url.compatibles,
    schemaSources: url.schemaSources,
    moduleNames: url.moduleNames
  };
}

export function buildParameterAdminSearch(patch: Partial<ParameterAdminUrlState>, current: ParameterAdminUrlState): string {
  const next: ParameterAdminUrlState = { ...current, ...patch };
  const params = new URLSearchParams();
  const setOrDelete = (key: string, value: string | null | undefined) => {
    if (!value) return;
    params.set(key, value);
  };

  if (next.catalogView === "governance") {
    params.set("catalogView", "governance");
  }
  setOrDelete("q", next.q.trim() || null);
  setOrDelete("lifecycle", formatCsvQueryParam(next.lifecycles));
  setOrDelete("driver", formatCsvQueryParam(next.driverModules));
  setOrDelete("compatible", formatCsvQueryParam(next.compatibles));
  setOrDelete("schema", formatCsvQueryParam(next.schemaSources));
  setOrDelete("module", formatCsvQueryParam(next.moduleNames));
  setOrDelete("moduleNode", next.moduleNodeId);
  if (next.sort && next.sort !== DEFAULT_SORT) {
    params.set("sort", next.sort);
  }
  setOrDelete("spec", next.specId);

  return params.toString();
}

export function applyParameterAdminSearchToLocation(search: string, pathname = window.location.pathname) {
  const next = `${pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
  }
}

export function sortParameterSpecRows<T extends { propertyKey: string; driverModule: string | null; reviewState: string }>(
  rows: readonly T[],
  sort: string
): T[] {
  const copy = [...rows];
  switch (sort) {
    case "propertyKey-desc":
      return copy.sort((a, b) => b.propertyKey.localeCompare(a.propertyKey));
    case "driverModule-asc":
      return copy.sort((a, b) => (a.driverModule ?? "").localeCompare(b.driverModule ?? ""));
    case "lifecycle-asc":
      return copy.sort((a, b) => a.reviewState.localeCompare(b.reviewState));
    case "propertyKey-asc":
    default:
      return copy.sort((a, b) => a.propertyKey.localeCompare(b.propertyKey));
  }
}
