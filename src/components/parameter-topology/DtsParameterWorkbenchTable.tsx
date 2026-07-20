import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleCheck,
  CircleX,
  Eye,
  Pencil,
  TriangleAlert
} from "lucide-react";

import type { ModuleImportance } from "@/domain/parameter-topology/moduleRegistry";
import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";

export type DtsWorkbenchSortKey =
  | "propertyKey"
  | "moduleName"
  | "importance"
  | "governanceState"
  | "rawValue";

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
  valid: "有效 · valid",
  attention: "待处理 · attention",
  blocked: "阻断 · blocked"
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

const governanceRank = {
  blocked: 3,
  attention: 2,
  valid: 1
} as const;

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

function Governance({ row }: { row: DtsParameterWorkbenchRow }) {
  const GovernanceIcon = row.governanceState === "valid"
    ? CircleCheck
    : row.governanceState === "attention"
      ? TriangleAlert
      : CircleX;
  return (
    <span className="dts-parameter-workbench-table__governance">
      <span
        className={`dts-parameter-workbench-table__governance-badge is-${row.governanceState}`}
        aria-label={`治理状态：${row.governanceState}`}
      >
        <GovernanceIcon size={13} strokeWidth={2} aria-hidden="true" />
        {governanceLabels[row.governanceState]}
      </span>
      <small>重要性：{importanceLabels[row.importance]}</small>
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
    case "governanceState":
      result = governanceRank[left.governanceState] - governanceRank[right.governanceState];
      break;
    case "rawValue":
      result = left.rawValue.localeCompare(right.rawValue, "zh-Hans-CN");
      break;
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
    key: "moduleName",
    dir: "asc"
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
        return { key, dir: key === "importance" || key === "governanceState" ? "desc" : "asc" };
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
    <div role="table" aria-label="DTS 参数列表" className="dts-parameter-workbench-table">
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
          <span role="columnheader">器件 / 驱动</span>
          <span role="columnheader">
            <SortableHeader label="当前值" sortKey="rawValue" sort={sort} onSort={updateSort} />
          </span>
          <span role="columnheader">
            <SortableHeader label="治理" sortKey="governanceState" sort={sort} onSort={updateSort} />
          </span>
          <span role="columnheader">操作</span>
        </div>
      </div>
      <div role="rowgroup" className="dts-parameter-workbench-table__body">
        {sortedRows.map((row) => {
          const isDraft = draftBindingIds.has(row.bindingId);
          const isSelected = selectedBindingId === row.bindingId;
          const isChecked = selectedBindingIds?.has(row.bindingId) ?? false;
          const actionContext = bindingActionContext(row);
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
              <span role="cell" data-label="器件 / 驱动">
                <DeviceIdentity row={row} />
              </span>
              <span role="cell" data-label="当前值">
                <code title={row.rawValue}>{row.rawValue}</code>
              </span>
              <span role="cell" data-label="治理">
                <Governance row={row} />
              </span>
              <span role="cell" data-label="操作" className="dts-parameter-workbench-table__actions">
                <button
                  type="button"
                  className="button subtle"
                  aria-label={`查看 ${actionContext}`}
                  onClick={() => onSelectBinding(row.bindingId)}
                >
                  <Eye size={15} strokeWidth={1.9} aria-hidden="true" />
                  查看
                </button>
                {canEdit && onEditBinding ? (
                  <button
                    type="button"
                    className="button"
                    aria-label={`${isDraft ? "继续编辑" : "编辑"} ${actionContext}`}
                    onClick={() => {
                      onSelectBinding(row.bindingId);
                      onEditBinding(row.bindingId);
                    }}
                  >
                    <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
                    {isDraft ? "继续编辑" : "编辑"}
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
