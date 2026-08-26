import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleX,
  Eye,
  Pencil,
  TriangleAlert
} from "lucide-react";

import { ColumnFilter } from "@/components/ColumnFilter";
import type { ModuleImportance } from "@/domain/parameter-topology/moduleRegistry";
import type { TreeFilterNode } from "@/domain/tree-filter/treeFilter";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

export type DtsWorkbenchSortKey = "propertyKey" | "importance";

export type DtsWorkbenchSort = {
  key: DtsWorkbenchSortKey;
  dir: "asc" | "desc";
};

export type DtsParameterWorkbenchTableProps = {
  rows: DtsParameterWorkbenchRow[];
  /** Legacy flat filter options for callers that have not migrated to tree mode. */
  moduleFilterOptions?: readonly string[];
  /** Legacy selected module names; empty means no column filter. */
  moduleFilterSelected?: readonly string[];
  onModuleFilterToggle?: (moduleName: string) => void;
  onModuleFilterClear?: () => void;
  /** Hierarchical module options and canonical selected root ids. */
  moduleFilterNodes?: readonly TreeFilterNode[];
  onModuleFilterChange?: (next: string[]) => void;
  selectedBindingId: string | null;
  draftBindingIds: ReadonlySet<string>;
  selectedBindingIds?: ReadonlySet<string>;
  canEdit: boolean;
  onSelectBinding: (bindingId: string) => void;
  onEditBinding?: (bindingId: string) => void;
  onSelectedBindingIdsChange?: (next: Set<string>) => void;
};

const governanceLabels = {
  attention: "待处理",
  blocked: "阻断"
} as const;

const importanceLabels: Record<ModuleImportance, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

const importanceRank: Record<ModuleImportance, number> = {
  high: 3,
  medium: 2,
  low: 1
};

function DeviceIdentity({ row }: { row: DtsParameterWorkbenchRow }) {
  return (
    <span className="dts-parameter-workbench-table__identity">
      <strong>{row.driverModule ?? row.compatible ?? "未关联驱动"}</strong>
      {row.instanceName ? <code>{row.instanceName}</code> : null}
      {row.compatible && row.compatible !== row.driverModule ? (
        <small>{row.compatible}</small>
      ) : null}
    </span>
  );
}

/** Importance is the primary signal; governance only surfaces actionable anomalies. */
function ImportanceCell({ row }: { row: DtsParameterWorkbenchRow }) {
  const anomaly =
    row.governanceState === "attention" || row.governanceState === "blocked"
      ? row.governanceState
      : null;

  return (
    <span className="dts-parameter-workbench-table__importance">
      <strong aria-label={`重要性：${importanceLabels[row.importance]}`}>
        {importanceLabels[row.importance]}
      </strong>
      {anomaly ? (
        <span
          className={`dts-parameter-workbench-table__governance-badge is-${anomaly}`}
          aria-label={`治理状态：${anomaly}`}
        >
          {anomaly === "attention" ? (
            <TriangleAlert size={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <CircleX size={13} strokeWidth={2} aria-hidden="true" />
          )}
          {governanceLabels[anomaly]}
        </span>
      ) : null}
    </span>
  );
}

function bindingActionContext(row: DtsParameterWorkbenchRow): string {
  const context = [row.moduleName, row.instanceName, row.driverModule]
    .filter((value): value is string => Boolean(value));
  return context.length > 0
    ? `${row.propertyKey}（${context.join(" · ")}）`
    : row.propertyKey;
}

function compareRows(
  left: DtsParameterWorkbenchRow,
  right: DtsParameterWorkbenchRow,
  sort: DtsWorkbenchSort
): number {
  let result = 0;
  switch (sort.key) {
    case "propertyKey":
      result = left.propertyKey.localeCompare(right.propertyKey, "zh-Hans-CN");
      break;
    case "importance":
      result = importanceRank[left.importance] - importanceRank[right.importance];
      break;
    default:
      result = 0;
  }
  return sort.dir === "asc" ? result : -result;
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort
}: {
  label: string;
  sortKey: DtsWorkbenchSortKey;
  sort: DtsWorkbenchSort | null;
  onSort: (key: DtsWorkbenchSortKey) => void;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      className={`dts-parameter-workbench-table__sort${active ? " is-active" : ""}`}
      aria-label={`按${label}排序`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/**
 * One semantic row structure serves both the desktop grid and the responsive card layout.
 * Primary columns stay business-first; DTS path / type stay out of the main grid.
 */
export function DtsParameterWorkbenchTable({
  rows,
  moduleFilterOptions,
  moduleFilterSelected: controlledModuleFilterSelected,
  onModuleFilterToggle,
  onModuleFilterClear,
  moduleFilterNodes,
  onModuleFilterChange,
  selectedBindingId,
  draftBindingIds,
  selectedBindingIds,
  canEdit,
  onSelectBinding,
  onEditBinding,
  onSelectedBindingIdsChange
}: DtsParameterWorkbenchTableProps) {
  const [sort, setSort] = useState<DtsWorkbenchSort | null>({
    key: "importance",
    dir: "desc"
  });
  const [uncontrolledModuleFilter, setUncontrolledModuleFilter] = useState<string[]>([]);
  const moduleFilterControlled =
    controlledModuleFilterSelected != null &&
    onModuleFilterToggle != null &&
    onModuleFilterClear != null;
  const treeModuleFilterControlled =
    moduleFilterNodes != null &&
    controlledModuleFilterSelected != null &&
    onModuleFilterChange != null;
  const moduleFilterSelected = useMemo(
    () => (treeModuleFilterControlled || moduleFilterControlled
      ? [...(controlledModuleFilterSelected ?? [])]
      : uncontrolledModuleFilter),
    [controlledModuleFilterSelected, moduleFilterControlled, treeModuleFilterControlled, uncontrolledModuleFilter]
  );
  const selectionEnabled = Boolean(onSelectedBindingIdsChange && selectedBindingIds);
  const draftRows = useMemo(
    () => rows.filter((row) => draftBindingIds.has(row.bindingId)),
    [draftBindingIds, rows]
  );
  const moduleValues = useMemo(() => {
    const source = moduleFilterOptions ?? rows.map((row) => row.moduleName);
    return Array.from(new Set(source.map((name) => name.trim()).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN")
    );
  }, [moduleFilterOptions, rows]);
  const activeModuleFilter = useMemo(
    () => (treeModuleFilterControlled ? [] : moduleFilterSelected.filter((name) => moduleValues.includes(name))),
    [moduleFilterSelected, moduleValues, treeModuleFilterControlled]
  );
  const filteredRows = useMemo(() => {
    // When the parent controls the filter, `rows` are already filtered.
    if (moduleFilterControlled || treeModuleFilterControlled) return rows;
    if (activeModuleFilter.length === 0) return rows;
    const selected = new Set(activeModuleFilter);
    return rows.filter((row) => selected.has(row.moduleName));
  }, [activeModuleFilter, moduleFilterControlled, rows, treeModuleFilterControlled]);
  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    return [...filteredRows].sort((left, right) => compareRows(left, right, sort));
  }, [filteredRows, sort]);

  const updateSort = (key: DtsWorkbenchSortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, dir: key === "importance" ? "desc" : "asc" };
      }
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const toggleModuleFilter = (value: string) => {
    if (moduleFilterControlled) {
      onModuleFilterToggle(value);
      return;
    }
    setUncontrolledModuleFilter((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
    );
  };

  const clearModuleFilter = () => {
    if (treeModuleFilterControlled) {
      onModuleFilterChange?.([]);
      return;
    }
    if (moduleFilterControlled) {
      onModuleFilterClear();
      return;
    }
    setUncontrolledModuleFilter([]);
  };

  const allDraftSelected =
    draftRows.length > 0 &&
    draftRows.every((row) => selectedBindingIds?.has(row.bindingId));

  const toggleAllDrafts = () => {
    if (!onSelectedBindingIdsChange || !selectedBindingIds) return;
    const next = new Set(selectedBindingIds);
    if (allDraftSelected) {
      for (const row of draftRows) next.delete(row.bindingId);
    } else {
      for (const row of draftRows) next.add(row.bindingId);
    }
    onSelectedBindingIdsChange(next);
  };

  const toggleRow = (bindingId: string) => {
    if (!onSelectedBindingIdsChange || !selectedBindingIds) return;
    if (!draftBindingIds.has(bindingId)) return;
    const next = new Set(selectedBindingIds);
    if (next.has(bindingId)) next.delete(bindingId);
    else next.add(bindingId);
    onSelectedBindingIdsChange(next);
  };

  return (
    <div role="table" aria-label="DTS 参数列表" className="dts-parameter-workbench-table dts-parameter-workbench-table--surface-mvp">
      <div role="rowgroup" className="dts-parameter-workbench-table__head">
        <div role="row" className="dts-parameter-workbench-table__header-row">
          {selectionEnabled ? (
            <span role="columnheader" className="dts-parameter-workbench-table__select">
              <input
                type="checkbox"
                aria-label="全选已修改项"
                checked={allDraftSelected}
                disabled={draftRows.length === 0}
                onChange={toggleAllDrafts}
              />
            </span>
          ) : null}
          <span role="columnheader">
            <SortableHeader label="参数名" sortKey="propertyKey" sort={sort} onSort={updateSort} />
          </span>
          <span role="columnheader" className="dts-parameter-workbench-table__module-filter-col">
            <span className="dts-parameter-workbench-table__head-cell">
              <span>所属模块</span>
            {treeModuleFilterControlled ? (
              <ColumnFilter
                label="所属模块"
                groupLabel="所属模块筛选"
                mode="tree"
                treeNodes={moduleFilterNodes ?? []}
                selectedTreeIds={moduleFilterSelected}
                onTreeChange={(next) => onModuleFilterChange?.(next)}
                onClear={clearModuleFilter}
                treeSearchable
              />
            ) : (
              <ColumnFilter
                label="所属模块"
                groupLabel="所属模块筛选"
                values={moduleValues}
                selectedValues={activeModuleFilter}
                onToggle={toggleModuleFilter}
                onClear={clearModuleFilter}
              />
            )}
            </span>
          </span>
          <span role="columnheader" className="dts-parameter-workbench-table__driver-col">
            <span className="dts-parameter-workbench-table__driver-col-label">器件 / 驱动</span>
          </span>
          <span role="columnheader">当前值</span>
          <span role="columnheader">
            <SortableHeader label="重要性" sortKey="importance" sort={sort} onSort={updateSort} />
          </span>
          <span role="columnheader" className="dts-parameter-workbench-table__actions-col">
            操作
          </span>
        </div>
      </div>
      <div role="rowgroup" className="dts-parameter-workbench-table__body">
        {sortedRows.map((row) => {
          const isDraft = draftBindingIds.has(row.bindingId);
          const isSelected = selectedBindingId === row.bindingId;
          const isChecked = selectedBindingIds?.has(row.bindingId) ?? false;
          const actionContext = bindingActionContext(row);
          const displayRaw = formatDtsRawValueForUi(row.rawValue) || row.rawValue;
          return (
            <div
              role="row"
              key={row.bindingId}
              data-binding-id={row.bindingId}
              aria-selected={isSelected}
              className={`dts-parameter-workbench-table__row dts-parameter-workbench-table__card is-${row.governanceState}${isDraft ? " is-draft" : ""}${isSelected ? " is-selected" : ""}`}
            >
              {selectionEnabled ? (
                <span role="cell" data-label="选择" className="dts-parameter-workbench-table__select">
                  {isDraft ? (
                    <input
                      type="checkbox"
                      aria-label={`选择 ${actionContext}`}
                      checked={isChecked}
                      onChange={() => toggleRow(row.bindingId)}
                    />
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </span>
              ) : null}
              <span role="cell" data-label="参数名" className="dts-parameter-workbench-table__property">
                <code title={row.propertyKey}>{row.propertyKey}</code>
                {isDraft ? (
                  <span
                    className="dts-parameter-workbench-table__draft-badge"
                    data-testid={`draft-${row.bindingId}`}
                  >
                    草稿
                  </span>
                ) : null}
                {row.nodeEnablementNotice ? (
                  <small
                    className="dts-parameter-workbench-table__enablement-notice"
                    title={row.nodeEnablementNotice}
                  >
                    {row.nodeEnablementNotice}
                    {row.topologyPath ? (
                      <span className="dts-parameter-workbench-table__enablement-path">
                        {" "}
                        · {row.topologyPath}
                      </span>
                    ) : null}
                  </small>
                ) : null}
              </span>
              <span role="cell" data-label="所属模块">
                <span className="dts-parameter-workbench-table__module">
                  <strong>{row.moduleName}</strong>
                  {!row.moduleMapped ? <small>未映射</small> : null}
                </span>
              </span>
              <span role="cell" data-label="器件 / 驱动" className="dts-parameter-workbench-table__driver-col">
                <DeviceIdentity row={row} />
              </span>
              <span role="cell" data-label="当前值">
                <code title={displayRaw}>{displayRaw}</code>
              </span>
              <span role="cell" data-label="重要性">
                <ImportanceCell row={row} />
              </span>
              <span
                role="cell"
                data-label="操作"
                className="dts-parameter-workbench-table__actions dts-parameter-workbench-table__actions-col"
              >
                <button
                  type="button"
                  className="button subtle dts-parameter-workbench-table__icon-action"
                  aria-label={`查看 ${actionContext}`}
                  title="查看"
                  onClick={() => onSelectBinding(row.bindingId)}
                >
                  <Eye size={16} strokeWidth={1.9} aria-hidden="true" />
                </button>
                {canEdit && onEditBinding ? (
                  <button
                    type="button"
                    className="button subtle dts-parameter-workbench-table__icon-action"
                    aria-label={`${isDraft ? "继续编辑" : "编辑"} ${actionContext}`}
                    title={isDraft ? "继续编辑" : "编辑"}
                    onClick={() => {
                      onSelectBinding(row.bindingId);
                      onEditBinding(row.bindingId);
                    }}
                  >
                    <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
