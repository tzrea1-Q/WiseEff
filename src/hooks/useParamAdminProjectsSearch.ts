import { useCallback, useEffect, useState } from "react";
import {
  formatCsvQueryParam,
  parseCsvQueryParam
} from "@/application/parameters/parameterAdminUrl";

export type ParamAdminProjectsSearch = {
  q: string;
  /** Empty = all statuses. */
  statuses: string[];
  sort: string;
};

const defaultSearch: ParamAdminProjectsSearch = {
  q: "",
  statuses: [],
  sort: "name-asc"
};

function parseFromLocation(): ParamAdminProjectsSearch {
  const params = new URL(window.location.href).searchParams;
  return {
    q: params.get("q") ?? "",
    statuses: parseCsvQueryParam(params.get("status")),
    sort: params.get("sort") ?? "name-asc"
  };
}

function applyToLocation(search: ParamAdminProjectsSearch) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const setOrDelete = (key: string, value: string | null | undefined, omitValue?: string) => {
    if (!value || value === omitValue) {
      params.delete(key);
      return;
    }
    params.set(key, value);
  };

  setOrDelete("q", search.q.trim() || null);
  setOrDelete("status", formatCsvQueryParam(search.statuses));
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
  const status = formatCsvQueryParam(merged.statuses);
  if (status) params.set("status", status);
  if (merged.sort !== "name-asc") params.set("sort", merged.sort);
  const query = params.toString();
  return `/parameter-admin/projects${query ? `?${query}` : ""}`;
}
