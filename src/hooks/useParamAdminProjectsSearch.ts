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
  page?: number;
};

const defaultSearch: ParamAdminProjectsSearch = {
  q: "",
  statuses: [],
  sort: "name-asc",
  page: 1
};

export function parseParamAdminProjectsSearch(search: string): ParamAdminProjectsSearch {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const page = Number(params.get("page"));
  return {
    q: params.get("q") ?? "",
    statuses: parseCsvQueryParam(params.get("status")),
    sort: params.get("sort") ?? "name-asc",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1
  };
}

function parseFromLocation(): ParamAdminProjectsSearch {
  return parseParamAdminProjectsSearch(window.location.search);
}

function applyToLocation(search: ParamAdminProjectsSearch) {
  const next = `${buildParamAdminProjectsPath(search)}${window.location.hash}`;
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
      const next = { ...current, ...patch, page: patch.page ?? 1 };
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
  const page = merged.page ?? 1;
  if (Number.isSafeInteger(page) && page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/parameter-admin/projects${query ? `?${query}` : ""}`;
}

/** Only restore the project list's supported filters; never follow an arbitrary return URL. */
export function resolveParamAdminProjectsReturnPath(search: string): string {
  const returnTo = new URLSearchParams(search).get("returnTo") ?? "";
  if (!returnTo.startsWith("/parameter-admin/projects?") && returnTo !== "/parameter-admin/projects") {
    return "/parameter-admin/projects";
  }
  const url = new URL(returnTo, "http://local");
  return url.pathname === "/parameter-admin/projects" && !url.hash
    ? buildParamAdminProjectsPath(parseParamAdminProjectsSearch(url.search))
    : "/parameter-admin/projects";
}

/** Restore only the shared usage list, never an arbitrary caller-supplied URL. */
export function resolveSharedDtsiUsageReturnPath(search: string): string | null {
  const returnTo=new URLSearchParams(search).get("returnTo")??"";
  if(!returnTo.startsWith("/parameter-admin/sources?"))return null;
  const url=new URL(returnTo,"http://local");
  if(url.pathname!=="/parameter-admin/sources"||url.hash||url.searchParams.get("view")!=="projects")return null;
  const allowed=new Set(["view","organization","usageQuery","usageStatus","usagePage"]),params=new URLSearchParams();
  for(const [key,value] of url.searchParams)if(allowed.has(key)&&!params.has(key))params.set(key,value);
  return `/parameter-admin/sources?${params}`;
}
