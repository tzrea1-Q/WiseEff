import { ChevronLeft, ChevronRight, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ColumnFilter } from "@/components/ColumnFilter";
import { HorizontalDragScroll } from "@/components/HorizontalDragScroll";
import { buildPathModuleFilterNodes } from "@/application/parameters/buildModuleFilterNodes";
import {
  collectTreeFilterSelectedDescendantIds,
  treeFilterNodePath,
  type TreeFilterNode
} from "@/domain/tree-filter/treeFilter";
import { paginateItems } from "@/domain/parameter-topology/moduleProvenance";

import { SpecReviewTaskDialog } from "./SpecReviewTaskDialog";
import {
  matchStatusLabel,
  nodeNameFromEvidence,
  type SpecReviewApproveInput,
  type SpecReviewCandidate,
  type SpecReviewMatchStatus,
  type SpecReviewTaskView
} from "./specReviewShared";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ParamAdminEmptyState } from "@/components/parameter-admin-next/ParamAdminEmptyState";

export type {
  SpecReviewApproveInput,
  SpecReviewCandidate,
  SpecReviewMatchStatus,
  SpecReviewTaskView
} from "./specReviewShared";

export {
  matchStatusLabel,
  nodeNameFromEvidence,
  selectedSpec
} from "./specReviewShared";

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 50;
const MATCH_STATUS_VALUES: readonly SpecReviewMatchStatus[] = [
  PARAMETER_ADMIN_UI.matchUnmatched,
  PARAMETER_ADMIN_UI.matchAmbiguous,
  PARAMETER_ADMIN_UI.matchHasCandidates
];

export type SpecReviewQueueProps = {
  tasks: readonly SpecReviewTaskView[];
  librarySpecs?: readonly SpecReviewCandidate[];
  onApprove: (input: SpecReviewApproveInput) => void;
  onDismiss?: (input: { taskId: string; reason: string }) => void;
  onCreateSpec?: (input: {
    taskId: string;
    propertyKey: string;
    driverModule: string | null;
    reason: string;
  }) => void;
  pendingTaskId?: string | null;
  pendingAction?: "approve" | "dismiss" | "create" | null;
  /** Latest review-action failure; rendered inside the adjudication dialog. */
  actionError?: string | null;
  nextCursor?: string | null;
  /** Fetch the next server cursor page; used by 「下一页」 when local pages are exhausted. */
  onLoadMore?: () => void | Promise<void>;
  loadingMore?: boolean;
  /** Optional shared module taxonomy; absent tasks still render a path-aware tree of their modules. */
  moduleFilterNodes?: readonly TreeFilterNode[];
};

type QueueFilters = {
  q: string;
  driverModules: string[];
  matchStatuses: SpecReviewMatchStatus[];
};

const EMPTY_FILTERS: QueueFilters = {
  q: "",
  driverModules: [],
  matchStatuses: []
};

function toggleSelected(selected: readonly string[], value: string): string[] {
  return selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
}

function moduleFilterIdsForValues(nodes: readonly TreeFilterNode[], values: readonly string[]): string[] {
  const selectedIds = new Set<string>();
  for (const value of values) {
    for (const node of nodes) {
      if (node.id === value || node.label === value || treeFilterNodePath(node) === value) {
        selectedIds.add(node.id);
      }
    }
  }
  return [...selectedIds];
}

function filterTasks(
  tasks: readonly SpecReviewTaskView[],
  filters: QueueFilters,
  moduleFilterNodes: readonly TreeFilterNode[]
): SpecReviewTaskView[] {
  const query = filters.q.trim().toLowerCase();
  const selectedModuleIds = moduleFilterIdsForValues(moduleFilterNodes, filters.driverModules);
  const allowedModuleIds = collectTreeFilterSelectedDescendantIds(moduleFilterNodes, selectedModuleIds);
  return tasks.filter((task) => {
    if (filters.driverModules.length > 0) {
      const driver = task.driverModule?.trim() || "";
      const matchingNodeIds = moduleFilterNodes
        .filter((node) => node.label === driver || treeFilterNodePath(node) === driver)
        .map((node) => node.id);
      if (
        !filters.driverModules.includes(driver) &&
        !matchingNodeIds.some((nodeId) => allowedModuleIds.has(nodeId))
      ) return false;
    }
    if (filters.matchStatuses.length > 0) {
      if (!filters.matchStatuses.includes(matchStatusLabel(task))) return false;
    }
    if (!query) return true;
    const nodeName = nodeNameFromEvidence(task.evidence) ?? "";
    return (
      task.propertyKey.toLowerCase().includes(query) ||
      nodeName.toLowerCase().includes(query) ||
      (task.driverModule ?? "").toLowerCase().includes(query)
    );
  });
}

/**
 * Spec-review queue — same table shell as ParameterSpecLibrary
 * (search, ColumnFilter, client pagination, pencil → adjudication dialog).
 */
export function SpecReviewQueue({
  tasks,
  librarySpecs = [],
  onApprove,
  onDismiss,
  onCreateSpec,
  pendingTaskId = null,
  pendingAction = null,
  actionError = null,
  nextCursor = null,
  onLoadMore,
  loadingMore = false,
  moduleFilterNodes: providedModuleFilterNodes
}: SpecReviewQueueProps) {
  const [filters, setFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(DEFAULT_PAGE_SIZE);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [advanceAfterLoad, setAdvanceAfterLoad] = useState(false);

  const moduleFilterNodes = useMemo(
    () =>
      providedModuleFilterNodes ??
      buildPathModuleFilterNodes(
        tasks.map((task) => ({
          moduleName: task.driverModule?.trim() || "未归类"
        }))
      ),
    [providedModuleFilterNodes, tasks]
  );
  const selectedModuleTreeIds = useMemo(
    () => moduleFilterIdsForValues(moduleFilterNodes, filters.driverModules),
    [filters.driverModules, moduleFilterNodes]
  );
  const filtered = useMemo(
    () => filterTasks(tasks, filters, moduleFilterNodes),
    [moduleFilterNodes, tasks, filters]
  );
  const pagination = useMemo(() => paginateItems(filtered, page, pageSize), [filtered, page, pageSize]);

  const matchStatusValues = useMemo(() => {
    const present = new Set(tasks.map((task) => matchStatusLabel(task)));
    for (const selected of filters.matchStatuses) present.add(selected);
    return MATCH_STATUS_VALUES.filter((value) => present.has(value));
  }, [filters.matchStatuses, tasks]);

  const activeTask = useMemo(
    () => (activeTaskId ? tasks.find((task) => task.id === activeTaskId) ?? null : null),
    [activeTaskId, tasks]
  );

  const canGoNext =
    pagination.page < pagination.totalPages || Boolean(nextCursor && onLoadMore && !loadingMore);

  useEffect(() => {
    if (activeTaskId && !tasks.some((task) => task.id === activeTaskId)) {
      setActiveTaskId(null);
    }
  }, [activeTaskId, tasks]);

  useEffect(() => {
    if (!advanceAfterLoad || loadingMore) return;
    setAdvanceAfterLoad(false);
    setPage((current) => current + 1);
  }, [advanceAfterLoad, loadingMore, filtered.length]);

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const patchFilters = (next: QueueFilters | ((current: QueueFilters) => QueueFilters)) => {
    setFilters((current) => (typeof next === "function" ? next(current) : next));
    setPage(1);
  };

  const handlePageSizeChange = (nextSize: (typeof PAGE_SIZE_OPTIONS)[number]) => {
    setPageSize(nextSize);
    setPage(1);
  };

  const handleNextPage = () => {
    if (pagination.page < pagination.totalPages) {
      setPage((current) => current + 1);
      return;
    }
    if (!nextCursor || !onLoadMore || loadingMore) return;
    setAdvanceAfterLoad(true);
    void Promise.resolve(onLoadMore()).catch(() => {
      setAdvanceAfterLoad(false);
    });
  };

  const filtersActive =
    filters.q.trim().length > 0 || filters.driverModules.length > 0 || filters.matchStatuses.length > 0;

  return (
    <>
      <section
        className="parameters-table param-admin-library-table spec-review-queue"
        aria-label={PARAMETER_ADMIN_UI.specReviewQueue}
      >
        <div className="parameters-table-heading">
          <div>
            <h2>{PARAMETER_ADMIN_UI.specReviewQueue}</h2>
            <p>{PARAMETER_ADMIN_UI.specReviewQueueBlurb}</p>
          </div>
        </div>

        <div className="parameters-table-toolbar">
          <label className="parameters-table-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜索审核任务"
              type="search"
              value={filters.q}
              onChange={(event) => patchFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder="搜索参数名或节点"
            />
          </label>
          <div className="parameters-table-filters param-admin-library-filters">
            {filtersActive ? (
              <button aria-label="清除筛选" className="clear-filters" type="button" onClick={clearFilters}>
                清除筛选
              </button>
            ) : null}
          </div>
          <span className="parameters-table-count">
            {filtered.length} / {tasks.length} 项 · 第 {pagination.page} / {pagination.totalPages} 页
          </span>
        </div>

        <HorizontalDragScroll className="parameters-table-scroll">
          {/*
            No <colgroup>: with table-layout:fixed, display:none cells still reserve
            width via <col>, which left a large right gap when 所属模块 / 受影响项目 hide.
          */}
          <table className="parameters-table-grid param-admin-library-grid parameter-spec-library-grid spec-review-library-grid">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">参数名</th>
                <th scope="col">节点</th>
                <th scope="col">
                  <span className="param-admin-library-head-cell">
                    <span>所属模块</span>
                    <ColumnFilter
                      label="所属模块"
                      groupLabel="所属模块筛选"
                      mode="tree"
                      treeNodes={moduleFilterNodes}
                      selectedTreeIds={selectedModuleTreeIds}
                      treeSearchable
                      onTreeChange={(next) =>
                        patchFilters((current) => ({
                          ...current,
                          driverModules: next
                            .map((id) => moduleFilterNodes.find((node) => node.id === id))
                            .filter((node): node is TreeFilterNode => Boolean(node))
                            .map((node) => treeFilterNodePath(node))
                        }))
                      }
                      onClear={() => patchFilters((current) => ({ ...current, driverModules: [] }))}
                    />
                  </span>
                </th>
                <th scope="col">
                  <span className="param-admin-library-head-cell">
                    <span>匹配状态</span>
                    <ColumnFilter
                      label="匹配状态"
                      groupLabel="匹配状态筛选"
                      values={[...matchStatusValues]}
                      selectedValues={filters.matchStatuses}
                      onToggle={(value) =>
                        patchFilters((current) => ({
                          ...current,
                          matchStatuses: toggleSelected(current.matchStatuses, value) as SpecReviewMatchStatus[]
                        }))
                      }
                      onClear={() => patchFilters((current) => ({ ...current, matchStatuses: [] }))}
                    />
                  </span>
                </th>
                <th scope="col">受影响项目</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map((task, index) => {
                const nodeName = nodeNameFromEvidence(task.evidence);
                return (
                  <tr key={task.id} data-selected={activeTaskId === task.id ? "true" : undefined}>
                    <td data-label="#">
                      {(pagination.page - 1) * pagination.pageSize + index + 1}
                    </td>
                    <td data-label="参数名">
                      <strong>{task.propertyKey}</strong>
                    </td>
                    <td data-label="节点">{nodeName ?? "—"}</td>
                    <td data-label="所属模块">{task.driverModule ?? "—"}</td>
                    <td data-label="匹配状态">{matchStatusLabel(task)}</td>
                    <td data-label="受影响项目">{task.projectCount}</td>
                    <td data-label="操作">
                      <button
                        type="button"
                        className="button subtle dts-parameter-workbench-table__icon-action"
                        aria-label={`编辑 ${task.propertyKey}`}
                        title="编辑"
                        onClick={() => setActiveTaskId(task.id)}
                      >
                        <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </HorizontalDragScroll>

        {filtered.length > 0 ? (
          <div className="parameters-table-pagination param-admin-row-actions parameter-spec-library-pagination">
            <label className="parameter-spec-library-page-size">
              <span>每页</span>
              <select
                aria-label="每页条数"
                value={pageSize}
                onChange={(event) =>
                  handlePageSizeChange(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])
                }
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} 条
                  </option>
                ))}
              </select>
            </label>
            <div className="parameter-spec-library-page-nav" aria-label="翻页">
              <button
                type="button"
                className="parameter-spec-library-page-nav__btn"
                aria-label="上一页"
                disabled={pagination.page <= 1 || loadingMore}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
              </button>
              <span className="parameter-spec-library-page-nav__current" aria-live="polite">
                {loadingMore || advanceAfterLoad
                  ? "…"
                  : `${pagination.page} / ${pagination.totalPages}`}
              </span>
              <button
                type="button"
                className="parameter-spec-library-page-nav__btn"
                aria-label="下一页"
                disabled={!canGoNext}
                onClick={handleNextPage}
              >
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          tasks.length === 0 ? (
            <ParamAdminEmptyState message={PARAMETER_ADMIN_UI.specReviewEmpty} />
          ) : (
            <div className="parameters-table-empty">
              <p>{PARAMETER_ADMIN_UI.specReviewNoFilterMatch}</p>
              {filtersActive ? (
                <button type="button" className="button subtle" onClick={clearFilters}>
                  清除筛选条件
                </button>
              ) : null}
            </div>
          )
        ) : null}
      </section>

      {activeTask ? (
        <SpecReviewTaskDialog
          task={activeTask}
          librarySpecs={librarySpecs}
          onClose={() => setActiveTaskId(null)}
          onApprove={onApprove}
          onDismiss={onDismiss}
          onCreateSpec={onCreateSpec}
          pendingTaskId={pendingTaskId}
          pendingAction={pendingAction}
          error={actionError}
        />
      ) : null}
    </>
  );
}
