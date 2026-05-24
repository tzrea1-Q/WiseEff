import { Eye, Pencil, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ParameterRecord } from "../mockData";
import { ColumnFilter } from "./ColumnFilter";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "./tableFilterUtils";

type SortKey = "name" | "module" | "valueDiff" | "range" | "risk" | "updatedAtTs";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type FilterableColumnKey = Extract<SortKey, "module" | "risk">;

export type ParametersColumnFilter = {
  key: string;
  label: string;
  groupLabel: string;
  values: string[];
  selectedValues: string[];
  renderLabel?: (value: string) => string;
  onToggle: (value: string) => void;
  onClear: () => void;
};

export type ParametersTableProps = {
  rows: ParameterRecord[];
  totalRows?: number;
  ariaLabel?: string;
  title?: string;
  description?: string;
  showToolbar?: boolean;
  valueColumnLabel?: string;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onClearFilters?: () => void;
  filters?: ReactNode;
  columnFilters?: ParametersColumnFilter[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
  modifiedIds?: Set<string>;
  onEditRow?: (id: string) => void;
  onViewRow?: (id: string) => void;
  stashedIds?: Set<string>;
  canEdit?: boolean;
};

const riskScores: Record<ParameterRecord["risk"], number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

const filterableColumnKeys = new Set<SortKey>(["module", "risk"]);

function isFilterableColumnKey(key: SortKey): key is FilterableColumnKey {
  return filterableColumnKeys.has(key);
}

function getSortableHeaders(valueColumnLabel: string): Array<{ key: SortKey; label: string }> {
  return [
    { key: "name", label: "参数名称" },
    { key: "module", label: "模块" },
    { key: "valueDiff", label: valueColumnLabel },
    { key: "range", label: "范围 / 单位" },
    { key: "risk", label: "重要性" },
    { key: "updatedAtTs", label: "更新时间" }
  ];
}

function getColumnFilterValue(row: ParameterRecord, key: SortKey) {
  if (key === "valueDiff") {
    return `${row.currentValue} → ${row.recommendedValue}`;
  }
  if (key === "range") {
    return `${row.range} ${row.unit}`.trim();
  }
  if (key === "updatedAtTs") {
    return row.updatedAt;
  }
  return String(row[key]);
}

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

function isComplexParameterValue(value: string) {
  return value.includes("\n") || value.length > 80;
}

function getParameterValueSummary(value: string) {
  const firstLine = value.split("\n")[0]?.trim() ?? "";
  const propertyName = firstLine.replace(/\s*=.*$/, "").trim() || "配置块";
  const lineCount = value.split("\n").filter((line) => line.trim()).length;
  return { propertyName, lineCount };
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
  ariaLabel = "参数表",
  title,
  description,
  showToolbar = true,
  valueColumnLabel = "当前 → 推荐",
  searchQuery,
  onSearchQueryChange,
  onClearFilters,
  filters,
  columnFilters = [],
  selectedIds,
  onSelectedIdsChange,
  focusedId,
  onFocusRow,
  modifiedIds,
  onEditRow,
  onViewRow,
  stashedIds,
  canEdit = true
}: ParametersTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const [internalColumnFilters, setInternalColumnFilters] = useState<HeaderFilterState>({});
  const selectAllRef = useRef<HTMLInputElement>(null);
  const sortableHeaders = useMemo(() => getSortableHeaders(valueColumnLabel), [valueColumnLabel]);
  const filterableHeaders = useMemo(() => sortableHeaders.filter((header) => isFilterableColumnKey(header.key)), [sortableHeaders]);
  const columnFilterByKey = useMemo(
    () => new Map(columnFilters.map((filter) => [filter.key, filter])),
    [columnFilters]
  );
  const controlledSearch = searchQuery !== undefined;
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const activeSearchQuery = controlledSearch ? searchQuery : internalSearchQuery;
  const normalizedQuery = activeSearchQuery.trim().toLowerCase();
  const filteredRows = useMemo(
    () => (controlledSearch ? rows : rows.filter((row) => matchesQuery(row, normalizedQuery))),
    [controlledSearch, normalizedQuery, rows]
  );
  const columnFilteredRows = useMemo(
    () =>
      filteredRows.filter((row) =>
        filterableHeaders.every((header) => {
          const providedFilter = columnFilterByKey.get(header.key);
          const selectedValues = providedFilter?.selectedValues ?? internalColumnFilters[header.key] ?? [];
          return selectedValues.length === 0 || selectedValues.includes(getColumnFilterValue(row, header.key));
        })
      ),
    [columnFilterByKey, filterableHeaders, filteredRows, internalColumnFilters]
  );
  const visibleRows = useMemo(() => {
    if (!sort) {
      return columnFilteredRows;
    }

    return [...columnFilteredRows].sort((left, right) => compareRows(left, right, sort));
  }, [columnFilteredRows, sort]);

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
    if (!canEdit) {
      return;
    }
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
    setInternalColumnFilters({});
    if (controlledSearch) {
      onClearFilters?.();
      return;
    }
    setInternalSearchQuery("");
  };

  const toggleInternalColumnFilter = (key: SortKey, value: string) => {
    setInternalColumnFilters((current) => ({
      ...current,
      [key]: toggleFilterValue(current[key] ?? [], value)
    }));
  };

  const clearInternalColumnFilter = (key: SortKey) => {
    setInternalColumnFilters((current) => ({ ...current, [key]: [] }));
  };

  const renderColumnFilter = (header: { key: SortKey; label: string }) => {
    if (!isFilterableColumnKey(header.key)) {
      return null;
    }

    const providedFilter = columnFilterByKey.get(header.key);
    if (providedFilter) {
      return <ColumnFilter {...providedFilter} />;
    }

    return (
      <ColumnFilter
        label={header.label}
        groupLabel={`${header.label}筛选`}
        values={uniqueFilterValues(rows, (row) => getColumnFilterValue(row, header.key))}
        selectedValues={internalColumnFilters[header.key] ?? []}
        onToggle={(value) => toggleInternalColumnFilter(header.key, value)}
        onClear={() => clearInternalColumnFilter(header.key)}
      />
    );
  };

  return (
    <section
      className="parameters-table parameters-table--column-filters"
      aria-label={ariaLabel}
    >
      {title || description ? (
        <div className="parameters-table-heading">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {!showToolbar ? <span className="parameters-table-count">Showing {visibleRows.length} of {rowCountTotal}</span> : null}
        </div>
      ) : null}

      {showToolbar ? (
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
      ) : null}

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
                  disabled={!canEdit || !hasModifiedVisible}
                  onChange={updateVisibleSelection}
                />
              </th>
              {sortableHeaders.map((header) => (
                <th key={header.key} scope="col" aria-sort={sort?.key === header.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <div className="parameters-table-head-cell">
                    <button type="button" className="parameters-table-sort-button" aria-label={`按 ${header.label} 排序`} onClick={() => updateSort(header.key)}>
                      {header.label}
                    </button>
                    {renderColumnFilter(header)}
                  </div>
                </th>
              ))}
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const isModified = modifiedIds ? modifiedIds.has(row.id) : false;
              const isStashed = stashedIds ? stashedIds.has(row.id) : false;
              const hasComplexValue = isComplexParameterValue(row.currentValue) || isComplexParameterValue(row.recommendedValue);
              const valueSummary = getParameterValueSummary(row.currentValue || row.recommendedValue);
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
                      disabled={!canEdit}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => {
                        if (!canEdit) {
                          return;
                        }
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
                <td className="mono" data-label={valueColumnLabel}>
                  {hasComplexValue ? (
                    <span
                      className={`parameter-value-summary diff-${getValueDiffDirection(row)}`}
                      title={row.currentValue === row.recommendedValue ? row.currentValue : `${row.currentValue}\n---\n${row.recommendedValue}`}
                    >
                      <span>复杂配置</span>
                      <strong>{valueSummary.propertyName}</strong>
                      <small>{valueSummary.lineCount} 行 · {row.currentValue === row.recommendedValue ? "当前与推荐一致" : "当前与推荐不同"}</small>
                    </span>
                  ) : (
                    <span className={`parameter-value-diff diff-${getValueDiffDirection(row)}`}>
                      <span>{row.currentValue}</span>
                      <span aria-hidden="true">{getValueDiffIcon(row)}</span>
                      <strong>{row.recommendedValue}</strong>
                    </span>
                  )}
                </td>
                <td data-label="范围 / 单位">
                  <span>{row.range}</span>
                  <small>{row.unit}</small>
                </td>
                <td data-label="重要性">{row.risk}</td>
                <td data-label="更新时间">{row.updatedAt}</td>
                <td data-label="操作">
                  <div className="parameters-table-row-actions">
                  {onViewRow ? (
                      <button
                        type="button"
                        className="view-row-button"
                        aria-label={`查看 ${row.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onViewRow(row.id);
                        }}
                      >
                        <Eye size={15} />
                      </button>
                    ) : null}
                  {canEdit ? (
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
                  ) : (
                    <span className="permission-muted-action">Read only</span>
                  )}
                  </div>
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
