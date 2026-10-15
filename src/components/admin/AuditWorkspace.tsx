import { useEffect, useMemo, useState } from "react";
import { AuditEventDetailDialog } from "./AuditEventDetailDialog";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionSkeleton } from "@/components/common/SectionState";
import { auditAppGroups, getAuditAppLabel } from "@/domain/audit/auditApps";
import { presentAuditAction, presentAuditKind } from "@/domain/audit/auditSlugLabels";
import type { AuditQueryState } from "@/hooks/useAuditEvents";
import { useAuditEvents, useAuditTraceEvents } from "@/hooks/useAuditEvents";
import type { AuditEvent } from "@/domain/prototype/types";
import { ViewSwitch } from "@/components/ui/view-switch";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";

const severityLabels: Record<string, string> = { High: "高", Medium: "中", Low: "低", info: "信息" };

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
    [localSearch, query.appGroup, query.projectId, query.severity, query.timeWindow, query.traceId, query.search]
  );

  const { events, loading, loadingMore, error, hasMore, loadMore, fetchAllForExport } = useAuditEvents({
    isApiMode,
    mockEvents,
    query: effectiveQuery
  });
  const detailEvent = events.find((event) => event.id === detailEventId) ?? null;
  const { relatedEvents, loading: relatedLoading } = useAuditTraceEvents(detailEvent?.traceId, isApiMode, mockEvents);
  const [exporting, setExporting] = useState(false);

  const commitSearch = () => {
    if (localSearch !== query.search) {
      onQueryChange?.({ search: localSearch });
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await fetchAllForExport();
      // Chinese labels for humans; the raw kind slug stays alongside so the
      // export remains machine-filterable and auditable.
      const header = ["时间", "模块", "类型", "类型标识", "操作", "操作标识", "操作人", "严重度", "对象类型", "对象", "Trace"];
      const escapeCell = (value: string) => `"${value.replaceAll('"', '""')}"`;
      const lines = [header.join(",")].concat(
        rows.map((event) =>
          [
            event.createdAt ?? event.timeLabel,
            getAuditAppLabel(event.app),
            presentAuditKind(event.kind).label,
            event.kind,
            presentAuditAction(event.action).label,
            event.action,
            event.actor,
            severityLabels[event.severity] ?? event.severity,
            event.targetType ?? "",
            event.targetId ?? "",
            event.traceId ?? ""
          ]
            .map((cell) => escapeCell(String(cell)))
            .join(",")
        )
      );
      // UTF-8 BOM keeps Chinese headers intact when opened in Excel.
      const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `audit-events-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const closeDetail = () => setDetailEventId(null);

  return (
    <section className="audit-center-page" aria-label="组织审计中心">
      <AdminListPage label="组织审计中心"
        headerActions={<button
            type="button"
            className="button primary audit-workspace-export"
            disabled={exporting || events.length === 0}
            onClick={() => void exportCsv()}
          >
            {exporting ? "导出中…" : "导出 CSV"}
          </button>}
        filterBar={
          <div className="audit-workspace-toolbar">
            <div className="audit-workspace-filter-row">
              <SearchField
                className="audit-workspace-search"
                placeholder="搜索操作、操作人或类型"
                value={localSearch}
                onValueChange={setLocalSearch}
                onBlur={commitSearch}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitSearch();
                  }
                }}
                ariaLabel="搜索审计记录"
              />
              <label className="audit-workspace-select-wrap">
                <span>模块</span>
                <SelectControl
                  size="filter"
                  value={query.appGroup}
                  onValueChange={(value) => onQueryChange?.({ appGroup: value as AuditQueryState["appGroup"] })}
                  ariaLabel="模块筛选"
                  options={auditAppGroups.map((group) => ({ value: group.id, label: group.label }))}
                />
              </label>
              {projects.length > 0 ? (
                <label className="audit-workspace-select-wrap">
                  <span>项目</span>
                  <SelectControl
                    size="filter"
                    value={query.projectId ?? ""}
                    onValueChange={(value) =>
                      onQueryChange?.({ projectId: value || undefined })
                    }
                    ariaLabel="项目筛选"
                    options={[{ value: "", label: "全部项目" }, ...projects.map((project) => ({ value: project.id, label: project.code ?? project.name }))]}
                  />
                </label>
              ) : null}
              <label className="audit-workspace-select-wrap">
                <span>时间</span>
                <SelectControl
                  size="filter"
                  value={query.timeWindow}
                  onValueChange={(value) => onQueryChange?.({ timeWindow: value as AuditQueryState["timeWindow"] })}
                  ariaLabel="时间范围筛选"
                  options={[{ value: "all", label: "全部时间" }, { value: "today", label: "今天" }, { value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }]}
                />
              </label>
              <ViewSwitch
                variant="toggle"
                ariaLabel="严重度筛选"
                value={query.severity}
                onValueChange={(severity) => onQueryChange?.({ severity: severity as AuditQueryState["severity"] })}
                items={[
                  { value: "all", label: "全部" }, { value: "High", label: "高" },
                  { value: "Medium", label: "中" }, { value: "Low", label: "低" }
                ]}
              />
            </div>
            {query.traceId ? (
              <div className="audit-workspace-trace-banner">
                <span>Trace 筛选：{query.traceId}</span>
                <button type="button" className="button subtle" onClick={() => onQueryChange?.({ traceId: undefined })}>
                  清除
                </button>
              </div>
            ) : null}
          </div>}
        notice={error ? <p role="alert">{error}</p> : undefined}
        tableState={loading && events.length === 0 ? <SectionSkeleton label="正在加载审计记录" /> : undefined}
        table={{ ariaLabel: "审计事件", rows: events, rowKey: (event) => event.id, pageSize: 20,
          selectedRowKey: detailEventId ?? undefined, onRowClick: (event) => setDetailEventId(event.id),
          columns: [
            { key: "time", header: "时间", render: (event) => event.timeLabel },
            { key: "app", header: "模块", render: (event) => getAuditAppLabel(event.app) },
            { key: "kind", header: "类型", className: "admin-list-truncated-cell", render: (event) => <span title={`${presentAuditKind(event.kind).label} · ${event.kind}`}>{presentAuditKind(event.kind).label}</span> },
            { key: "action", header: "操作内容", className: "admin-list-truncated-cell", render: (event) => <span title={`${presentAuditAction(event.action).label} · ${event.action}`}>{presentAuditAction(event.action).label}</span> },
            { key: "actor", header: "操作人", render: (event) => event.actor },
            { key: "severity", header: "严重度", render: (event) => <span data-row-status>{severityLabels[event.severity] ?? "未记录"}</span> }
          ] }}
        rowActions={(event) => ({ label: `审计事件 ${event.id} 操作`,
          primaryAction: { id: "view", label: "查看", onSelect: () => setDetailEventId(event.id) },
          items: [{ id: "related", label: "关联事件", onSelect: () => setDetailEventId(event.id) }]
        })}
        emptyState={{ message: "暂无审计事件", actionLabel: "清除筛选条件", onAction: () => {
          setLocalSearch(""); onQueryChange?.({ appGroup: "all", projectId: undefined, severity: "all", search: "", timeWindow: "all", traceId: undefined });
        } }} />

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
