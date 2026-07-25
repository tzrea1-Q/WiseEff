import type { ParameterSpecLibraryFilters } from "@/components/parameter-topology/ParameterSpecLibrary";

export type ParameterAdminUrlState = {
  q: string;
  lifecycle: string;
  driverModule: string;
  compatible: string;
  businessCategory: string;
  schemaSource: string;
  sort: string;
  specId: string | null;
};

const DEFAULT_SORT = "propertyKey-asc";

export const EMPTY_PARAMETER_ADMIN_FILTERS: ParameterSpecLibraryFilters = {
  q: "",
  driverModule: "all",
  compatible: "all",
  businessCategory: "all",
  schemaSource: "all",
  lifecycle: "all"
};

export function parseParameterAdminUrl(search: string): ParameterAdminUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    q: params.get("q") ?? "",
    lifecycle: params.get("lifecycle") ?? "all",
    driverModule: params.get("driver") ?? "all",
    compatible: params.get("compatible") ?? "all",
    businessCategory: params.get("category") ?? "all",
    schemaSource: params.get("schema") ?? "all",
    sort: params.get("sort") ?? DEFAULT_SORT,
    specId: params.get("spec")
  };
}

export function toParameterAdminFilters(url: ParameterAdminUrlState): ParameterSpecLibraryFilters {
  return {
    q: url.q,
    lifecycle: url.lifecycle,
    driverModule: url.driverModule,
    compatible: url.compatible,
    businessCategory: url.businessCategory,
    schemaSource: url.schemaSource
  };
}

export function buildParameterAdminSearch(patch: Partial<ParameterAdminUrlState>, current: ParameterAdminUrlState): string {
  const next: ParameterAdminUrlState = { ...current, ...patch };
  const params = new URLSearchParams();
  const setOrDelete = (key: string, value: string | null | undefined, emptyValues: string[] = ["", "all"]) => {
    if (!value || emptyValues.includes(value)) {
      return;
    }
    params.set(key, value);
  };

  setOrDelete("q", next.q);
  setOrDelete("lifecycle", next.lifecycle);
  setOrDelete("driver", next.driverModule);
  setOrDelete("compatible", next.compatible);
  setOrDelete("category", next.businessCategory);
  setOrDelete("schema", next.schemaSource);
  if (next.sort && next.sort !== DEFAULT_SORT) {
    params.set("sort", next.sort);
  }
  setOrDelete("spec", next.specId, [""]);

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
