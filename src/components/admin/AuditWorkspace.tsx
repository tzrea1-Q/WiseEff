import { useEffect, useMemo, useState } from "react";
import { AuditEventDetailDialog } from "./AuditEventDetailDialog";
import { AuditTimeline } from "./AuditTimeline";
import { auditAppGroups } from "@/domain/audit/auditApps";
import type { AuditQueryState } from "@/hooks/useAuditEvents";
import { useAuditEvents, useAuditTraceEvents } from "@/hooks/useAuditEvents";
import type { AuditEvent } from "@/mockData";
import { cn } from "@/lib/utils";

export type AuditWorkspaceProps = {
  mockEvents: AuditEvent[];
  isApiMode: boolean;
  query: AuditQueryState;
  onQueryChange?: (patch: Partial<AuditQueryState>) => void;
  projects?: Array<{ id: string; name: string; code?: string }>;
};

export function AuditWorkspace({
  mockEvents,
  isApiMode,
  query,
  onQueryChange,
  projects = []
}: AuditWorkspaceProps) {
  const [localSearch, setLocalSearch] = useState(query.search);
  const [detailEventId, setDetailEventId] = useState<string | null>(null);

  useEffect(() => {
    setLocalSearch(query.search);
  }, [query.search]);

  const effectiveQuery = useMemo(
    () => ({ ...query, search: localSearch }),
    [localSearch, query.appGroup, query.projectId, query.severity, query.traceId, query.search]
  );

  const { events, loading, loadingMore, error, hasMore, loadMore } = useAuditEvents({
    isApiMode,
    mockEvents,
    query: effectiveQuery
  });
  const detailEvent = events.find((event) => event.id === detailEventId) ?? null;
  const { relatedEvents, loading: relatedLoading } = useAuditTraceEvents(detailEvent?.traceId, isApiMode, mockEvents);

  const commitSearch = () => {
    if (localSearch !== query.search) {
      onQueryChange?.({ search: localSearch });
    }
  };

  const closeDetail = () => setDetailEventId(null);

  return (
    <section className="audit-center-page" aria-label="组织审计中心">
      <div className="audit-workspace-toolbar">
        <div className="audit-workspace-filter-row">
          <input
            className="audit-workspace-search"
            type="search"
            placeholder="搜索操作、操作人或类型"
            value={localSearch}
            onChange={(event) => setLocalSearch(event.target.value)}
            onBlur={commitSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitSearch();
              }
            }}
            aria-label="搜索审计记录"
          />
          <label className="audit-workspace-select-wrap">
            <span>模块</span>
            <select
              value={query.appGroup}
              onChange={(event) => onQueryChange?.({ appGroup: event.target.value as AuditQueryState["appGroup"] })}
              aria-label="模块筛选"
            >
              {auditAppGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          {projects.length > 0 ? (
            <label className="audit-workspace-select-wrap">
              <span>项目</span>
              <select
                value={query.projectId ?? ""}
                onChange={(event) =>
                  onQueryChange?.({ projectId: event.target.value ? event.target.value : undefined })
                }
                aria-label="项目筛选"
              >
                <option value="">全部项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code ?? project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="param-admin-audit-filters" role="group" aria-label="严重度筛选">
            {(
              [
                ["all", "全部"],
                ["High", "高"],
                ["Medium", "中"],
                ["Low", "低"]
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn("chip", query.severity === value && "chip-active")}
                aria-pressed={query.severity === value}
                onClick={() => onQueryChange?.({ severity: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {query.traceId ? (
          <div className="audit-workspace-trace-banner">
            <span>Trace 筛选：{query.traceId}</span>
            <button type="button" className="button subtle" onClick={() => onQueryChange?.({ traceId: undefined })}>
              清除
            </button>
          </div>
        ) : null}
      </div>

      {loading ? <p className="param-admin-audit-status">正在加载审计记录…</p> : null}
      {error ? <p className="param-admin-audit-status param-admin-audit-status-error">{error}</p> : null}

      <div className="audit-workspace-list">
        <AuditTimeline
          events={events}
          selectedId={detailEventId}
          onSelect={setDetailEventId}
          initialVisible={20}
        />
      </div>

      <div className="audit-workspace-footer">
        <span className="param-admin-audit-count">{events.length} 条记录</span>
        {hasMore ? (
          <button type="button" className="button subtle" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : null}
      </div>

      {detailEvent ? (
        <AuditEventDetailDialog
          event={detailEvent}
          relatedEvents={relatedEvents}
          relatedLoading={relatedLoading}
          onClose={closeDetail}
          onSelectRelated={setDetailEventId}
          onFilterTrace={
            onQueryChange
              ? (traceId) => {
                  onQueryChange({ traceId });
                }
              : undefined
          }
        />
      ) : null}
    </section>
  );
}
