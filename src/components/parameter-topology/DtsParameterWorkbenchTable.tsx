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

import type { ModuleImportance } from "@/domain/parameter-topology/moduleRegistry";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

export type DtsWorkbenchSortKey =
  | "propertyKey"
  | "moduleName"
  | "importance";

export type DtsWorkbenchSort = {
  key: DtsWorkbenchSortKey;
  dir: "asc" | "desc";
};

export type DtsParameterWorkbenchTableProps = {
  rows: DtsParameterWorkbenchRow[];
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
    case "moduleName":
      result = left.moduleName.localeCompare(right.moduleName, "zh-Hans-CN");
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
  const selectionEnabled = Boolean(onSelectedBindingIdsChange && selectedBindingIds);
  const draftRows = useMemo(
    () => rows.filter((row) => draftBindingIds.has(row.bindingId)),
    [draftBindingIds, rows]
  );
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((left, right) => compareRows(left, right, sort));
  }, [rows, sort]);

  const updateSort = (key: DtsWorkbenchSortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, dir: key === "importance" ? "desc" : "asc" };
      }
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
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
          <span role="columnheader">
            <SortableHeader label="所属模块" sortKey="moduleName" sort={sort} onSort={updateSort} />
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
                <code>{row.propertyKey}</code>
                {isDraft ? (
                  <span
                    className="dts-parameter-workbench-table__draft-badge"
                    data-testid={`draft-${row.bindingId}`}
                  >
                    草稿
                  </span>
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
