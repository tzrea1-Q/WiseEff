import { formatCsvQueryParam, parseCsvQueryParam } from "@/application/parameters/parameterAdminUrl";
import type { DebugConnectionProtocol } from "@/domain/debugging/types";

export type DebugNodeLibrarySearch = {
  q: string;
  protocol: "all" | DebugConnectionProtocol;
  modules: string[];
  sort: string;
  page?: number;
};

export function readDebugNodeCatalogSearch(search: string): DebugNodeLibrarySearch {
  const params = new URLSearchParams(search);
  const protocol = params.get("protocol");
  const sort = params.get("sort") ?? "name-asc";
  const page = Number(params.get("page") ?? 1);
  return {
    q: params.get("q") ?? "",
    protocol: protocol === "hdc" || protocol === "adb" ? protocol : "all",
    modules: parseCsvQueryParam(params.get("modules")),
    sort: /^(name|module|status)-(asc|desc)$/.test(sort) ? sort : "name-asc",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1
  };
}

export function writeDebugNodeCatalogSearch(search: string, value: DebugNodeLibrarySearch): string {
  const params = new URLSearchParams(search);
  for (const [key, next] of Object.entries({
    q: value.q || null,
    protocol: value.protocol === "all" ? null : value.protocol,
    modules: formatCsvQueryParam(value.modules),
    sort: value.sort === "name-asc" ? null : value.sort,
    page: value.page && value.page > 1 ? String(value.page) : null
  })) {
    if (next) params.set(key, next);
    else params.delete(key);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
