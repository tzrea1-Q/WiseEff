import { useCallback, useMemo } from "react";
import { auditAppGroups, type AuditAppGroupId } from "@/domain/audit/auditApps";
import type { AuditQueryState, AuditTimeWindow } from "@/hooks/useAuditEvents";
import { AUDIT_SEVERITIES } from "@/domain/audit/types";

const defaultState: AuditQueryState = {
  appGroup: "all",
  severity: "all",
  search: "",
  timeWindow: "all"
};

export function parseAuditSearch(search: string, defaults: Partial<AuditQueryState> = {}): AuditQueryState {
  const params = new URLSearchParams(search);
  const requestedApp = params.get("app") ?? defaults.appGroup ?? defaultState.appGroup;
  const app = requestedApp === "parameters" ? "parameter" : requestedApp;
  const appGroup = (auditAppGroups.some((group) => group.id === app) ? app : "all") as AuditAppGroupId;
  const requestedSeverity = params.get("severity") ?? defaults.severity ?? defaultState.severity;
  const requestedSeverities = Array.isArray(requestedSeverity) ? requestedSeverity : requestedSeverity.split(",");
  const selected = AUDIT_SEVERITIES.filter((value) => requestedSeverities.includes(value));
  const severity = selected.length > 1 ? selected : selected[0] ?? "all";
  const projectId = params.get("projectId") ?? defaults.projectId;
  const traceId = params.get("traceId") ?? defaults.traceId;
  const querySearch = params.get("q") ?? defaults.search ?? "";
  const timeWindowParam = params.get("tw") ?? defaults.timeWindow ?? defaultState.timeWindow;
  const timeWindow = (["all", "today", "7d", "30d", "custom"] as const).includes(timeWindowParam as AuditTimeWindow)
    ? (timeWindowParam as AuditTimeWindow)
    : defaultState.timeWindow;

  return {
    appGroup,
    severity,
    search: querySearch.slice(0, 200),
    timeWindow,
    ...(projectId ? { projectId } : {}),
    ...(traceId ? { traceId } : {}),
    ...Object.fromEntries(["organizationId", "eventId", "kind", "targetId", "from", "to"].flatMap((key) => {
      const value = params.get(key) ?? defaults[key as keyof AuditQueryState];
      return typeof value === "string" && value ? [[key, value]] : [];
    }))
  };
}

export function buildAuditSearch(state: AuditQueryState) {
  const params = new URLSearchParams();
  if (state.appGroup !== "all") {
    params.set("app", state.appGroup);
  }
  if (state.severity !== "all") {
    params.set("severity", Array.isArray(state.severity) ? state.severity.join(",") : state.severity);
  }
  if (state.search.trim()) {
    params.set("q", state.search.trim());
  }
  if (state.timeWindow && state.timeWindow !== "all") {
    params.set("tw", state.timeWindow);
  }
  if (state.projectId) {
    params.set("projectId", state.projectId);
  }
  if (state.traceId) {
    params.set("traceId", state.traceId);
  }
  for (const key of ["organizationId", "eventId", "kind", "targetId", "from", "to"] as const) {
    if (state[key]) params.set(key, state[key]);
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
