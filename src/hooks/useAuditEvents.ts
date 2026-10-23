import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchesAuditAppGroup, getAuditAppGroup, getAuditAppLabel, type AuditAppGroupId } from "@/domain/audit/auditApps";
import { mapApiAuditEventToView, mapMockAuditEventToView } from "@/domain/audit/mapAuditEventView";
import { presentAuditAction, presentAuditKind } from "@/domain/audit/auditSlugLabels";
import type { AuditEventView, AuditSeverity, ListAuditEventsParams } from "@/domain/audit/types";
import { createAuditClient } from "@/infrastructure/http/auditClient";
import { presentError } from "@/infrastructure/http/presentError";
import type { AuditEvent } from "@/domain/prototype/types";

export const AUDIT_EXPORT_MAX_ROWS = 2000;
export type AuditTimeWindow = "all" | "today" | "7d" | "30d" | "custom";
export type AuditQueryState = {
  organizationId?: string;
  appGroup: AuditAppGroupId;
  severity: AuditSeverity | "all" | AuditSeverity[];
  search: string;
  timeWindow: AuditTimeWindow;
  projectId?: string;
  traceId?: string;
  eventId?: string;
  kind?: string;
  targetId?: string;
  from?: string;
  to?: string;
};

export function auditTimeWindowFrom(window: AuditTimeWindow, now = new Date()): string | undefined {
  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  if (window === "7d" || window === "30d") {
    return new Date(now.getTime() - (window === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000).toISOString();
  }
  return undefined;
}

export type UseAuditEventsOptions = {
  isApiMode: boolean;
  mockEvents: AuditEvent[];
  query: AuditQueryState;
  limit?: number;
  enabled?: boolean;
};

function filterViews(events: AuditEventView[], query: AuditQueryState) {
  const from = query.timeWindow === "custom" ? query.from : auditTimeWindowFrom(query.timeWindow);
  const to = query.timeWindow === "custom" ? query.to : undefined;
  const search = query.search.trim().toLocaleLowerCase();
  return events.filter((event) => {
    if (!matchesAuditAppGroup(event.app, query.appGroup, "mock")) return false;
    if (Array.isArray(query.severity) ? !query.severity.includes(event.severity) : query.severity !== "all" && event.severity !== query.severity) return false;
    if (query.projectId && event.projectId !== query.projectId) return false;
    if (query.traceId && event.traceId !== query.traceId) return false;
    if (query.kind && event.kind !== query.kind) return false;
    if (query.targetId && event.targetId !== query.targetId) return false;
    if (from && event.createdAt && event.createdAt < from) return false;
    if (to && event.createdAt && event.createdAt > to) return false;
    return !search || [event.action, event.kind, event.actor, event.targetId, event.targetName,
      getAuditAppLabel(event.app), presentAuditAction(event.action).label, presentAuditKind(event.kind).label]
      .some((value) => value?.toLocaleLowerCase().includes(search));
  });
}

function buildApiParams(query: AuditQueryState, limit: number): ListAuditEventsParams {
  const group = getAuditAppGroup(query.appGroup);
  return {
    limit,
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    projectId: query.projectId,
    traceId: query.traceId,
    kind: query.kind,
    targetId: query.targetId,
    severity: query.severity === "all" || Array.isArray(query.severity) ? undefined : query.severity,
    severities: Array.isArray(query.severity) ? query.severity : undefined,
    q: query.search.trim() || undefined,
    from: query.timeWindow === "custom" ? query.from : auditTimeWindowFrom(query.timeWindow),
    to: query.timeWindow === "custom" ? query.to : undefined,
    ...(group.apiApps.length === 1 ? { app: group.apiApps[0] } : group.apiApps.length ? { apps: group.apiApps } : {})
  };
}

export function useAuditEvents({ isApiMode, mockEvents, query, limit = 20, enabled = true }: UseAuditEventsOptions) {
  const [apiEvents, setApiEvents] = useState<AuditEventView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string>();
  const generation = useRef(0);
  const morePending = useRef(false);
  const { appGroup, projectId, severity, timeWindow, traceId, search, from, to, kind, targetId, organizationId } = query;
  const params = useMemo(() => buildApiParams(
    { appGroup, projectId, severity, timeWindow, traceId, search, from, to, kind, targetId, organizationId }, limit
  ), [appGroup, projectId, severity, timeWindow, traceId, search, from, to, kind, targetId, organizationId, limit]);
  const activeParams = useRef(params);

  const reload = useCallback(async () => {
    const requestGeneration = ++generation.current;
    morePending.current = false;
    setLoadingMore(false);
    setLoading(false);
    setError("");
    setApiEvents([]);
    setNextCursor(null);
    if (!enabled || !isApiMode) return;
    setLoading(true);
    // Refresh relative windows now; keep this same boundary for pagination/export.
    const snapshot = { ...params, ...(timeWindow !== "custom" ? { from: auditTimeWindowFrom(timeWindow) } : {}) };
    activeParams.current = snapshot;
    try {
      const response = await createAuditClient().listAuditEvents(snapshot);
      if (requestGeneration !== generation.current) return;
      setApiEvents(response.items.map(mapApiAuditEventToView));
      setNextCursor(response.nextCursor);
      setUpdatedAt(new Date().toISOString());
    } catch (cause) {
      if (requestGeneration === generation.current) setError(presentError(cause, "加载审计记录失败，请重试。"));
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [enabled, isApiMode, params, timeWindow]);

  const invalidate = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    void reload();
    return invalidate;
  }, [reload, invalidate]);

  const loadMore = useCallback(async () => {
    if (!enabled || !isApiMode || !nextCursor || loading || morePending.current) return;
    const requestGeneration = generation.current;
    morePending.current = true;
    setLoadingMore(true);
    setError("");
    try {
      const response = await createAuditClient().listAuditEvents({ ...activeParams.current, cursor: nextCursor });
      if (requestGeneration !== generation.current) return;
      setApiEvents((current) => {
        const ids = new Set(current.map((event) => event.id));
        return [...current, ...response.items.map(mapApiAuditEventToView).filter((item) => !ids.has(item.id))];
      });
      setNextCursor(response.nextCursor);
      setUpdatedAt(new Date().toISOString());
    } catch (cause) {
      if (requestGeneration === generation.current) setError(presentError(cause, "加载更多记录失败，请重试。"));
    } finally {
      if (requestGeneration === generation.current) {
        morePending.current = false;
        setLoadingMore(false);
      }
    }
  }, [enabled, isApiMode, loading, nextCursor]);

  const events = useMemo(() => enabled ? (isApiMode ? apiEvents : filterViews(mockEvents.map(mapMockAuditEventToView), query)) : [],
    [apiEvents, enabled, isApiMode, mockEvents, query]);

  const fetchAllForExport = useCallback(async () => {
    if (!isApiMode) return { rows: events.slice(0, AUDIT_EXPORT_MAX_ROWS), truncated: events.length > AUDIT_EXPORT_MAX_ROWS };
    const rows: AuditEventView[] = [];
    const exportParams = activeParams.current;
    let cursor: string | undefined;
    while (rows.length < AUDIT_EXPORT_MAX_ROWS) {
      const response = await createAuditClient().listAuditEvents({ ...exportParams, limit: 100, cursor });
      rows.push(...response.items.map(mapApiAuditEventToView));
      if (!response.nextCursor) return { rows, truncated: false };
      if (response.nextCursor === cursor) throw new Error("导出分页未能继续，请刷新后重试。");
      cursor = response.nextCursor;
    }
    return { rows: rows.slice(0, AUDIT_EXPORT_MAX_ROWS), truncated: true };
  }, [events, isApiMode]);

  return { events, loading, loadingMore, error, updatedAt, hasMore: Boolean(nextCursor), loadMore, reload, fetchAllForExport };
}

export function useAuditTraceEvents(traceId: string | undefined, isApiMode: boolean, mockEvents: AuditEvent[], organizationId?: string) {
  const query = useMemo<AuditQueryState>(() => ({ appGroup: "all", severity: "all", search: "", timeWindow: "all", traceId, organizationId }), [traceId, organizationId]);
  const result = useAuditEvents({ isApiMode, mockEvents, query, enabled: Boolean(traceId) });
  return { ...result, relatedEvents: result.events };
}

export function useAuditEvent(eventId: string | null, cachedEvent: AuditEventView | undefined, isApiMode: boolean, mockEvents: AuditEvent[], organizationId?: string) {
  const [remoteEvent, setRemoteEvent] = useState<AuditEventView>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setLoading(false);
    setRemoteEvent(undefined);
    if (!eventId || cachedEvent?.id === eventId || !isApiMode) return;
    setLoading(true);
    createAuditClient().listAuditEvents({ eventId, limit: 1, ...(organizationId ? { organizationId } : {}) }).then((response) => {
      if (cancelled) return;
      setRemoteEvent(response.items[0] ? mapApiAuditEventToView(response.items[0]) : undefined);
      if (!response.items.length) setError("未找到该审计事件，可能已超出当前组织的可访问范围。");
    }).catch((cause: unknown) => {
      if (!cancelled) setError(presentError(cause, "加载事件详情失败，请重试。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId, cachedEvent, isApiMode, attempt, organizationId]);
  const mockEvent = !isApiMode ? mockEvents.find((event) => event.id === eventId) : undefined;
  const event = cachedEvent?.id === eventId ? cachedEvent : remoteEvent?.id === eventId ? remoteEvent : mockEvent ? mapMockAuditEventToView(mockEvent) : undefined;
  return { event, error, loading, retry: () => setAttempt((value) => value + 1) };
}
