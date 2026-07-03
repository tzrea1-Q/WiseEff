import { useCallback, useEffect, useState } from "react";

export type ParamAdminProjectsSearch = {
  q: string;
  status: string;
  sort: string;
};

const defaultSearch: ParamAdminProjectsSearch = {
  q: "",
  status: "all",
  sort: "name-asc"
};

function parseFromLocation(): ParamAdminProjectsSearch {
  const params = new URL(window.location.href).searchParams;
  return {
    q: params.get("q") ?? "",
    status: params.get("status") ?? "all",
    sort: params.get("sort") ?? "name-asc"
  };
}

function applyToLocation(search: ParamAdminProjectsSearch) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const setOrDelete = (key: string, value: string | undefined, omitValue = "all") => {
    if (!value || value === omitValue) {
      params.delete(key);
      return;
    }
    params.set(key, value);
  };

  setOrDelete("q", search.q.trim() || undefined, "");
  setOrDelete("status", search.status);
  setOrDelete("sort", search.sort, "name-asc");

  const query = params.toString();
  const next = `/parameter-admin/projects${query ? `?${query}` : ""}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.pushState(null, "", next);
  }
}

export function useParamAdminProjectsSearch() {
  const [search, setSearch] = useState<ParamAdminProjectsSearch>(() => parseFromLocation());

  useEffect(() => {
    const syncFromHistory = () => setSearch(parseFromLocation());
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  const updateSearch = useCallback((patch: Partial<ParamAdminProjectsSearch>) => {
    setSearch((current) => {
      const next = { ...current, ...patch };
      applyToLocation(next);
      return next;
    });
  }, []);

  return { search, updateSearch };
}

export function buildParamAdminProjectsPath(search: Partial<ParamAdminProjectsSearch> = {}) {
  const merged = { ...defaultSearch, ...search };
  const params = new URLSearchParams();
  if (merged.q.trim()) params.set("q", merged.q.trim());
  if (merged.status !== "all") params.set("status", merged.status);
  if (merged.sort !== "name-asc") params.set("sort", merged.sort);
  const query = params.toString();
  return `/parameter-admin/projects${query ? `?${query}` : ""}`;
}
