import { useCallback, useEffect, useMemo, useState } from "react";
import { matchesAuditAppGroup, getAuditAppGroup, type AuditAppGroupId } from "@/domain/audit/auditApps";
import { mapApiAuditEventToView, mapMockAuditEventToView } from "@/domain/audit/mapAuditEventView";
import type { AuditEventView, ListAuditEventsParams } from "@/domain/audit/types";
import { createAuditClient } from "@/infrastructure/http/auditClient";
import type { AuditEvent, RiskLevel } from "@/domain/prototype/types";

const EXPORT_MAX_ROWS = 2000;

export type AuditTimeWindow = "all" | "today" | "7d" | "30d";

export type AuditQueryState = {
  appGroup: AuditAppGroupId;
  severity: RiskLevel | "all";
  search: string;
  timeWindow: AuditTimeWindow;
  projectId?: string;
  traceId?: string;
};

/** Start-of-window ISO timestamp for a time window, or undefined for "all". */
export function auditTimeWindowFrom(window: AuditTimeWindow, now = new Date()): string | undefined {
  if (window === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  if (window === "7d") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (window === "30d") {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
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

function filterViews(events: AuditEventView[], query: AuditQueryState, mode: "api" | "mock") {
  const normalizedSearch = query.search.trim().toLowerCase();
  const fromIso = mode === "mock" ? auditTimeWindowFrom(query.timeWindow) : undefined;

  return events.filter((event) => matchesAuditAppGroup(event.app, query.appGroup, mode)).filter((event) => {
    if (query.severity !== "all" && event.severity !== query.severity) {
      return false;
    }
    if (query.traceId && event.traceId !== query.traceId) {
      return false;
    }
    if (fromIso && event.createdAt && event.createdAt < fromIso) {
      return false;
    }
    // API mode: text search and the time window are pushed down to the server.
    if (mode === "api" || !normalizedSearch) {
      return true;
    }
    const haystack = [event.action, event.actor, event.kind, event.app, event.targetId ?? "", event.traceId ?? ""]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

function buildApiParams(query: AuditQueryState, limit: number, cursor?: string): ListAuditEventsParams {
  const group = getAuditAppGroup(query.appGroup);
  const params: ListAuditEventsParams = { limit, cursor };
  if (query.projectId) {
    params.projectId = query.projectId;
  }
  if (query.traceId) {
    params.traceId = query.traceId;
  }
  if (query.severity !== "all") {
    params.severity = query.severity;
  }
  if (query.search.trim()) {
    params.q = query.search.trim();
  }
  const from = auditTimeWindowFrom(query.timeWindow);
  if (from) {
    params.from = from;
  }
  if (group.apiApps.length === 1) {
    params.app = group.apiApps[0];
  } else if (group.apiApps.length > 1) {
    params.apps = group.apiApps;
  }
  return params;
}

export function useAuditEvents({ isApiMode, mockEvents, query, limit = 50, enabled = true }: UseAuditEventsOptions) {
  const [apiEvents, setApiEvents] = useState<AuditEventView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!enabled || !isApiMode) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await createAuditClient().listAuditEvents(buildApiParams(query, limit));
      setApiEvents(response.items.map(mapApiAuditEventToView));
      setNextCursor(response.nextCursor);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "加载审计记录失败");
      setApiEvents([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, isApiMode, limit, query]);

  useEffect(() => {
    if (!isApiMode) {
      setApiEvents([]);
      setNextCursor(null);
      setError("");
      return;
    }
    void reload();
  }, [isApiMode, reload]);

  const loadMore = useCallback(async () => {
    if (!isApiMode || !nextCursor || loadingMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const response = await createAuditClient().listAuditEvents(buildApiParams(query, limit, nextCursor));
      setApiEvents((current) => [...current, ...response.items.map(mapApiAuditEventToView)]);
      setNextCursor(response.nextCursor);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "加载更多审计记录失败");
    } finally {
      setLoadingMore(false);
    }
  }, [isApiMode, limit, loadingMore, nextCursor, query]);

  const events = useMemo(() => {
    if (isApiMode) {
      return filterViews(apiEvents, query, "api");
    }
    return filterViews(mockEvents.map(mapMockAuditEventToView), query, "mock");
  }, [apiEvents, isApiMode, mockEvents, query]);

  /**
   * Full result of the current filter for export: pages through the server in
   * API mode (capped at EXPORT_MAX_ROWS), returns the filtered set in mock mode.
   */
  const fetchAllForExport = useCallback(async (): Promise<AuditEventView[]> => {
    if (!isApiMode) {
      return events;
    }
    const collected: AuditEventView[] = [];
    let cursor: string | undefined;
    while (collected.length < EXPORT_MAX_ROWS) {
      const response = await createAuditClient().listAuditEvents(buildApiParams(query, 100, cursor));
      collected.push(...response.items.map(mapApiAuditEventToView));
      if (!response.nextCursor) {
        break;
      }
      cursor = response.nextCursor;
    }
    return filterViews(collected.slice(0, EXPORT_MAX_ROWS), query, "api");
  }, [events, isApiMode, query]);

  return {
    events,
    loading,
    loadingMore,
    error,
    hasMore: Boolean(nextCursor),
    loadMore,
    reload,
    fetchAllForExport
  };
}

export function useAuditTraceEvents(traceId: string | undefined, isApiMode: boolean, mockEvents: AuditEvent[]) {
  const [relatedEvents, setRelatedEvents] = useState<AuditEventView[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!traceId) {
      setRelatedEvents([]);
      return;
    }

    if (!isApiMode) {
      setRelatedEvents(
        mockEvents
          .map(mapMockAuditEventToView)
          .filter((event) => event.traceId === traceId)
      );
      return;
    }

    let cancelled = false;
    setLoading(true);

    createAuditClient()
      .listAuditEvents({ traceId, limit: 20 })
      .then((response) => {
        if (cancelled) return;
        setRelatedEvents(response.items.map(mapApiAuditEventToView));
      })
      .catch(() => {
        if (!cancelled) {
          setRelatedEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isApiMode, mockEvents, traceId]);

  return { relatedEvents, loading };
}
