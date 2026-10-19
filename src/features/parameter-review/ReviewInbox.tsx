import { SelectControl } from "@/components/common/SelectControl";
import { SearchField } from "@/components/common/SearchField";
import { RefreshCw, ArrowRight, Inbox, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { PageProps } from "@/app/routes";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
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
import { matchesProfile, type SearchProfile } from "@/lib/search";
import { CanonicalMemberRemovalReviewPanel } from "./CanonicalMemberRemovalReviewPanel";
import { CanonicalProjectValueReviewPanel } from "./CanonicalProjectValueReviewPanel";
import { canonicalStatusLabels } from "./canonicalSubmissionTracking";
import { useReviewQueueKeyboard } from "./useReviewQueueKeyboard";
import { SourceRevisionReviewPanel } from "./SourceRevisionReviewPanel";

export type ReviewInboxRow = {
  id: string;
  kind: "legacy" | "value" | "member" | "source";
  typeLabel?: string;
  projectId: string;
  project: string;
  module: string;
  title: string;
  submitter: string;
  createdAt: string;
  handledAt?: string;
  handledBy?: string;
  assignedToId?: string | null;
  assignedTo?: string;
  objectLabel?: string;
  changeSummary?: string;
  status: string;
  view: "pending" | "history";
};

type Props = {
  projectId: string;
  repository?: ParameterCatalogRepository;
  sourceRepository?: ParameterFileRepository;
  state: PageProps["state"];
  search: string;
  mineOnly?: boolean;
  canReview?: boolean;
  legacyRows: ReviewInboxRow[];
  renderLegacyDetail: (row: ReviewInboxRow) => ReactNode;
  onLegacySelect?: (id: string | null, view: "pending" | "history") => void;
  renderRowSelection?: (row: ReviewInboxRow) => ReactNode;
  renderRowTitle?: (row: ReviewInboxRow) => ReactNode;
  selectAll?: ReactNode;
  queueActions?: ReactNode;
  onRequestsChanged?: () => void;
  loading?: boolean;
  error?: string | null;
  onVisibleLegacyIds?: (ids: string[]) => void;
  onNavigate?: (path: string) => void;
  busy?: boolean;
};

const typeLabels = { all: "全部类型", value: "软件配置", source: "DTS 来源修改", member: "配置文件移除", legacy: "参数与节点" };
const searchProfile: SearchProfile<ReviewInboxRow> = { fields: [
  { name: "request", weight: 5, getValues: (row) => [row.id, row.title, row.objectLabel, row.changeSummary] },
  { name: "context", weight: 2, getValues: (row) => [row.project, row.module, row.submitter, row.assignedTo, row.status] }
] };

export function ReviewInbox({ projectId, repository, sourceRepository, state, search, mineOnly = false, canReview = false,
  legacyRows, renderLegacyDetail, onLegacySelect, renderRowSelection, renderRowTitle, selectAll, queueActions,
  onRequestsChanged, loading: legacyLoading = false, error: legacyError, onVisibleLegacyIds, onNavigate, busy = false }: Props) {
  const [query, setQuery] = useState(search);
  const [refresh, setRefresh] = useState(0);
  const identityScope = useMemo(() => ({ repository, sourceRepository, projectId, mineOnly, canReview, userId: state.currentUserId, roleId: state.activeRoleId }),
    [repository, sourceRepository, projectId, mineOnly, canReview, state.currentUserId, state.activeRoleId]);
  const loadScope = useMemo(() => ({ ...identityScope, identity: identityScope,
    projects: state.configDraft.projects, users: state.users, parameters: state.parameters, refresh
  }), [identityScope, state.configDraft.projects, state.users, state.parameters, refresh]);
  const [canonicalProjection, setCanonicalProjection] = useState<{
    scope: typeof loadScope; rows: ReviewInboxRow[]; error: string | null;
  } | null>(null);
  const currentProjection = canonicalProjection?.scope.identity === identityScope ? canonicalProjection : null;
  const loading = Boolean(repository && projectId && currentProjection?.scope !== loadScope);
  const error = currentProjection?.error ?? null;
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [searchText, setSearchText] = useState("");
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [detailBusy, setDetailBusy] = useState(false);
  const interactionBusy = busy || detailBusy;
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

  useEffect(() => { setQuery(search); setFilters({}); setSearchText(""); setAssignedOnly(false); }, [search, identityScope]);
  useEffect(() => {
    const restore = () => { setQuery(window.location.search); setFilters({}); setSearchText(""); setAssignedOnly(false); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    const { repository, projectId, mineOnly, canReview, projects, users, parameters } = loadScope;
    if (!repository || !projectId) return;
    let cancelled = false;
    const scope = mineOnly ? { mine: true } : undefined;
    void Promise.all([
      repository.listProjectValueChangeRequests?.(projectId, scope).then((response) => response.items) ?? [],
      (mineOnly || canReview) ? repository.listProjectValueBatchChangeRequests?.(projectId, scope).then((response) => response.items) ?? [] : [],
      repository.listMemberRemovalRequests?.(projectId, scope).then((response) => response.items) ?? [],
      sourceRepository?.listSourceRevisionRequests?.(projectId, scope) ?? []
    ]).then(([values, batches, members, sources]) => {
      if (cancelled) return;
      const project = projects.find((item) => item.id === projectId)?.name ?? projectId;
      const userName = (id: string | null) => id === null ? "已注销用户" : users.find((user) => user.id === id)?.name ?? "项目成员";
      setCanonicalProjection({ scope: loadScope, error: null, rows: [
        ...sources.map((request): ReviewInboxRow => ({ id: request.id, kind: "source", projectId, project,
          module: "配置文件", objectLabel: request.fileName, changeSummary: `${request.impact.parameterChanges} 项参数变化 · DTS 来源修改`,
          title: request.reason, submitter: request.submitterName ?? userName(request.submitterUserId),
          assignedToId: request.assignedToUserId,
          assignedTo: request.assignedToName ?? userName(request.assignedToUserId),
          createdAt: request.createdAt, handledAt: request.status === "pending" ? undefined : request.updatedAt,
          handledBy: request.status === "withdrawn" ? request.submitterName ?? userName(request.submitterUserId)
            : request.reviewerUserId ? request.reviewerName ?? userName(request.reviewerUserId) : undefined,
          status: canonicalStatusLabels[request.status], view: request.status === "pending" ? "pending" : "history" })),
        ...[...values, ...batches].map((request): ReviewInboxRow => {
          const parameter = "bindingId" in request ? parameters.find((item) => item.id === request.bindingId) : undefined;
          return { id: request.id, kind: "value", projectId, project,
            module: parameter?.module || "软件配置",
            objectLabel: parameter?.name || ("targets" in request ? `${request.targets.length} 项来源变更` : "参数变更"),
            changeSummary: "targets" in request ? "整批审核与应用" : request.action === "delete" ? "删除属性"
              : `目标值 ${request.targetValue}${parameter?.unit ? ` ${parameter.unit}` : ""}`,
            title: request.reason, submitter: request.submitterName ?? userName(request.submitterUserId),
            assignedToId: request.assignedToUserId,
            assignedTo: request.assignedToName ?? (request.assignedToUserId ? userName(request.assignedToUserId) : "项目审核人"),
            createdAt: request.createdAt ?? "", handledAt: request.status === "pending" ? undefined : request.updatedAt,
            handledBy: request.status === "withdrawn" ? request.submitterName ?? userName(request.submitterUserId)
              : request.reviewerUserId ? request.reviewerName ?? userName(request.reviewerUserId) : undefined,
            status: canonicalStatusLabels[request.status], view: request.status === "pending" ? "pending" : "history" };
        }),
        ...members.map((request): ReviewInboxRow => ({ id: request.id, kind: "member", projectId, project,
          module: "配置文件", title: request.reason, submitter: request.submitterName ?? userName(request.submitterUserId),
          objectLabel: request.frozenProof?.members.find((member) => member.fileId === request.fileId)?.sourceName,
          changeSummary: request.frozenProof ? `移除 1 个文件 · 保留 ${request.frozenProof.members.length - 1} 个文件` : "从配置移除文件",
          assignedToId: request.assignedToUserId,
          assignedTo: request.assignedToName ?? (request.assignedToUserId ? userName(request.assignedToUserId) : "项目审核人"),
          handledAt: request.status === "pending" ? undefined : request.updatedAt,
          handledBy: request.status === "withdrawn" ? request.submitterName ?? userName(request.submitterUserId)
            : request.reviewerUserId ? request.reviewerName ?? userName(request.reviewerUserId) : undefined,
          createdAt: request.createdAt, status: canonicalStatusLabels[request.status], view: request.status === "pending" ? "pending" : "history" }))
      ] });
    }).catch((failure) => {
      if (!cancelled) setCanonicalProjection((previous) => ({ scope: loadScope,
        rows: previous?.scope.identity === identityScope ? previous.rows : [],
        error: presentError(failure, "审核队列加载失败，请重试。") }));
    });
    return () => { cancelled = true; };
  }, [loadScope, identityScope]);

  const canonicalRows = currentProjection?.rows ?? [];
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
  const linkedId = linked?.id;
  const linkedView = linked?.view;
  const linkedKind = linked?.kind;
  useEffect(() => {
    if (linkedId && linkedView && (linkedView !== view || (type !== "all" && type !== linkedKind)
      || (linkedKind === "legacy" && params.get("request") === linkedId))) {
      const next = new URLSearchParams(query);
      next.set("view", linkedView);
      if (type !== "all" && type !== linkedKind) next.set("type", "all");
      if (linkedKind === "legacy") { next.delete("request"); next.set("legacyRequest", linkedId); }
      writeQuery(next, true);
    }
  }, [linkedId, linkedView, linkedKind, view, type, params, query, writeQuery]);
  const visibleRows = scopedRows.filter((row) => (type === "all" || row.kind === type)
    && (view !== "pending" || !assignedOnly || row.assignedToId === state.currentUserId)
    && matchesProfile(row, searchText, searchProfile)
    && Object.entries(filters).every(([field, values]) => !values.length || (field === "module"
      ? selectedModules.has(moduleIdsByName.get(row.module) ?? legacyModuleIdFromName(row.module))
      : values.includes(String(row[field as keyof ReviewInboxRow] ?? "")))))
    .sort((left, right) => view === "pending"
      ? (Date.parse(left.createdAt) || 0) - (Date.parse(right.createdAt) || 0)
      : (Date.parse(right.handledAt || right.createdAt) || 0) - (Date.parse(left.handledAt || left.createdAt) || 0));
  const contextProject = params.get("project");
  const contextModule = params.get("module");
  const selected = requestedId ? visibleRows.find((row) => row.id === requestedId && (!requestedKind || row.kind === requestedKind))
    : visibleRows.find((row) => (!contextProject || row.projectId === contextProject) && (!contextModule || row.module === contextModule)) ?? visibleRows[0];
  const selectedId = selected?.id;
  const selectedKind = selected?.kind;
  const selectedView = selected?.view;
  const hiddenSelection = Boolean(linked && !selected && linked.view === view);
  useEffect(() => {
    if (!selectedId || !selectedView || requestedId || loading || legacyLoading) return;
    const next = new URLSearchParams(query);
    next.set(selectedKind === "legacy" ? "legacyRequest" : "request", selectedId);
    next.set("view", selectedView);
    next.set("type", type);
    writeQuery(next, true);
  }, [selectedId, selectedKind, selectedView, requestedId, loading, legacyLoading, query, type, writeQuery]);
  const visibleLegacyKey = visibleRows.filter((row) => row.kind === "legacy").map((row) => row.id).join("\n");
  useEffect(() => { onVisibleLegacyIds?.(visibleLegacyKey ? visibleLegacyKey.split("\n") : []); }, [visibleLegacyKey, onVisibleLegacyIds]);
  useEffect(() => {
    onLegacySelect?.(selected?.kind === "legacy" ? selected.id : null, view);
  }, [selected?.id, selected?.kind, view, projectId, state.currentUserId, onLegacySelect]);
  const select = (id: string) => {
    if (interactionBusy) return;
    const row = visibleRows.find((item) => item.id === id);
    if (!row) return;
    const next = new URLSearchParams(query);
    next.delete("request"); next.delete("legacyRequest"); next.delete("memberRequest");
    next.set(row.kind === "legacy" ? "legacyRequest" : "request", id);
    next.set("view", view); next.set("type", type);
    writeQuery(next);
  };
  const changeContext = (key: "view" | "type", value: string) => {
    if (interactionBusy) return;
    const next = new URLSearchParams(query);
    next.set(key, value);
    next.delete("request"); next.delete("legacyRequest"); next.delete("memberRequest");
    setFilters({});
    if (key === "view") setAssignedOnly(false);
    writeQuery(next);
  };
  const changed = () => { setRefresh((version) => version + 1); setDetailRefresh((version) => version + 1); onRequestsChanged?.(); };
  useReviewQueueKeyboard({ enabled: !interactionBusy, rowIds: visibleRows.map((row) => row.id), selectedId: selected?.id ?? "", onSelect: select,
    onOpenSelected: () => detailRef.current?.focus(), queueRef, detailRef });
  const filtered = type !== "all" || (view === "pending" && assignedOnly) || Boolean(searchText.trim()) || Object.values(filters).some((values) => values.length);
  const clearFilters = () => {
    if (interactionBusy) return;
    setSearchText(""); setAssignedOnly(false); setFilters({});
    const next = new URLSearchParams(query);
    next.set("type", "all");
    writeQuery(next);
  };
  const reading = loading || legacyLoading;
  const incomplete = Boolean(error || legacyError);
  const hasRecords = allRows.length > 0;
  const historyCount = allRows.filter((row) => row.view === "history").length;
  const filterValues = {
    submitter: uniqueFilterValues(scopedRows, (row) => row.submitter),
    status: uniqueFilterValues(scopedRows, (row) => row.status)
  };
  const appliedFilters = Object.entries(filters).flatMap(([field, values]) => values.map((value) => ({ field, value,
    label: field === "projectId" ? allRows.find((row) => row.projectId === value)?.project ?? value
      : field === "module" ? moduleRegistry.find((node) => node.id === value)?.name ?? value : value })));
  const queueLabel = mineOnly ? "我的提交" : "审阅队列";
  return <div className={`review-inbox${selected || requestedId ? "" : " review-inbox--empty review-inbox--list-only"}${mineOnly ? " review-inbox--personal" : ""}`}>
      <div className="review-inbox__toolbar">
        <ViewSwitch variant="tabs" ariaLabel={mineOnly ? "提交状态" : "审阅视角"} value={view} onValueChange={(value) => changeContext("view", value)} items={[
          { value: "pending", label: <>{mineOnly ? "审核中" : "待处理"}<span aria-hidden="true">{reading ? "…" : incomplete ? "—" : allRows.filter((row) => row.view === "pending").length}</span></>, id: `${tabsId}-pending-tab`, panelId: `${tabsId}-pending-panel`, disabled: interactionBusy },
          { value: "history", label: <>{mineOnly ? "已结束" : "已处理"}<span aria-hidden="true">{reading ? "…" : incomplete ? "—" : historyCount}</span></>, id: `${tabsId}-history-tab`, panelId: `${tabsId}-history-panel`, disabled: interactionBusy }
        ]} />
        <div className="review-inbox__toolbar-actions">
          <Button type="button" variant="outline" size="sm" disabled={interactionBusy || loading || legacyLoading} onClick={changed}>
            <RefreshCw size={14} aria-hidden="true" />{loading || legacyLoading ? "刷新中…" : "刷新队列"}
          </Button>
        </div>
      </div>
      {hasRecords || filtered ? <div className="review-inbox__filters">
        <SearchField value={searchText} onValueChange={setSearchText} disabled={interactionBusy} ariaLabel="搜索审阅请求" placeholder="搜索变更、原因或提交人" />
        {!mineOnly && view === "pending" ? <label className="review-inbox__assigned"><input type="checkbox" disabled={interactionBusy} checked={assignedOnly}
          onChange={(event) => setAssignedOnly(event.target.checked)} />待我处理</label> : null}
        <Button type="button" variant="ghost" size="sm" aria-expanded={filtersOpen} aria-controls={`${tabsId}-filters`} disabled={interactionBusy} onClick={() => setFiltersOpen((open) => !open)}>
          <SlidersHorizontal size={14} aria-hidden="true" />筛选
        </Button>
        {filtered || reading || incomplete ? <span className="review-inbox__count" role="status">{reading ? "正在加载…" : incomplete ? "部分结果" : `${visibleRows.length} 项 / ${scopedRows.length} 项`}</span> : null}
        <fieldset id={`${tabsId}-filters`} className="review-inbox__column-filters" disabled={interactionBusy} hidden={!filtersOpen}>
          <legend className="sr-only">按字段筛选</legend>
          <label>类型<SelectControl size="filter" disabled={interactionBusy} ariaLabel="变更类型" value={type} onValueChange={(value) => changeContext("type", value)}
            options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} /></label>
          {scopedRows.some((row) => row.projectId !== projectId) ? <div><span>项目</span><ColumnFilter label="项目" groupLabel="项目筛选"
            values={uniqueFilterValues(scopedRows, (row) => row.projectId)} selectedValues={filters.projectId ?? []}
            renderLabel={(id) => {
              const name = allRows.find((row) => row.projectId === id)?.project ?? id;
              return allRows.some((row) => row.project === name && row.projectId !== id) ? `${name}（${id}）` : name;
            }}
            onToggle={(value) => setFilters((current) => ({ ...current, projectId: toggleFilterValue(current.projectId ?? [], value) }))}
            onClear={() => setFilters((current) => ({ ...current, projectId: [] }))} /></div> : null}
          {new Set(scopedRows.map((row) => row.module)).size > 1 || filters.module?.length ? <div><span>模块</span><ColumnFilter label="模块" groupLabel="模块筛选" mode="tree" treeNodes={moduleNodes} treeSearchable selectedTreeIds={filters.module ?? []}
            onTreeChange={(values) => setFilters((current) => ({ ...current, module: values }))}
            onClear={() => setFilters((current) => ({ ...current, module: [] }))} /></div> : null}
          {!mineOnly && (filterValues.submitter.length > 1 || filters.submitter?.length) ? <div><span>提交人</span><ColumnFilter label="提交人" groupLabel="提交人筛选" values={filterValues.submitter}
            selectedValues={filters.submitter ?? []} onToggle={(value) => setFilters((current) => ({ ...current, submitter: toggleFilterValue(current.submitter ?? [], value) }))}
            onClear={() => setFilters((current) => ({ ...current, submitter: [] }))} /></div> : null}
          {filterValues.status.length > 1 || filters.status?.length ? <div><span>状态</span><ColumnFilter label="状态" groupLabel="状态筛选" values={filterValues.status} selectedValues={filters.status ?? []}
            onToggle={(value) => setFilters((current) => ({ ...current, status: toggleFilterValue(current.status ?? [], value) }))}
            onClear={() => setFilters((current) => ({ ...current, status: [] }))} /></div> : null}
        </fieldset>
        {filtered ? <div className="review-inbox__filter-summary" aria-label="已应用筛选">
          {type !== "all" ? <Button type="button" variant="outline" size="sm" disabled={interactionBusy} aria-label={`移除${typeLabels[type]}筛选`} onClick={() => {
            const next = new URLSearchParams(query); next.set("type", "all"); writeQuery(next);
          }}>{typeLabels[type]}<X size={12} aria-hidden="true" /></Button> : null}
          {appliedFilters.map(({ field, value, label }) => <Button key={`${field}:${value}`} type="button" variant="outline" size="sm" disabled={interactionBusy}
            aria-label={`移除${label}筛选`} onClick={() => setFilters((current) => ({ ...current, [field]: (current[field] ?? []).filter((item) => item !== value) }))}>{label}<X size={12} aria-hidden="true" /></Button>)}
          {visibleRows.length > 0 ? <Button type="button" variant="ghost" size="sm" disabled={interactionBusy} onClick={clearFilters}>清除筛选</Button> : null}
        </div> : null}
      </div> : null}
    <section className="review-queue" ref={queueRef} tabIndex={-1} aria-labelledby={`${tabsId}-queue-heading`}>
      <h2 id={`${tabsId}-queue-heading`} className="sr-only">{queueLabel}</h2>
      <TabPanel id={`${tabsId}-${view}-panel`} aria-labelledby={`${tabsId}-${view}-tab`}>
        {incomplete ? <SectionError message={`${canonicalRows.length && error ? "队列未能更新，以下为上次读取的结果。" : hasRecords ? "部分请求未能加载，以下结果不完整。" : ""}${error ?? legacyError ?? ""}`} onRetry={changed} /> : null}
        {loading || legacyLoading ? <SectionSkeleton label={mineOnly ? "正在加载我的提交…" : "正在加载审核队列…"} /> : null}
        {view === "pending" && visibleRows.some((row) => row.kind === "legacy") ? queueActions : null}
        {visibleRows.length ? <div className="table-wrap review-table-wrap"><Table aria-label={queueLabel} id="review-queue-table">
          <colgroup>
            {renderRowSelection ? <col className="review-inbox__selection-column" /> : null}
            <col className="review-inbox__summary-column" /><col className="review-inbox__time-column" /><col className="review-inbox__status-column" />
          </colgroup>
          <TableHeader><TableRow>
          {renderRowSelection ? <TableHead>{selectAll}</TableHead> : null}
          <TableHead>变更</TableHead><TableHead>{view === "history" ? "处理时间" : "提交时间"}</TableHead><TableHead>状态</TableHead>
        </TableRow></TableHeader><TableBody>{visibleRows.map((row) => <TableRow key={`${row.kind}:${row.id}`} data-review-row-id={row.id}
          aria-selected={selected?.id === row.id} tabIndex={selected?.id === row.id ? 0 : -1} className={selected?.id === row.id ? "selected-row" : ""}
          onClick={() => select(row.id)} onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault(); select(row.id);
              if (event.key === "Enter") detailRef.current?.focus();
            }
          }}>
          {renderRowSelection ? <TableCell>{renderRowSelection(row)}</TableCell> : null}
          <TableCell className="change-cell"><span className="review-inbox__summary"><Button type="button" variant="outline" size="sm" disabled={interactionBusy} className="review-inbox__detail-button" title={row.title} aria-label={`${row.objectLabel ? `${row.objectLabel}，` : ""}查看 ${row.title} 提交详情`} onClick={(event) => {
            event.stopPropagation(); select(row.id); detailRef.current?.focus();
          }}><span className="review-inbox__detail-label">{row.objectLabel ?? row.title}</span></Button>
            {row.objectLabel ? <span className="review-inbox__reason">{row.title}</span> : null}
            {row.kind === "legacy" && renderRowTitle ? <span className="review-inbox__change-preview">{renderRowTitle(row)}</span> : null}</span>
            {row.changeSummary ? <span className="review-inbox__value" title={row.changeSummary}>{row.changeSummary}</span> : null}
            <span className="review-inbox__row-meta"><span className="review-inbox__chip">{row.typeLabel ?? (row.kind === "legacy" ? "参数变更" : typeLabels[row.kind])}</span>
              {row.module && row.module !== typeLabels[row.kind === "legacy" ? "legacy" : row.kind] ? <span title={row.module}>{row.module}</span> : null}
              {row.projectId !== projectId ? <span title={row.project}>{row.project}</span> : null}
            </span>
            <span className="review-inbox__people" title={`提交人：${row.submitter}${row.view === "pending" && row.assignedTo ? `；指派给：${row.assignedTo}` : row.handledBy ? `；实际处理人：${row.handledBy}` : ""}`}>
              {mineOnly ? "我" : row.submitter}{row.view === "pending" && row.assignedTo ? <> <ArrowRight size={12} aria-hidden="true" /> {row.assignedTo}</> : row.handledBy ? <> · {row.handledBy} 处理</> : null}
            </span>
          </TableCell>
          <TableCell>{(view === "history" ? row.handledAt : row.createdAt) ? <time dateTime={view === "history" ? row.handledAt : row.createdAt}
            title={formatAbsolute((view === "history" ? row.handledAt : row.createdAt)!)}>{formatRelativeOrAbsolute((view === "history" ? row.handledAt : row.createdAt)!)}</time>
            : view === "history" ? "未记录" : "提交时间未记录"}</TableCell>
          <TableCell><span className="review-inbox__status" data-pending={row.view === "pending"}>{row.status}</span></TableCell>
        </TableRow>)}</TableBody></Table></div> : null}
        {!visibleRows.length && !loading && !legacyLoading && !error && !legacyError ? <div className="review-inbox__empty-table"><Table aria-label={queueLabel} id="review-queue-table"><TableBody><TableRow><TableCell>
          <Inbox size={28} aria-hidden="true" className="review-inbox__empty-icon" />
          <SectionEmpty message={filtered ? "没有符合当前筛选条件的请求" : view === "pending" ? mineOnly ? "暂无审核中的提交" : "暂无待审核请求" : mineOnly ? "暂无已处理提交" : "暂无已处理记录"}
            actionLabel={filtered ? "清除筛选" : view === "pending" && historyCount > 0 ? mineOnly ? "查看已处理提交" : "查看已处理记录" : undefined}
            onAction={filtered ? clearFilters : () => changeContext("view", "history")} />
          <p className="review-inbox__empty-description">{filtered ? "调整或清除筛选条件可查看其他请求。" : mineOnly ? view === "pending" ? "在项目参数工作台保存草稿并提交审核后，可在这里跟踪进度。" : "审核通过、被驳回或已撤回的提交会保留在这里。"
            : view === "pending" ? "当前项目暂无待审变更。" : "已批准、驳回或撤回的请求会保留在这里。"}</p>
          {mineOnly && onNavigate ? <Button type="button" size="sm" onClick={() => onNavigate(`/parameters?project=${encodeURIComponent(projectId)}`)}>前往参数修改</Button> : null}
        </TableCell></TableRow></TableBody></Table></div> : null}
      </TabPanel>
      <div role="tabpanel" id={`${tabsId}-${view === "pending" ? "history" : "pending"}-panel`}
        aria-labelledby={`${tabsId}-${view === "pending" ? "history" : "pending"}-tab`} hidden />
    </section>
    {selected ? <aside className="review-detail" ref={detailRef} tabIndex={-1} aria-labelledby={`${tabsId}-detail-heading`}>
      <h2 id={`${tabsId}-detail-heading`} className="sr-only">{mineOnly ? "提交详情" : "审阅详情"}</h2>
      <p className="review-inbox__detail-context sr-only">{selected.project} · {selected.typeLabel ?? typeLabels[selected.kind]}</p>
      {selected.kind === "source" && sourceRepository ? <SourceRevisionReviewPanel key={JSON.stringify([projectId, state.currentUserId, state.activeRoleId, mineOnly, canReview, selected.id])}
        projectId={projectId} requestId={selected.id} repository={sourceRepository} currentUserId={state.currentUserId} canReview={canReview}
        refreshVersion={detailRefresh} onRequestsChanged={changed} onBusyChange={setDetailBusy} />
      : selected.kind === "legacy" ? renderLegacyDetail(selected) : selected.kind === "value" ? <CanonicalProjectValueReviewPanel
        key={JSON.stringify([projectId, state.currentUserId, state.activeRoleId, mineOnly, canReview, selected.kind, selected.id])} refreshVersion={detailRefresh} projectId={projectId} repository={repository} currentUserId={state.currentUserId} canReview={canReview}
        mineOnly={mineOnly} initialRequestId={selected.id} detailOnly externalView={view} users={state.users} parameters={state.parameters} onRequestsChanged={changed} onBusyChange={setDetailBusy}
        onSelectRequest={(id) => { if (id) select(id); }} /> : <CanonicalMemberRemovalReviewPanel key={JSON.stringify([projectId, state.currentUserId, state.activeRoleId, mineOnly, canReview, selected.kind, selected.id])} refreshVersion={detailRefresh}
          projectId={projectId} repository={repository} currentUserId={state.currentUserId} canReview={canReview} mineOnly={mineOnly}
          initialRequestId={selected.id} detailOnly externalView={view} users={state.users} onRequestsChanged={changed} onSelectRequest={select} onBusyChange={setDetailBusy} />}
    </aside> : requestedId && !loading && !legacyLoading && !error && !legacyError ? <aside className="review-detail review-inbox__unselected">
      {hiddenSelection ? <><p role="status">当前请求被筛选条件隐藏，清除筛选后可继续查看。</p><Button type="button" variant="outline" onClick={clearFilters}>显示当前请求</Button></>
        : <><p role="alert">无法打开该请求，它可能已移出当前项目队列。</p><Button type="button" variant="outline" onClick={() => {
          const next = new URLSearchParams(query); next.delete("request"); next.delete("legacyRequest"); next.delete("memberRequest"); writeQuery(next);
        }}>返回当前项目队列</Button></>}
    </aside> : null}
  </div>;
}
