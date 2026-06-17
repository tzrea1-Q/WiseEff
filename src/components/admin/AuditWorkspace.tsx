import { useEffect, useMemo, useState } from "react";
import { AuditEventDetail } from "./AuditEventDetail";
import { AuditRelatedTimeline } from "./AuditRelatedTimeline";
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
  variant?: "dialog" | "page";
  title?: string;
  eyebrow?: string;
  description?: string;
  footerActions?: React.ReactNode;
  onOpenAuditCenter?: () => void;
};

export function AuditWorkspace({
  mockEvents,
  isApiMode,
  query,
  onQueryChange,
  projects = [],
  variant = "page",
  title = "审计记录",
  eyebrow = "组织审计中心",
  description = "检索参数、日志、调试、Agent 与用户治理等跨模块操作证据。",
  footerActions,
  onOpenAuditCenter
}: AuditWorkspaceProps) {
  const [localSearch, setLocalSearch] = useState(query.search);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const selectedEvent = events.find((event) => event.id === selectedId) ?? events[0] ?? null;
  const { relatedEvents, loading: relatedLoading } = useAuditTraceEvents(selectedEvent?.traceId, isApiMode, mockEvents);

  const commitSearch = () => {
    if (localSearch !== query.search) {
      onQueryChange?.({ search: localSearch });
    }
  };

  useEffect(() => {
    if (events.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !events.some((event) => event.id === selectedId)) {
      setSelectedId(events[0].id);
    }
  }, [events, selectedId]);

  const body = (
    <>
      <div className="audit-workspace-toolbar">
        <input
          className="param-admin-audit-search"
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
        <div className="audit-workspace-filter-row">
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

      <div className="param-admin-audit-body audit-workspace-body">
        <AuditTimeline
          events={events}
          selectedId={selectedEvent?.id ?? null}
          onSelect={setSelectedId}
          initialVisible={variant === "page" ? 20 : 12}
          className="param-admin-audit-timeline"
        />
        <div className="audit-workspace-detail-stack">
          <AuditEventDetail event={selectedEvent} className="param-admin-audit-detail" />
          <AuditRelatedTimeline
            events={relatedEvents}
            activeEventId={selectedEvent?.id ?? null}
            loading={relatedLoading}
            onSelect={setSelectedId}
          />
          {selectedEvent?.traceId && onQueryChange ? (
            <button
              type="button"
              className="button subtle audit-workspace-trace-link"
              onClick={() => onQueryChange({ traceId: selectedEvent.traceId })}
            >
              按 Trace 筛选列表
            </button>
          ) : null}
        </div>
      </div>

      <div className={cn("audit-workspace-footer", variant === "dialog" && "dialog-actions")}>
        <span className="param-admin-audit-count">{events.length} 条记录</span>
        {hasMore ? (
          <button type="button" className="button subtle" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : null}
        {onOpenAuditCenter ? (
          <button type="button" className="button subtle" onClick={onOpenAuditCenter}>
            打开审计中心
          </button>
        ) : null}
        {footerActions}
      </div>
    </>
  );

  if (variant === "dialog") {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="参数管理审计">
        <div className="submission-dialog param-admin-audit-dialog">
          <div className="submission-dialog-head">
            <div>
              <span className="eyebrow">{eyebrow}</span>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </div>
          {body}
        </div>
      </div>
    );
  }

  return (
    <section className="audit-center-page" aria-label="组织审计中心">
      <header className="audit-center-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      {body}
    </section>
  );
}
