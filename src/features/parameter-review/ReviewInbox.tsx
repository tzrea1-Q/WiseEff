import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { PageProps } from "@/app/routes";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { buildParameterModuleFilterNodes } from "@/application/parameters/buildModuleFilterNodes";
import { ColumnFilter } from "@/components/ColumnFilter";
import { toggleFilterValue, uniqueFilterValues } from "@/components/tableFilterUtils";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabPanel } from "@/components/ui/tab-panel";
import { ViewSwitch } from "@/components/ui/view-switch";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { legacyModuleIdFromName } from "@/domain/modules/moduleTree";
import { collectTreeFilterSelectedDescendantIds } from "@/domain/tree-filter/treeFilter";
import { buildPowerManagementModuleTree } from "@/powerManagementConfig";
import { presentError } from "@/infrastructure/http/presentError";
import { CanonicalMemberRemovalReviewPanel } from "./CanonicalMemberRemovalReviewPanel";
import { CanonicalProjectValueReviewPanel } from "./CanonicalProjectValueReviewPanel";
import { canonicalStatusLabels } from "./canonicalSubmissionTracking";
import { useReviewQueueKeyboard } from "./useReviewQueueKeyboard";

export type ReviewInboxRow = {
  id: string;
  kind: "legacy" | "value" | "member";
  projectId: string;
  project: string;
  module: string;
  title: string;
  submitter: string;
  createdAt: string;
  status: string;
  view: "pending" | "history";
};

type Props = {
  projectId: string;
  repository?: ParameterCatalogRepository;
  state: PageProps["state"];
  search: string;
  mineOnly?: boolean;
  canReview?: boolean;
  legacyRows: ReviewInboxRow[];
  renderLegacyDetail: (row: ReviewInboxRow) => ReactNode;
  onLegacySelect?: (id: string | null, view: "pending" | "history") => void;
  onOpenLegacy?: (id: string) => void;
  renderRowSelection?: (row: ReviewInboxRow) => ReactNode;
  renderRowTitle?: (row: ReviewInboxRow) => ReactNode;
  selectAll?: ReactNode;
  queueActions?: ReactNode;
  onRequestsChanged?: () => void;
  loading?: boolean;
  error?: string | null;
  onVisibleLegacyIds?: (ids: string[]) => void;
};

const typeLabels = { all: "全部类型", value: "软件配置", member: "JSON 成员删除", legacy: "旧版请求" };

export function ReviewInbox({ projectId, repository, state, search, mineOnly = false, canReview = false,
  legacyRows, renderLegacyDetail, onLegacySelect, onOpenLegacy, renderRowSelection, renderRowTitle, selectAll, queueActions,
  onRequestsChanged, loading: legacyLoading = false, error: legacyError, onVisibleLegacyIds }: Props) {
  const [query, setQuery] = useState(search);
  const [canonicalProjection, setCanonicalProjection] = useState<{
    projectId: string; userId: string; rows: ReviewInboxRow[];
  } | null>(null);
  const [loading, setLoading] = useState(Boolean(repository));
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const tabsId = useId();
  const queueRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const params = useMemo(() => new URLSearchParams(query), [query]);
  const view = params.get("view") === "history" ? "history" : "pending";
  const rawType = params.get("type") ?? "all";
  const type = Object.hasOwn(typeLabels, rawType) ? rawType as keyof typeof typeLabels : "all";
  const requestedId = params.get("legacyRequest") || params.get("memberRequest") || params.get("request");
  const requestedKind = params.has("legacyRequest") ? "legacy" : params.has("memberRequest") ? "member" : null;
  const writeQuery = useCallback((next: URLSearchParams, replace = false) => {
    const value = next.toString();
    window.history[replace ? "replaceState" : "pushState"](null, "", `${window.location.pathname}${value ? `?${value}` : ""}`);
    setQuery(value);
  }, []);

  useEffect(() => { setQuery(search); setFilters({}); }, [search, projectId]);
  useEffect(() => {
    const restore = () => { setQuery(window.location.search); setFilters({}); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!repository || !projectId) { setCanonicalProjection(null); setLoading(false); return; }
    let cancelled = false;
    setCanonicalProjection(null);
    setLoading(true);
    setError(null);
    const scope = mineOnly ? { mine: true } : undefined;
    void Promise.all([
      repository.listProjectValueChangeRequests?.(projectId, scope).then((response) => response.items) ?? [],
      (mineOnly || canReview) ? repository.listProjectValueBatchChangeRequests?.(projectId, scope).then((response) => response.items) ?? [] : [],
      repository.listMemberRemovalRequests?.(projectId, scope).then((response) => response.items) ?? []
    ]).then(([values, batches, members]) => {
      if (cancelled) return;
      const project = state.configDraft.projects.find((item) => item.id === projectId)?.name ?? projectId;
      const userName = (id: string | null) => state.users.find((user) => user.id === id)?.name ?? id ?? "已注销用户";
      setCanonicalProjection({ projectId, userId: state.currentUserId, rows: [
        ...[...values, ...batches].map((request): ReviewInboxRow => ({ id: request.id, kind: "value", projectId, project,
          module: state.parameters.find((parameter) => parameter.id === `pbind:${"bindingId" in request ? request.bindingId : ""}`)?.module ?? "软件配置",
          title: request.reason, submitter: userName(request.submitterUserId), createdAt: request.createdAt ?? "",
          status: canonicalStatusLabels[request.status], view: request.status === "pending" ? "pending" : "history" })),
        ...members.map((request): ReviewInboxRow => ({ id: request.id, kind: "member", projectId, project,
          module: "JSON 成员删除", title: request.reason, submitter: userName(request.submitterUserId),
          createdAt: request.createdAt, status: canonicalStatusLabels[request.status], view: request.status === "pending" ? "pending" : "history" }))
      ] });
    }).catch((failure) => { if (!cancelled) setError(presentError(failure, "审核队列加载失败，请重试。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repository, projectId, mineOnly, canReview, state.currentUserId, state.configDraft.projects, state.users, state.parameters, refresh]);

  const canonicalRows = canonicalProjection?.projectId === projectId && canonicalProjection.userId === state.currentUserId
    ? canonicalProjection.rows : [];
  const allRows = [...canonicalRows, ...legacyRows];
  const scopedRows = allRows.filter((row) => row.view === view);
  const moduleRegistry = buildPowerManagementModuleTree(state.configDraft.parameterModules, scopedRows.map((row) => row.module));
  const moduleIdsByName = new Map(moduleRegistry.map((node) => [node.name, node.id]));
  const moduleNodes = buildParameterModuleFilterNodes(scopedRows.map((row) => {
    const parameter = state.parameters.find((item) => item.module === row.module);
    return { moduleId: moduleIdsByName.get(row.module) ?? parameter?.moduleId ?? legacyModuleIdFromName(row.module),
      moduleName: row.module, modulePath: parameter?.modulePath };
  }), moduleRegistry);
  const selectedModules = collectTreeFilterSelectedDescendantIds(moduleNodes, filters.module ?? []);
  const linked = requestedId ? allRows.find((row) => row.id === requestedId && (!requestedKind || row.kind === requestedKind)) : undefined;
  useEffect(() => {
    if (linked && (linked.view !== view || (type !== "all" && type !== linked.kind)
      || (linked.kind === "legacy" && params.get("request") === linked.id))) {
      const next = new URLSearchParams(query);
      next.set("view", linked.view);
      if (type !== "all" && type !== linked.kind) next.set("type", "all");
      if (linked.kind === "legacy") { next.delete("request"); next.set("legacyRequest", linked.id); }
      writeQuery(next, true);
    }
  }, [linked?.id, linked?.view, linked?.kind, view, type, params, query, writeQuery]);
  const visibleRows = scopedRows.filter((row) => (type === "all" || row.kind === type)
    && Object.entries(filters).every(([field, values]) => !values.length || (field === "module"
      ? selectedModules.has(moduleIdsByName.get(row.module) ?? legacyModuleIdFromName(row.module))
      : values.includes(row[field as keyof ReviewInboxRow]))))
    .sort((left, right) => view === "pending"
      ? (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0)
      : (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0));
  const contextProject = params.get("project");
  const contextModule = params.get("module");
  const selected = requestedId ? visibleRows.find((row) => row.id === requestedId && (!requestedKind || row.kind === requestedKind))
    : visibleRows.find((row) => (!contextProject || row.projectId === contextProject) && (!contextModule || row.module === contextModule)) ?? visibleRows[0];
  useEffect(() => {
    if (!selected || requestedId || loading || legacyLoading) return;
    const next = new URLSearchParams(query);
    next.set(selected.kind === "legacy" ? "legacyRequest" : "request", selected.id);
    next.set("view", selected.view);
    next.set("type", type);
    writeQuery(next, true);
  }, [selected?.id, selected?.kind, selected?.view, requestedId, loading, legacyLoading, query, type, writeQuery]);
  const visibleLegacyKey = visibleRows.filter((row) => row.kind === "legacy").map((row) => row.id).join("\n");
  useEffect(() => { onVisibleLegacyIds?.(visibleLegacyKey ? visibleLegacyKey.split("\n") : []); }, [visibleLegacyKey, onVisibleLegacyIds]);
  useEffect(() => {
    onLegacySelect?.(selected?.kind === "legacy" ? selected.id : null, view);
  }, [selected?.id, selected?.kind, view, projectId, state.currentUserId, onLegacySelect]);
  const select = (id: string) => {
    const row = visibleRows.find((item) => item.id === id);
    if (!row) return;
    const next = new URLSearchParams(query);
    next.delete("request"); next.delete("legacyRequest"); next.delete("memberRequest");
    next.set(row.kind === "legacy" ? "legacyRequest" : "request", id);
    next.set("view", view); next.set("type", type);
    writeQuery(next);
  };
  const changeContext = (key: "view" | "type", value: string) => {
    const next = new URLSearchParams(query);
    next.set(key, value);
    next.delete("request"); next.delete("legacyRequest"); next.delete("memberRequest");
    setFilters({});
    writeQuery(next);
  };
  const changed = () => { setRefresh((version) => version + 1); onRequestsChanged?.(); };
  useReviewQueueKeyboard({ enabled: true, rowIds: visibleRows.map((row) => row.id), selectedId: selected?.id ?? "", onSelect: select,
    onOpenSelected: () => { if (selected?.kind === "legacy" && onOpenLegacy) onOpenLegacy(selected.id); else detailRef.current?.focus(); }, queueRef, detailRef });
  const filtered = type !== "all" || Object.values(filters).some((values) => values.length);
  const filterSummary = [type === "all" ? "" : typeLabels[type],
    ...Object.entries(filters).filter(([, values]) => values.length).map(([field, values]) => {
      const label = ({ projectId: "项目", module: "模块", submitter: "提交人", status: "状态" } as Record<string, string>)[field];
      const names = values.map((value) => field === "projectId" ? allRows.find((row) => row.projectId === value)?.project ?? value
        : field === "module" ? moduleRegistry.find((node) => node.id === value)?.name ?? value : value);
      return `${label}：${names.join("、")}`;
    })].filter(Boolean).join(" · ");
  return <div className="review-inbox">
    <section className="review-queue" ref={queueRef} tabIndex={-1} aria-labelledby={`${tabsId}-queue-heading`}>
      <h2 id={`${tabsId}-queue-heading`} className="sr-only">审阅队列</h2>
      <div className="review-inbox__toolbar">
        <ViewSwitch variant="tabs" ariaLabel="审阅视角" value={view} onValueChange={(value) => changeContext("view", value)} items={[
          { value: "pending", label: <>待处理<span aria-hidden="true">{allRows.filter((row) => row.view === "pending").length}</span></>, id: `${tabsId}-pending-tab`, panelId: `${tabsId}-pending-panel` },
          { value: "history", label: <>已处理<span aria-hidden="true">{allRows.filter((row) => row.view === "history").length}</span></>, id: `${tabsId}-history-tab`, panelId: `${tabsId}-history-panel` }
        ]} />
        <label>变更类型<select className="compact-filter-control" aria-label="变更类型" value={type} onChange={(event) => changeContext("type", event.target.value)}>
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <TabPanel id={`${tabsId}-${view}-panel`} aria-labelledby={`${tabsId}-${view}-tab`}>
        {error || legacyError ? <SectionError message={error ?? legacyError ?? ""} onRetry={changed} /> : null}
        {loading || legacyLoading ? <SectionSkeleton label="正在加载审核队列…" /> : null}
        {view === "pending" && visibleRows.some((row) => row.kind === "legacy") ? queueActions : null}
        <div className="table-wrap review-table-wrap"><Table aria-label="审阅队列" id="review-queue-table"><TableHeader><TableRow>
          {renderRowSelection ? <TableHead>{selectAll}</TableHead> : null}
          <TableHead>类型</TableHead>
          {([ ["projectId", "项目"], ["module", "模块"], ["submitter", "提交人"] ] as const).map(([field, label]) => <TableHead key={field}>
            <div className="review-column-filter-head"><span>{label}</span>{field === "module" ? <ColumnFilter label={label} groupLabel={`${label}筛选`}
              mode="tree" treeNodes={moduleNodes} treeSearchable selectedTreeIds={filters.module ?? []}
              onTreeChange={(values) => setFilters((current) => ({ ...current, module: values }))}
              onClear={() => setFilters((current) => ({ ...current, module: [] }))} /> : <ColumnFilter label={label} groupLabel={`${label}筛选`}
              values={uniqueFilterValues(scopedRows, (row) => row[field]).filter(Boolean)} selectedValues={filters[field] ?? []}
              renderLabel={field === "projectId" ? (id) => {
                const name = allRows.find((row) => row.projectId === id)?.project ?? id;
                return allRows.some((row) => row.project === name && row.projectId !== id) ? `${name}（${id}）` : name;
              } : undefined}
              onToggle={(value) => setFilters((current) => ({ ...current, [field]: toggleFilterValue(current[field] ?? [], value) }))}
              onClear={() => setFilters((current) => ({ ...current, [field]: [] }))} />}</div></TableHead>)}
          <TableHead>变更</TableHead><TableHead>提交时间</TableHead><TableHead><div className="review-column-filter-head"><span>状态</span>
            <ColumnFilter label="状态" groupLabel="状态筛选" values={uniqueFilterValues(scopedRows, (row) => row.status)} selectedValues={filters.status ?? []}
              onToggle={(value) => setFilters((current) => ({ ...current, status: toggleFilterValue(current.status ?? [], value) }))}
              onClear={() => setFilters((current) => ({ ...current, status: [] }))} /></div></TableHead>
        </TableRow></TableHeader><TableBody>{visibleRows.map((row) => <TableRow key={`${row.kind}:${row.id}`} data-review-row-id={row.id}
          aria-selected={selected?.id === row.id} tabIndex={selected?.id === row.id ? 0 : -1} className={selected?.id === row.id ? "selected-row" : ""}
          onClick={() => select(row.id)} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); select(row.id); } }}>
          {renderRowSelection ? <TableCell>{renderRowSelection(row)}</TableCell> : null}
          <TableCell><span className="review-inbox__chip">{row.kind === "legacy" ? "旧版" : typeLabels[row.kind]}</span></TableCell>
          <TableCell>{row.project}</TableCell><TableCell>{row.module}</TableCell><TableCell>{row.submitter}</TableCell>
          <TableCell className="change-cell"><Button type="button" variant="ghost" className="value-change value-change-button" aria-label={`查看 ${row.title} 提交详情`} onClick={(event) => {
            event.stopPropagation(); select(row.id); if (row.kind === "legacy") onOpenLegacy?.(row.id);
          }}>{renderRowTitle?.(row) ?? row.title}</Button></TableCell>
          <TableCell>{row.createdAt ? <time dateTime={row.createdAt} title={formatAbsolute(row.createdAt)}>{formatRelativeOrAbsolute(row.createdAt)}</time> : "提交时间未记录"}</TableCell>
          <TableCell>{row.status}</TableCell>
        </TableRow>)}</TableBody></Table></div>
        {!visibleRows.length && !loading && !legacyLoading && !error && !legacyError ? <>
          <SectionEmpty message={filtered ? `${filterSummary}筛选下暂无请求` : view === "pending" ? "暂无待审核请求" : "暂无已处理记录"}
            actionLabel={filtered ? "清除筛选" : view === "pending" ? "查看已处理记录" : undefined}
            onAction={filtered ? () => changeContext("type", "all") : () => changeContext("view", "history")} />
          <p>{view === "pending" ? "项目成员提交软件配置、JSON 成员删除或旧版变更后，请求会出现在这里。" : "已批准、驳回或撤回的请求会保留在这里。"}</p>
        </> : null}
      </TabPanel>
      <div role="tabpanel" id={`${tabsId}-${view === "pending" ? "history" : "pending"}-panel`}
        aria-labelledby={`${tabsId}-${view === "pending" ? "history" : "pending"}-tab`} hidden />
    </section>
    {selected ? <aside className="review-detail" ref={detailRef} tabIndex={-1} aria-labelledby={`${tabsId}-detail-heading`}>
      <h2 id={`${tabsId}-detail-heading`} className="sr-only">审阅详情</h2>
      {selected.kind === "legacy" ? renderLegacyDetail(selected) : selected.kind === "value" ? <CanonicalProjectValueReviewPanel
        key={`${projectId}:${selected.id}`} projectId={projectId} repository={repository} currentUserId={state.currentUserId} canReview={canReview}
        mineOnly={mineOnly} initialRequestId={selected.id} detailOnly externalView={view} users={state.users} onRequestsChanged={changed}
        onSelectRequest={(id) => { if (id) select(id); }} /> : <CanonicalMemberRemovalReviewPanel key={`${projectId}:${selected.id}`}
          projectId={projectId} repository={repository} currentUserId={state.currentUserId} canReview={canReview} mineOnly={mineOnly}
          initialRequestId={selected.id} detailOnly externalView={view} users={state.users} onRequestsChanged={changed} onSelectRequest={select} />}
    </aside> : requestedId && !loading && !legacyLoading ? <p role="alert">请求不存在或不在当前队列中，未选择其他请求。</p> : null}
  </div>;
}
