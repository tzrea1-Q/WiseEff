import { useCallback, useEffect, useState } from "react";
import type { DebugAdminSearch } from "@/debugAdminLibraryFilters";

function parseRisk(value: string | null): DebugAdminSearch["risk"] {
  return value === "high" || value === "medium" || value === "low" ? value : "all";
}

function parseCoverage(value: string | null): DebugAdminSearch["coverage"] {
  return value === "dual" ||
    value === "hdc-only" ||
    value === "adb-only" ||
    value === "missing-binding" ||
    value === "archived" ||
    value === "disabled"
    ? value
    : "all";
}

export function parseDebugAdminSearch(rawSearch: string): DebugAdminSearch {
  const params = new URL(rawSearch.startsWith("?") ? `http://local${rawSearch}` : `http://local/?${rawSearch}`).searchParams;
  const modules = params.get("module");

  return {
    q: params.get("q") ?? "",
    risk: parseRisk(params.get("risk")),
    modules: modules ? modules.split(",").filter(Boolean) : [],
    coverage: parseCoverage(params.get("coverage")),
    sort: params.get("sort") ?? "name-asc",
    id: params.get("id") ?? undefined
  };
}

function parseFromLocation(): DebugAdminSearch {
  return parseDebugAdminSearch(window.location.search);
}

function applyToLocation(search: DebugAdminSearch) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const setOrDelete = (key: string, value: string | undefined) => {
    if (!value || value === "all") {
      params.delete(key);
      return;
    }
    params.set(key, value);
  };

  setOrDelete("q", search.q);
  setOrDelete("risk", search.risk);
  if (search.modules.length > 0) {
    params.set("module", search.modules.join(","));
  } else {
    params.delete("module");
  }
  setOrDelete("coverage", search.coverage);
  if (search.sort === "name-asc") {
    params.delete("sort");
  } else {
    params.set("sort", search.sort);
  }
  setOrDelete("id", search.id);

  const query = params.toString();
  const next = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
  }
}

export function useDebugAdminSearch() {
  const [search, setSearch] = useState<DebugAdminSearch>(() => parseFromLocation());

  useEffect(() => {
    const syncFromHistory = () => setSearch(parseFromLocation());
    window.addEventListener("popstate", syncFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFromHistory);
    };
  }, []);

  const updateSearch = useCallback((patch: Partial<DebugAdminSearch>) => {
    setSearch((current) => {
      const next = { ...current, ...patch };
      applyToLocation(next);
      return next;
    });
  }, []);

  return { search, updateSearch };
}
