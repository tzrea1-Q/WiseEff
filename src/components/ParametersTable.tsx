import { Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ParameterRecord } from "../mockData";

type SortKey = "name" | "module" | "valueDiff" | "range" | "risk" | "updatedAtTs";
type SortState = { key: SortKey; dir: "asc" | "desc" };

export type ParametersTableProps = {
  rows: ParameterRecord[];
  totalRows?: number;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onClearFilters?: () => void;
  filters?: ReactNode;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  modifiedIds?: Set<string>;
  onEditRow?: (id: string) => void;
  stashedIds?: Set<string>;
};

const riskScores: Record<ParameterRecord["risk"], number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

const sortableHeaders: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "参数名称" },
  { key: "module", label: "模块" },
  { key: "valueDiff", label: "当前 → 推荐" },
  { key: "range", label: "范围 / 单位" },
  { key: "risk", label: "重要性" },
  { key: "updatedAtTs", label: "更新时间" }
];

function matchesQuery(row: ParameterRecord, query: string) {
  if (!query) {
    return true;
  }

  return [row.name, row.description, row.module].some((value) => value.toLowerCase().includes(query));
}

function getValueDiffMagnitude(row: ParameterRecord) {
  const current = Number.parseFloat(row.currentValue);
  const recommended = Number.parseFloat(row.recommendedValue);
  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return row.currentValue === row.recommendedValue ? 0 : 1;
  }
  return Math.abs(recommended - current);
}

function getValueDiffDirection(row: ParameterRecord) {
  const current = Number.parseFloat(row.currentValue);
  const recommended = Number.parseFloat(row.recommendedValue);
  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return row.currentValue === row.recommendedValue ? "same" : "changed";
  }
  if (recommended > current) return "up";
  if (recommended < current) return "down";
  return "same";
}

function getValueDiffIcon(row: ParameterRecord) {
  const direction = getValueDiffDirection(row);
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  if (direction === "same") return "✓";
  return "→";
}

function getModuleToneIndex(module: string) {
  return Array.from(module).reduce((total, char) => total + char.charCodeAt(0), 0) % 8;
}

function sortValue(row: ParameterRecord, key: SortKey) {
  if (key === "range") {
    return `${row.range} ${row.unit}`.trim();
  }

  if (key === "risk") {
    return riskScores[row.risk];
  }

  if (key === "valueDiff") {
    return getValueDiffMagnitude(row);
  }

  return row[key];
}

function compareRows(left: ParameterRecord, right: ParameterRecord, sort: SortState) {
  const leftValue = sortValue(left, sort.key);
  const rightValue = sortValue(right, sort.key);
  const direction = sort.dir === "asc" ? 1 : -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * direction;
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * direction;
}

export function ParametersTable({
  rows,
  totalRows,
  searchQuery,
  onSearchQueryChange,
  onClearFilters,
  filters,
  selectedIds,
  onSelectedIdsChange,
  focusedId,
  onFocusRow,
  modifiedIds,
  onEditRow,
  stashedIds
}: ParametersTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const controlledSearch = searchQuery !== undefined;
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const activeSearchQuery = controlledSearch ? searchQuery : internalSearchQuery;
  const normalizedQuery = activeSearchQuery.trim().toLowerCase();
  const filteredRows = useMemo(
    () => (controlledSearch ? rows : rows.filter((row) => matchesQuery(row, normalizedQuery))),
    [controlledSearch, normalizedQuery, rows]
  );
  const visibleRows = useMemo(() => {
    if (!sort) {
      return filteredRows;
    }

    return [...filteredRows].sort((left, right) => compareRows(left, right, sort));
  }, [filteredRows, sort]);

  const updateSort = (key: SortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) {
        return { key, dir: key === "risk" ? "desc" : "asc" };
      }

      if (current.dir === "asc") {
        return { key, dir: "desc" };
      }

      return null;
    });
  };
  const visibleIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);
  const modifiedVisibleIds = useMemo(
    () => (modifiedIds ? visibleIds.filter((id) => modifiedIds.has(id)) : visibleIds),
    [modifiedIds, visibleIds]
  );
  const selectedVisibleCount = useMemo(
    () => modifiedVisibleIds.reduce((count, id) => count + (selectedIds.has(id) ? 1 : 0), 0),
    [selectedIds, modifiedVisibleIds]
  );
  const hasModifiedVisible = modifiedVisibleIds.length > 0;
  const allModifiedVisibleSelected = hasModifiedVisible && selectedVisibleCount === modifiedVisibleIds.length;
  const rowCountTotal = totalRows ?? rows.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < modifiedVisibleIds.length;
    }
  }, [selectedVisibleCount, modifiedVisibleIds.length]);

  const updateVisibleSelection = () => {
    const nextSelectedIds = new Set(selectedIds);

    if (allModifiedVisibleSelected) {
      modifiedVisibleIds.forEach((id) => nextSelectedIds.delete(id));
    } else {
      modifiedVisibleIds.forEach((id) => nextSelectedIds.add(id));
    }

    onSelectedIdsChange(nextSelectedIds);
  };

  const handleSearchChange = (query: string) => {
    if (controlledSearch) {
      onSearchQueryChange?.(query);
      return;
    }
    setInternalSearchQuery(query);
  };

  const clearFilters = () => {
    if (controlledSearch) {
      onClearFilters?.();
      return;
    }
    setInternalSearchQuery("");
  };

  return (
    <section className="parameters-table" aria-label="参数表">
      <div className="parameters-table-toolbar">
        <label className="parameters-table-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="按名称 / 描述 / 模块搜索"
            aria-label="按名称 / 描述 / 模块搜索"
            value={activeSearchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
          />
        </label>
        {filters ? <div className="parameters-table-filters">{filters}</div> : null}
        <span className="parameters-table-count">Showing {visibleRows.length} of {rowCountTotal}</span>
      </div>

      <div className="parameters-table-scroll">
        <table className="parameters-table-grid">
          <thead>
            <tr>
              <th scope="col">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="全选已修改项"
                  checked={allModifiedVisibleSelected}
                  disabled={!hasModifiedVisible}
                  onChange={updateVisibleSelection}
                />
              </th>
              {sortableHeaders.map((header) => (
                <th key={header.key} scope="col" aria-sort={sort?.key === header.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="parameters-table-sort-button" aria-label={`按 ${header.label} 排序`} onClick={() => updateSort(header.key)}>
                    {header.label}
                  </button>
                </th>
              ))}
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const isModified = modifiedIds ? modifiedIds.has(row.id) : false;
              const isStashed = stashedIds ? stashedIds.has(row.id) : false;
              return (
              <tr
                key={row.id}
                className={[
                  focusedId === row.id ? "parameters-table-row-focused" : "",
                  isModified ? "row-modified" : "",
                  isStashed ? "row-stashed" : "",
                  row.currentValue === row.recommendedValue ? "row-value-same" : ""
                ].filter(Boolean).join(" ")}
                onClick={() => onFocusRow(row.id)}
              >
                <td data-label="选择">
                  {isModified ? (
                    <input
                      type="checkbox"
                      aria-label={`勾选 ${row.name}`}
                      checked={selectedIds.has(row.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => {
                        const nextSelectedIds = new Set(selectedIds);
                        if (nextSelectedIds.has(row.id)) {
                          nextSelectedIds.delete(row.id);
                        } else {
                          nextSelectedIds.add(row.id);
                        }
                        onSelectedIdsChange(nextSelectedIds);
                      }}
                    />
                  ) : null}
                </td>
                <td data-label="参数名称">
                  <strong>{row.name}</strong>
                  <small>{row.description}</small>
                  {isStashed ? <span className="stash-badge">已暂存</span> : null}
                </td>
                <td data-label="模块">
                  <span className={`module-badge module-tone-${getModuleToneIndex(row.module)}`}>{row.module}</span>
                </td>
                <td className="mono" data-label="当前 → 推荐">
                  <span className={`parameter-value-diff diff-${getValueDiffDirection(row)}`}>
                    <span>{row.currentValue}</span>
                    <span aria-hidden="true">{getValueDiffIcon(row)}</span>
                    <strong>{row.recommendedValue}</strong>
                  </span>
                </td>
                <td data-label="范围 / 单位">
                  <span>{row.range}</span>
                  <small>{row.unit}</small>
                </td>
                <td data-label="重要性">{row.risk}</td>
                <td data-label="更新时间">{row.updatedAt}</td>
                <td data-label="操作">
                  <button
                    type="button"
                    className="edit-row-button"
                    aria-label={`编辑 ${row.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEditRow?.(row.id);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visibleRows.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有匹配的参数</p>
          <button type="button" className="button subtle" onClick={clearFilters}>
            清除筛选条件
          </button>
        </div>
      ) : null}
    </section>
  );
}
