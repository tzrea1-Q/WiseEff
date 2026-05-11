import { useCallback, useEffect, useState } from "react";

export type ParamAdminSearch = {
  q: string;
  risk: "all" | "high" | "medium" | "low";
  modules: string[];
  coverage: "all" | "full" | "partial" | "orphan";
  sort: "updatedAt-desc" | "name-asc" | "risk-desc" | "module-asc" | string;
  id?: string;
  audit?: "open";
  import?: "step1" | "step2" | "step3";
  permissions?: "open";
};

function parseRisk(value: string | null): ParamAdminSearch["risk"] {
  return value === "high" || value === "medium" || value === "low" ? value : "all";
}

function parseCoverage(value: string | null): ParamAdminSearch["coverage"] {
  return value === "full" || value === "partial" || value === "orphan" ? value : "all";
}

function parseImport(value: string | null): ParamAdminSearch["import"] {
  return value === "step1" || value === "step2" || value === "step3" ? value : undefined;
}

function parseFromLocation(): ParamAdminSearch {
  const params = new URL(window.location.href).searchParams;
  const modules = params.get("module");

  return {
    q: params.get("q") ?? "",
    risk: parseRisk(params.get("risk")),
    modules: modules ? modules.split(",").filter(Boolean) : [],
    coverage: parseCoverage(params.get("coverage")),
    sort: params.get("sort") ?? "updatedAt-desc",
    id: params.get("id") ?? undefined,
    audit: params.get("audit") === "open" ? "open" : undefined,
    import: parseImport(params.get("import")),
    permissions: params.get("permissions") === "open" ? "open" : undefined
  };
}

function applyToLocation(search: ParamAdminSearch) {
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
  if (search.sort === "updatedAt-desc") {
    params.delete("sort");
  } else {
    params.set("sort", search.sort);
  }
  setOrDelete("id", search.id);
  setOrDelete("audit", search.audit);
  setOrDelete("import", search.import);
  setOrDelete("permissions", search.permissions);

  const query = params.toString();
  const next = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
  }
}

export function useParamAdminSearch() {
  const [search, setSearch] = useState<ParamAdminSearch>(() => parseFromLocation());

  useEffect(() => {
    const syncFromHistory = () => setSearch(parseFromLocation());
    window.addEventListener("popstate", syncFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFromHistory);
    };
  }, []);

  const updateSearch = useCallback((patch: Partial<ParamAdminSearch>) => {
    setSearch((current) => {
      const next = { ...current, ...patch };
      applyToLocation(next);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    updateSearch({
      q: "",
      risk: "all",
      modules: [],
      coverage: "all",
      sort: "updatedAt-desc"
    });
  }, [updateSearch]);

  return { search, updateSearch, clearFilters };
}
