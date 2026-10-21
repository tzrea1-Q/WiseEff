import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductFeedbackAppendProgressInput, ProductFeedbackRepository, ProductFeedbackStats, ProductFeedbackUpdateInput } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback, ProductFeedbackStatus, ProductFeedbackType } from "@/domain/productFeedback/types";
import { productFeedbackStatuses, productFeedbackStatusLabels, productFeedbackTypeLabels, productFeedbackTypes } from "@/domain/productFeedback/types";
import type { Column } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { SectionSkeleton } from "@/components/common/SectionState";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";
import { filterItems } from "@/lib/search";
import { productFeedbackSearchProfile } from "@/lib/search/profiles";
import { presentError } from "@/infrastructure/http/presentError";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { requestSettingsLeave } from "@/application/settingsFormNavigation";
import { FeedbackAdminDrawer } from "./FeedbackAdminDrawer";
import { FeedbackStatusBadge } from "./FeedbackStatusBadge";
import "./feedback-admin.css";

export type FeedbackAdminPageProps = {
  productFeedbackRepository: ProductFeedbackRepository;
  search?: string;
  onSearchChange?: (search: string) => void;
};

const priorityLabels = { low: "低", normal: "普通", high: "高" } as const;

function readLocation(search = window.location.search) {
  const params = new URLSearchParams(search);
  const status = params.get("status");
  const type = params.get("type");
  const priority = params.get("priority");
  return {
    id: params.get("id"),
    status: productFeedbackStatuses.includes(status as ProductFeedbackStatus) ? status as ProductFeedbackStatus : "all" as const,
    type: productFeedbackTypes.includes(type as ProductFeedbackType) ? type as ProductFeedbackType : "all" as const,
    priority: priority === "low" || priority === "normal" || priority === "high" ? priority : "all" as const,
    assignee: params.get("assignee") ?? "all",
    query: params.get("q") ?? ""
  };
}

function submitterLabel(feedback: ProductFeedback) {
  if (feedback.submitter) {
    if (feedback.submitter.id === null) return "已注销用户";
    return feedback.submitter.username ? `${feedback.submitter.name} (@${feedback.submitter.username})` : feedback.submitter.name;
  }
  return feedback.submitterUserId === null ? "已注销用户" : feedback.submitterUserId ?? "内测用户";
}

export function FeedbackAdminPage({ productFeedbackRepository, search, onSearchChange }: FeedbackAdminPageProps) {
  const [location, setLocation] = useState(() => readLocation(search));
  const [rows, setRows] = useState<ProductFeedback[]>([]);
  const [stats, setStats] = useState<ProductFeedbackStats | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<ProductFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [detailError, setDetailError] = useState("");
  const [statsError, setStatsError] = useState("");
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const statsRequest = useRef(0);
  const mutationVersion = useRef(0);
  const inboxRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const previousId = useRef(location.id);

  useEffect(() => {
    const wasOpen = previousId.current;
    previousId.current = location.id;
    if (!wasOpen || location.id) return;
    const frame = requestAnimationFrame(() => {
      const target = returnFocus.current;
      if (target?.isConnected) target.focus();
      else inboxRef.current?.querySelector<HTMLInputElement>('input[aria-label="搜索反馈"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [location.id]);

  const changeLocation = (patch: Partial<typeof location>) => {
    const next = { ...location, ...patch };
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ id: next.id, status: next.status, type: next.type, priority: next.priority, assignee: next.assignee, q: next.query })) {
      if (value && value !== "all") url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    if (next.id && !location.id && document.activeElement instanceof HTMLElement && inboxRef.current?.contains(document.activeElement)) returnFocus.current = document.activeElement;
    if (next.id !== location.id && next.id) window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
    else window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setLocation(next);
    onSearchChange?.(url.search);
  };

  useEffect(() => {
    if (search !== undefined) setLocation(readLocation(search));
  }, [search]);

  useEffect(() => {
    if (search !== undefined) return undefined;
    const onPopState = () => {
      const next = readLocation();
      if (next.id === location.id) { setLocation(next); return; }
      const requestedUrl = window.location.href;
      const decision = requestSettingsLeave();
      if (decision instanceof Promise) void decision.then((allowed) => { if (allowed && window.location.href === requestedUrl) setLocation(next); });
      else if (decision) setLocation(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [location.id, search]);

  const refreshStats = useCallback(async () => {
    if (!productFeedbackRepository.getStats) return;
    const request = ++statsRequest.current;
    try {
      const result = await productFeedbackRepository.getStats();
      if (request !== statsRequest.current) return;
      setStats(result);
      setStatsError("");
    } catch {
      if (request !== statsRequest.current) return;
      setStats(null);
      setStatsError("统计暂不可用，当前显示已加载记录的数量。");
    }
  }, [productFeedbackRepository]);

  const loadFeedback = useCallback(async () => {
    const request = ++listRequest.current;
    const version = mutationVersion.current;
    setLoading(true);
    setErrorMessage("");
    try {
      const items: ProductFeedback[] = [];
      // ponytail: load the complete inbox for client filters; move filters and paging to the server if inbox volume grows.
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await productFeedbackRepository.list(cursor ? { cursor } : undefined);
        if (request !== listRequest.current) return;
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seenCursors.has(cursor)) throw new Error("反馈分页未能继续，请重新加载。");
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      setRows((current) => {
        const loaded = new Map(items.map((item) => [item.id, item]));
        if (version !== mutationVersion.current) {
          for (const item of current) {
            const incoming = loaded.get(item.id);
            if (!incoming || Date.parse(item.updatedAt) >= Date.parse(incoming.updatedAt)) loaded.set(item.id, item);
          }
        }
        return [...loaded.values()];
      });
      await refreshStats();
    } catch (error) {
      if (request === listRequest.current) setErrorMessage(presentError(error, "反馈列表加载失败，请稍后重试。"));
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [productFeedbackRepository, refreshStats]);

  useEffect(() => {
    void loadFeedback();
    return () => { listRequest.current += 1; statsRequest.current += 1; };
  }, [loadFeedback]);

  const refreshDetail = useCallback(async () => {
    if (!location.id) return null;
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError("");
    try {
      const result = await productFeedbackRepository.get(location.id);
      if (request !== detailRequest.current) return null;
      setSelectedFeedback(result);
      if (!result) setDetailError("这条反馈不存在，或你没有查看权限。");
      return result;
    } catch (error) {
      if (request === detailRequest.current) setDetailError(presentError(error, "反馈详情加载失败，请重试。"));
      return null;
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, [location.id, productFeedbackRepository]);

  useEffect(() => {
    setSelectedFeedback(null);
    setDetailError("");
    if (location.id) void refreshDetail();
    return () => { detailRequest.current += 1; };
  }, [location.id, refreshDetail]);

  const filteredRows = useMemo(() => {
    const scoped = rows.filter((feedback) => (
      (location.status === "all" || feedback.status === location.status)
      && (location.type === "all" || feedback.feedbackType === location.type)
      && (location.priority === "all" || (feedback.priority ?? "normal") === location.priority)
      && (location.assignee === "all" || (location.assignee === "unassigned" ? !feedback.assigneeUserId : feedback.assigneeUserId === location.assignee))
    ));
    return filterItems(scoped.map((feedback) => ({ ...feedback, submitterUserId: submitterLabel(feedback) })), location.query, productFeedbackSearchProfile);
  }, [location, rows]);

  const counts = stats ?? { total: rows.length, open: rows.filter((row) => row.status === "open").length, inProgress: rows.filter((row) => row.status === "in_progress").length, resolved: rows.filter((row) => row.status === "resolved").length, closed: rows.filter((row) => row.status === "closed").length };
  const countsUnavailable = !stats && rows.length === 0 && (loading || Boolean(errorMessage));
  const statusCounts = { open: counts.open, in_progress: counts.inProgress, resolved: counts.resolved, closed: counts.closed };
  const assigneeOptions = [...new Map(rows.filter((item) => item.assigneeUserId).map((item) => [item.assigneeUserId!, item.assignee?.name ?? "已分配成员"])).entries()];
  const hasActiveFilters = location.status !== "all" || location.type !== "all" || location.priority !== "all" || location.assignee !== "all" || location.query.trim() !== "";
  const resetFilters = () => changeLocation({ status: "all", type: "all", priority: "all", assignee: "all", query: "" });

  const recordMutation = async (updated: ProductFeedback) => {
    mutationVersion.current += 1;
    setRows((current) => current.some((item) => item.id === updated.id) ? current.map((item) => item.id === updated.id ? updated : item) : [updated, ...current]);
    setSelectedFeedback(updated);
    await refreshStats();
    return updated;
  };
  const updateFeedback = async (id: string, patch: ProductFeedbackUpdateInput) => recordMutation(await productFeedbackRepository.update(id, patch));
  const appendFeedbackProgress = async (id: string, input: ProductFeedbackAppendProgressInput) => {
    if (!productFeedbackRepository.appendProgress) throw new Error("当前环境暂不支持保存处理记录，请刷新后重试。");
    return recordMutation(await productFeedbackRepository.appendProgress(id, input));
  };

  const columns: Column<ProductFeedback>[] = [
    { key: "summary", header: "反馈内容", widthClass: "feedback-admin-summary-column", sortAccessor: (item) => item.description,
      render: (item) => <div className="feedback-admin-summary"><p className="feedback-admin-summary__title">{item.description.trim().split("\n")[0] || "未填写问题描述"}</p><p className="feedback-admin-summary__context"><span>{item.pageTitle}</span><span title={item.pagePath}>{item.pagePath}</span></p><p className="feedback-admin-summary__meta">{productFeedbackTypeLabels[item.feedbackType]}<span>·</span>{item.attachments.length ? `${item.attachments.length} 张截图` : "无附件"}</p></div> },
    { key: "status", header: "状态", widthClass: "feedback-admin-status-column", render: (item) => <FeedbackStatusBadge status={item.status} resolutionCode={item.resolutionCode} />, sortAccessor: (item) => item.status },
    { key: "triage", header: "分诊", widthClass: "feedback-admin-triage-column", sortAccessor: (item) => ({ low: 0, normal: 1, high: 2 })[item.priority ?? "normal"], render: (item) => <div className="feedback-admin-triage-cell"><span data-priority={item.priority ?? "normal"}>{priorityLabels[item.priority ?? "normal"]}优先级</span><span>{item.assignee?.name ?? "未分配负责人"}</span></div> },
    { key: "submitter", header: "提交人", widthClass: "feedback-admin-person-column", render: (item) => <span className="feedback-admin-person">{submitterLabel(item)}</span>, sortAccessor: submitterLabel },
    { key: "updatedAt", header: "最近更新", widthClass: "feedback-admin-date-column", render: (item) => <time className="text-xs text-muted-foreground" dateTime={item.updatedAt} title={formatAbsolute(item.updatedAt)}>{formatRelativeOrAbsolute(item.updatedAt)}</time>, sortAccessor: (item) => item.updatedAt }
  ];

  return <div className="feedback-admin-page">
    <div ref={inboxRef} className="feedback-admin-inbox" hidden={Boolean(location.id)}>
    <div className="feedback-admin-overview" role="group" aria-label="按反馈状态筛选"><button type="button" aria-label={`全部反馈 ${countsUnavailable ? "数量待加载" : counts.total}`} aria-pressed={location.status === "all"} onClick={() => changeLocation({ status: "all" })}><span>全部反馈</span><strong>{countsUnavailable ? "—" : counts.total}</strong></button>{productFeedbackStatuses.map((status) => <button key={status} type="button" aria-label={`${productFeedbackStatusLabels[status]} ${countsUnavailable ? "数量待加载" : statusCounts[status]}`} aria-pressed={location.status === status} onClick={() => changeLocation({ status })}><span>{productFeedbackStatusLabels[status]}</span><strong>{countsUnavailable ? "—" : statusCounts[status]}</strong></button>)}</div>
    {statsError ? <p className="feedback-admin-load-hint" role="status">{statsError}<Button variant="ghost" size="sm" onClick={() => void refreshStats()}>重试统计</Button></p> : null}
    <AdminListPage label="产品反馈记录"
      headerContent={<div><p className="feedback-admin-list-title">反馈工作台</p><p>先查看问题与证据，再同步进展、结论和后续安排。</p></div>}
      headerActions={<Button variant="outline" size="sm" onClick={() => void loadFeedback()} disabled={loading} aria-busy={loading || undefined}><RefreshCw data-icon="inline-start" />{loading ? "加载中…" : "刷新"}</Button>}
      notice={errorMessage ? <p role="alert" className="text-destructive">{errorMessage}<Button variant="ghost" size="sm" onClick={() => void loadFeedback()} disabled={loading}>重新加载</Button></p> : undefined}
      tableState={loading && rows.length === 0 ? <SectionSkeleton label="正在加载全部反馈" /> : undefined}
      table={{ ariaLabel: "产品反馈记录", rows: filteredRows, rowKey: (item) => item.id, columns, onRowClick: (item) => changeLocation({ id: item.id }), selectedRowKey: location.id ?? undefined, pageSize: 10 }}
      rowActions={(item) => ({ label: `反馈 ${item.id} 操作`, primaryAction: { id: "view", label: "查看", onSelect: () => changeLocation({ id: item.id }) }, items: [] })}
      filterBar={<>
        <SearchField className="feedback-admin-search" value={location.query} onValueChange={(query) => changeLocation({ query })} placeholder="搜索问题、页面或提交人" ariaLabel="搜索反馈" />
        <SelectControl<ProductFeedbackType | "all"> ariaLabel="类型筛选" value={location.type} onValueChange={(type) => changeLocation({ type })} size="filter" options={[{ value: "all", label: "全部类型" }, ...productFeedbackTypes.map((type) => ({ value: type, label: productFeedbackTypeLabels[type] }))]} />
        <SelectControl ariaLabel="优先级筛选" value={location.priority} onValueChange={(priority: typeof location.priority) => changeLocation({ priority })} size="filter" options={[{ value: "all", label: "全部优先级" }, { value: "low", label: "低优先级" }, { value: "normal", label: "普通优先级" }, { value: "high", label: "高优先级" }]} />
        <SelectControl ariaLabel="负责人筛选" value={location.assignee} onValueChange={(assignee) => changeLocation({ assignee })} size="filter" options={[{ value: "all", label: "全部负责人" }, { value: "unassigned", label: "未分配负责人" }, ...assigneeOptions.map(([value, label]) => ({ value, label })), ...(location.assignee !== "all" && location.assignee !== "unassigned" && !assigneeOptions.some(([id]) => id === location.assignee) ? [{ value: location.assignee, label: "所选负责人" }] : [])]} />
        {hasActiveFilters ? <Button variant="ghost" size="sm" onClick={resetFilters}>重置</Button> : null}<span className="feedback-admin-filter-count" aria-live="polite">显示 {filteredRows.length} / {rows.length} 条{loading && rows.length ? " · 正在更新" : ""}</span>
      </>}
      emptyState={{ message: errorMessage ? "反馈列表暂不可用" : hasActiveFilters ? "没有符合筛选条件的反馈" : "暂无产品反馈", actionLabel: errorMessage ? "重试列表" : hasActiveFilters ? "重置筛选" : "刷新", onAction: errorMessage ? () => void loadFeedback() : hasActiveFilters ? resetFilters : () => void loadFeedback() }}
    />
    </div>
    <FeedbackAdminDrawer feedback={selectedFeedback} open={Boolean(location.id)} onClose={() => changeLocation({ id: null })} onUpdate={updateFeedback} onAppendProgress={appendFeedbackProgress} onRefresh={refreshDetail} loading={detailLoading} loadError={detailError} listAssignees={productFeedbackRepository.listAssignees} getAttachmentObjectUrl={productFeedbackRepository.getAttachmentObjectUrl}
      onDeleteAttachment={productFeedbackRepository.deleteAttachment ? async (feedbackId, attachmentId) => recordMutation(await productFeedbackRepository.deleteAttachment!(feedbackId, attachmentId)) : undefined} />
  </div>;
}
