import { useCallback, useMemo } from "react";
import type { AuditAppGroupId } from "@/domain/audit/auditApps";
import type { AuditQueryState } from "@/hooks/useAuditEvents";
import type { RiskLevel } from "@/mockData";

const defaultState: AuditQueryState = {
  appGroup: "all",
  severity: "all",
  search: ""
};

export function parseAuditSearch(search: string, defaults: Partial<AuditQueryState> = {}): AuditQueryState {
  const params = new URLSearchParams(search);
  const appGroup = (params.get("app") ?? defaults.appGroup ?? defaultState.appGroup) as AuditAppGroupId;
  const severity = (params.get("severity") ?? defaults.severity ?? defaultState.severity) as RiskLevel | "all";
  const projectId = params.get("projectId") ?? defaults.projectId;
  const traceId = params.get("traceId") ?? defaults.traceId;
  const querySearch = params.get("q") ?? defaults.search ?? "";

  return {
    appGroup,
    severity,
    search: querySearch,
    ...(projectId ? { projectId } : {}),
    ...(traceId ? { traceId } : {})
  };
}

export function buildAuditSearch(state: AuditQueryState) {
  const params = new URLSearchParams();
  if (state.appGroup !== "all") {
    params.set("app", state.appGroup);
  }
  if (state.severity !== "all") {
    params.set("severity", state.severity);
  }
  if (state.search.trim()) {
    params.set("q", state.search.trim());
  }
  if (state.projectId) {
    params.set("projectId", state.projectId);
  }
  if (state.traceId) {
    params.set("traceId", state.traceId);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useAuditSearch(search: string, onNavigate: (path: string) => void, basePath = "/audit") {
  const queryState = useMemo(() => parseAuditSearch(search), [search]);

  const updateQuery = useCallback(
    (patch: Partial<AuditQueryState>) => {
      const next = { ...queryState, ...patch };
      onNavigate(`${basePath}${buildAuditSearch(next)}`);
    },
    [basePath, onNavigate, queryState]
  );

  return { queryState, updateQuery };
}
