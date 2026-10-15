import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { AuditEventDetailDialog } from "./AuditEventDetailDialog";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ModalDialog } from "@/components/common/ModalDialog";
import { auditAppGroups, getAuditAppLabel, matchesAuditAppGroup } from "@/domain/audit/auditApps";
import { AUDIT_KIND_LABELS, presentAuditAction, presentAuditKind } from "@/domain/audit/auditSlugLabels";
import { formatAuditAbsoluteTime, formatAuditRelativeTime } from "@/domain/audit/formatAuditTime";
import { AUDIT_SEVERITIES, getAuditSeverityLabel, type AuditEventView } from "@/domain/audit/types";
import { AUDIT_EXPORT_MAX_ROWS, useAuditEvent, useAuditEvents, useAuditTraceEvents, type AuditQueryState } from "@/hooks/useAuditEvents";
import { buildAuditSearch } from "@/hooks/useAuditSearch";
import type { AuditEvent } from "@/domain/prototype/types";
import { presentError } from "@/infrastructure/http/presentError";
import { ColumnFilter } from "@/components/ColumnFilter";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";
import "./audit-workspace.css";

export type AuditWorkspaceProps = {
  mockEvents: AuditEvent[];
  isApiMode: boolean;
  query: AuditQueryState;
  onQueryChange?: (patch: Partial<AuditQueryState>) => void;
  projects?: Array<{ id: string; name: string; code?: string }>;
};

const emptyQuery: AuditQueryState = { appGroup: "all", severity: "all", search: "", timeWindow: "all" };

function localDateInput(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function targetName(event: AuditEventView) {
  const name = event.targetName ?? event.metadata?.parameterName ?? event.metadata?.nodePath ?? event.metadata?.name;
  return typeof name === "string" && name ? name : event.targetId ?? "未记录对象";
}

function businessUrl(event: AuditEventView) {
  if (!event.projectId || !matchesAuditAppGroup(event.app, "parameter", "api")) return undefined;
  const params = new URLSearchParams({ project: event.projectId });
  const binding = event.metadata?.bindingId ?? event.metadata?.targetBindingId;
  if (typeof binding === "string") params.set("bindingId", binding);
  return "/parameters?" + params.toString();
}

function AuditKindField({ initialKind = "" }: { initialKind?: string }) {
  const [kind, setKind] = useState(() => Object.hasOwn(AUDIT_KIND_LABELS, initialKind) ? initialKind : "");
  return <label><span>事件类型</span>
    <SelectControl className="w-full" value={kind} onValueChange={setKind} ariaLabel="事件类型筛选"
      options={[{ value: "", label: "全部类型" }, ...Object.entries(AUDIT_KIND_LABELS).map(([value, label]) => ({ value, label }))]} />
    <input type="hidden" name="kind" value={kind} />
  </label>;
}

export function AuditWorkspace({ mockEvents, isApiMode, query, onQueryChange, projects = [] }: AuditWorkspaceProps) {
  const [localSearch, setLocalSearch] = useState(query.search);
  const [detailEventId, setDetailEventId] = useState<string | null>(query.eventId ?? null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEventView>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [exportError, setExportError] = useState("");
  const [, refreshClock] = useState(0);
  const exportQueryKey = buildAuditSearch({ ...query, eventId: undefined });
  const exportRevision = useRef(0);
  useEffect(() => { exportRevision.current++; }, [exportQueryKey]);

  useEffect(() => { setLocalSearch(query.search); }, [query.search]);
  useEffect(() => { setDetailEventId(query.eventId ?? null); }, [query.eventId]);
  useEffect(() => {
    const timer = window.setInterval(() => refreshClock((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (localSearch.trim() === query.search) return;
    const timer = window.setTimeout(() => onQueryChange?.({ search: localSearch.trim(), eventId: undefined }), 300);
    return () => window.clearTimeout(timer);
  }, [localSearch, query.search, onQueryChange]);

  const invalidRange = query.timeWindow === "custom" && (!query.from || !query.to ||
    !Number.isFinite(Date.parse(query.from)) || !Number.isFinite(Date.parse(query.to)) || Date.parse(query.from) > Date.parse(query.to));
  const result = useAuditEvents({ isApiMode, mockEvents, query, enabled: !invalidRange });
  const { events, loading, loadingMore, error, updatedAt, hasMore, loadMore, reload, fetchAllForExport } = result;
  const cachedEvent = events.find((event) => event.id === detailEventId) ?? (selectedEvent?.id === detailEventId ? selectedEvent : undefined);
  const detail = useAuditEvent(detailEventId, cachedEvent, isApiMode, mockEvents);
  const related = useAuditTraceEvents(detail.event?.traceId, isApiMode, mockEvents);
  const detailIndex = events.findIndex((event) => event.id === detailEventId);
  const selectedSeverities = Array.isArray(query.severity) ? query.severity : query.severity === "all" ? [] : [query.severity];
  const activeFilters = query.appGroup !== "all" || query.severity !== "all" || query.search || query.projectId ||
    query.timeWindow !== "all" || query.traceId || query.kind || query.targetId;
  const advancedActive = Boolean(query.traceId || query.kind || query.targetId || query.timeWindow === "custom");

  const changeQuery = (patch: Partial<AuditQueryState>) => {
    exportRevision.current++;
    setExportMessage("");
    setExportError("");
    onQueryChange?.({ ...patch, eventId: undefined });
  };
  const commitSearch = () => {
    if (localSearch.trim() !== query.search) changeQuery({ search: localSearch.trim() });
  };
  const selectEvent = (id: string) => {
    setSelectedEvent(events.find((event) => event.id === id) ?? related.relatedEvents.find((event) => event.id === id));
    setDetailEventId(id);
    onQueryChange?.({ eventId: id });
  };
  const closeDetail = () => {
    setDetailEventId(null);
    onQueryChange?.({ eventId: undefined });
  };
  const clearFilters = () => {
    setLocalSearch("");
    changeQuery({ ...emptyQuery, projectId: undefined, traceId: undefined, kind: undefined, targetId: undefined, from: undefined, to: undefined });
  };
  const refreshRecords = () => { exportRevision.current++; void reload(); };

  const exportCsv = async () => {
    setExporting(true);
    setExportMessage("");
    setExportError("");
    const startedAtRevision = exportRevision.current;
    try {
      const { rows, truncated } = await fetchAllForExport();
      if (exportRevision.current !== startedAtRevision) {
        throw new Error("筛选条件已变化，本次导出已取消；请按当前条件重新导出。");
      }
      const header = ["时间", "模块", "类型", "类型标识", "操作", "操作标识", "操作人", "严重度", "对象类型", "对象", "Trace", "项目", "对象名称"];
      const escapeCell = (value: unknown) => {
        const text = String(value ?? "");
        const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
        return '"' + safe.replaceAll('"', '""') + '"';
      };
      const lines = [header.join(",")].concat(rows.map((event) => [
        event.createdAt ?? event.timeLabel, getAuditAppLabel(event.app),
        presentAuditKind(event.kind).label, event.kind, presentAuditAction(event.action).label, event.action,
        event.actor, getAuditSeverityLabel(event.severity), event.targetType, event.targetId, event.traceId,
        event.projectCode ?? event.projectName ?? event.projectId, event.targetName
      ].map(escapeCell).join(",")));
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "audit-events-" + new Date().toISOString().slice(0, 10) + (truncated ? "-前2000条" : "") + ".csv";
      anchor.click();
      URL.revokeObjectURL(url);
      setExportMessage(truncated
        ? "已导出前 " + rows.length + " 条，达到导出上限；仍有更多记录，请缩小筛选范围后继续导出。"
        : "已导出当前筛选范围的全部 " + rows.length + " 条记录。");
    } catch (cause) {
      setExportError(presentError(cause, "导出失败，请重试。"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="audit-center-page" aria-label="组织审计中心" aria-busy={loading || undefined}>
      <AdminListPage label="组织审计中心"
        headerContent={<div className="audit-workspace-context">
          <strong>操作记录</strong>
          <span role="status">{loading ? "正在更新记录…" : "已加载 " + events.length + " 条"}
            {updatedAt && !loading ? " · 更新于 " + new Date(updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""}</span>
        </div>}
        headerActions={<>
          <button type="button" className="button subtle" disabled={loading} onClick={refreshRecords}>
            <RefreshCw size={14} aria-hidden="true" />刷新
          </button>
          <button type="button" className="button primary audit-workspace-export"
            title={"按当前筛选导出，最多 " + AUDIT_EXPORT_MAX_ROWS + " 条"}
            disabled={exporting || loading || invalidRange || events.length === 0} onClick={() => { void exportCsv(); }}>
            <Download size={14} aria-hidden="true" />{exporting ? "导出中…" : "导出 CSV"}
          </button>
        </>}
        filterBar={<div className="audit-workspace-toolbar">
          <div className="audit-workspace-filter-row">
            <label className="audit-workspace-select-wrap audit-workspace-search-wrap">
              <span>检索记录</span>
              <SearchField className="audit-workspace-search" placeholder="搜索操作、操作人、类型或对象"
                value={localSearch} onValueChange={setLocalSearch} onBlur={commitSearch} loading={loading}
                maxLength={200} onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) commitSearch();
                }} ariaLabel="搜索审计记录" />
            </label>
            <label className="audit-workspace-select-wrap"><span>模块</span>
              <SelectControl size="filter" value={query.appGroup} ariaLabel="模块筛选"
                onValueChange={(value) => changeQuery({ appGroup: value as AuditQueryState["appGroup"], search: localSearch.trim() })}
                options={auditAppGroups.map((group) => ({ value: group.id, label: group.label }))} />
            </label>
            <label className="audit-workspace-select-wrap"><span>项目</span>
              <SelectControl size="filter" value={query.projectId ?? ""} ariaLabel="项目筛选"
                onValueChange={(value) => changeQuery({ projectId: value || undefined, search: localSearch.trim() })}
                options={[{ value: "", label: "全部项目" }, ...projects.map((project) => ({ value: project.id, label: project.code ?? project.name }))]} />
            </label>
            <label className="audit-workspace-select-wrap"><span>时间范围</span>
              <SelectControl size="filter" value={query.timeWindow} ariaLabel="时间范围筛选"
                onValueChange={(value) => {
                  if (value === "custom") setAdvancedOpen(true);
                  changeQuery({ timeWindow: value as AuditQueryState["timeWindow"], from: undefined, to: undefined, search: localSearch.trim() });
                }}
                options={[{ value: "all", label: "全部时间" }, { value: "today", label: "今天" }, { value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }, { value: "custom", label: "自定义时间" }]} />
            </label>
            <div className="audit-workspace-filter-actions">
              <button type="button" className="button subtle" aria-expanded={advancedOpen} aria-controls="audit-advanced-filters" onClick={() => setAdvancedOpen((open) => !open)}>
                <SlidersHorizontal size={14} aria-hidden="true" />{advancedActive ? "更多筛选 · 已启用" : "更多筛选"}
              </button>
              {activeFilters ? <button type="button" className="button subtle" onClick={clearFilters} aria-label="清除筛选条件" title="清除筛选条件"><X size={14} aria-hidden="true" /></button> : null}
            </div>
          </div>
          {advancedOpen ? <form id="audit-advanced-filters" className="audit-workspace-advanced"
            key={[query.kind, query.targetId, query.traceId, query.from, query.to].join("|")}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const fromValue = String(data.get("from") ?? "");
              const toValue = String(data.get("to") ?? "");
              changeQuery({
                kind: String(data.get("kind") ?? "") || undefined, targetId: String(data.get("targetId") ?? "").trim() || undefined,
                traceId: String(data.get("traceId") ?? "").trim() || undefined, search: localSearch.trim(),
                ...(query.timeWindow === "custom" ? {
                  from: fromValue ? new Date(fromValue).toISOString() : undefined,
                  to: toValue ? new Date(toValue).toISOString() : undefined
                } : {})
              });
            }}>
            {query.timeWindow === "custom" ? <>
              <label><span>开始时间（本地时间）</span><input type="datetime-local" name="from" defaultValue={localDateInput(query.from)} required /></label>
              <label><span>结束时间（本地时间）</span><input type="datetime-local" name="to" defaultValue={localDateInput(query.to)} required /></label>
            </> : null}
            <AuditKindField initialKind={query.kind} />
            <label><span>对象 ID</span><input name="targetId" defaultValue={query.targetId} maxLength={200} placeholder="精确匹配对象 ID" /></label>
            <label><span>链路 ID</span><input name="traceId" defaultValue={query.traceId} maxLength={200} placeholder="精确匹配链路 ID" /></label>
            <button type="submit" className="button subtle">应用筛选</button>
          </form> : null}
          {query.traceId || query.targetId || query.kind ? <p className="audit-workspace-filter-summary">
            当前条件：{[query.kind && presentAuditKind(query.kind).label, query.targetId && "对象 " + query.targetId, query.traceId && "链路 " + query.traceId].filter(Boolean).join(" · ")}
          </p> : null}
        </div>}
        notice={exportError ? <p role="alert">{exportError} 请点击“导出 CSV”重试。</p> : exportMessage ? <p role="status">{exportMessage}</p> : undefined}
        table={{ ariaLabel: "审计事件", rows: events, rowKey: (event) => event.id, pageSize: Math.max(events.length, 1),
          emptyState: invalidRange ? <SectionEmpty message="请选择有效的开始和结束时间，开始时间不能晚于结束时间。" /> :
            loading ? <SectionSkeleton label="正在加载审计记录" /> :
            error && !events.length ? <SectionError message={error} onRetry={refreshRecords} /> : undefined,
          tableClassName: "audit-workspace-table", selectedRowKey: detailEventId ?? undefined, onRowClick: (event) => selectEvent(event.id),
          columns: [
            { key: "time", header: "发生时间", className: "audit-workspace-time-cell", render: (event) => <div className="audit-workspace-cell">
              <time dateTime={event.createdAt} title={formatAuditAbsoluteTime(event.createdAt)}>{formatAuditAbsoluteTime(event.createdAt)}</time>
              <small>{event.createdAt ? formatAuditRelativeTime(event.createdAt) : event.timeLabel}</small></div> },
            { key: "action", header: "事件", className: "audit-workspace-event-cell", render: (event) => <div className="audit-workspace-cell">
              <strong title={presentAuditAction(event.action).label}>{presentAuditAction(event.action).label}</strong>
              <small title={getAuditAppLabel(event.app) + " · " + presentAuditKind(event.kind).label}>{getAuditAppLabel(event.app)} · {presentAuditKind(event.kind).label}</small></div> },
            { key: "target", header: "对象与项目", className: "audit-workspace-target-cell", render: (event) => <div className="audit-workspace-cell">
              <span title={targetName(event)}>{targetName(event)}</span>
              <small title={event.projectName ?? event.projectId ?? undefined}>{event.projectCode ?? event.projectName ?? (event.projectId ? "项目 " + event.projectId : "组织范围")}</small></div> },
            { key: "actor", header: "操作人", className: "audit-workspace-actor-cell", render: (event) => <span title={event.actor}>{event.actor}</span> },
            { key: "severity", header: "严重度", className: "audit-workspace-severity-cell",
              headerFilter: <ColumnFilter compact label="严重度" groupLabel="严重度筛选" align="right"
                values={AUDIT_SEVERITIES} selectedValues={selectedSeverities} renderLabel={getAuditSeverityLabel}
                onClear={() => changeQuery({ severity: "all", search: localSearch.trim() })}
                onToggle={(value) => {
                  const next = AUDIT_SEVERITIES.filter((severity) => severity === value ? !selectedSeverities.includes(severity) : selectedSeverities.includes(severity));
                  changeQuery({ severity: next.length > 1 ? next : next[0] ?? "all", search: localSearch.trim() });
                }} />,
              render: (event) => <span data-row-status className={"audit-workspace-status audit-workspace-status--" + event.severity}>{getAuditSeverityLabel(event.severity)}</span> }
          ] }}
        rowActions={(event) => ({ label: "审计事件 " + event.id + " 操作",
          primaryAction: { id: "view", label: "查看", onSelect: () => selectEvent(event.id) }, items: []
        })}
        emptyState={{ message: activeFilters ? "没有符合当前筛选条件的审计事件。" : "当前组织尚无审计事件。", actionLabel: activeFilters ? "清除筛选条件" : "刷新记录", onAction: activeFilters ? clearFilters : refreshRecords }} />
      <div className="audit-workspace-footer">
        <span>{loading ? "正在加载…" : "已加载 " + events.length + " 条"}{!loading && !hasMore && events.length ? " · 已显示全部结果" : ""}</span>
        {hasMore ? <button type="button" className="button subtle" disabled={loadingMore || loading} onClick={() => { void loadMore(); }}>{loadingMore ? "加载中…" : "加载更多"}</button> : null}
        <small>导出范围：当前筛选，最多 {AUDIT_EXPORT_MAX_ROWS} 条</small>
      </div>
      {error && events.length ? <SectionError message={error} onRetry={() => { void loadMore(); }} /> : null}
      {detail.event ? <AuditEventDetailDialog event={detail.event} relatedEvents={related.relatedEvents}
        relatedLoading={related.loading} relatedLoadingMore={related.loadingMore} relatedError={related.error} relatedHasMore={related.hasMore}
        onRetryRelated={() => { void related.reload(); }} onLoadMoreRelated={() => { void related.loadMore(); }}
        onClose={closeDetail} onSelectRelated={selectEvent}
        onPrevious={detailIndex > 0 ? () => selectEvent(events[detailIndex - 1].id) : undefined}
        onNext={detailIndex >= 0 && detailIndex < events.length - 1 ? () => selectEvent(events[detailIndex + 1].id) : undefined}
        eventUrl={window.location.origin + "/audit" + buildAuditSearch({ ...query, eventId: detail.event.id })}
        targetUrl={businessUrl(detail.event)}
        onFilterTrace={(traceId) => {
          setDetailEventId(null);
          setLocalSearch("");
          changeQuery({ ...emptyQuery, traceId, projectId: undefined, kind: undefined, targetId: undefined, from: undefined, to: undefined });
        }} /> :
        detailEventId ? <ModalDialog open onDismiss={closeDetail} className="submission-dialog modal-card--lg">
          {({ titleId }) => <><h2 id={titleId}>审计事件详情</h2>{detail.loading ? <SectionSkeleton label="正在加载事件详情" /> :
            <SectionError message={detail.error || "未找到该审计事件。"} onRetry={detail.retry} />}
            <div className="dialog-actions"><button type="button" className="button subtle" onClick={closeDetail}>关闭</button></div></>}
        </ModalDialog> : null}
    </section>
  );
}
