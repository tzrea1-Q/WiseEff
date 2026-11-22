import { Pencil } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ParameterRecord } from "@/domain/parameters/types";
import type { TreeFilterNode } from "@/domain/tree-filter/treeFilter";
import { getParameterValueSummary, shouldSummarizeComplexParameter } from "@/parameterValueKind";
import { HorizontalDragScroll } from "@/components/HorizontalDragScroll";
import { SelectControl } from "@/components/common/SelectControl";
import { SearchField } from "@/components/common/SearchField";
import { createSearchIndex, formatMatchHint } from "@/lib/search";
import { parameterRecordSearchProfile } from "@/lib/search/profiles";
import { ColumnFilter } from "./ColumnFilter";
import { toggleFilterValue, uniqueFilterValues, type HeaderFilterState } from "./tableFilterUtils";

type SortKey = "name" | "module" | "source" | "valueDiff" | "range" | "risk" | "updatedAtTs";
type SortState = { key: SortKey; dir: "asc" | "desc" };
type FilterableColumnKey = Extract<SortKey, "module" | "risk">;

type ParametersColumnFilterCommon = {
  key: string;
  label: string;
  groupLabel: string;
  onClear: () => void;
  align?: "left" | "right";
};

export type ParametersColumnFilter = ParametersColumnFilterCommon &
  (
    | {
        mode?: "flat";
        values: string[];
        selectedValues: string[];
        renderLabel?: (value: string) => string;
        onToggle: (value: string) => void;
      }
    | {
        mode: "tree";
        treeNodes: readonly TreeFilterNode[];
        selectedTreeIds: readonly string[];
        onTreeChange: (next: string[]) => void;
        treeSearchable?: boolean;
      }
  );

export type ParametersTableProps = {
  rows: ParameterRecord[];
  targetValues?: ReadonlyMap<string, string>;
  totalRows?: number;
  ariaLabel?: string;
  title?: string;
  description?: string;
  showToolbar?: boolean;
  valueColumnLabel?: string;
  searchQuery?: string;
  searchMatchHints?: ReadonlyMap<string, string>;
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

function getColumnFilterAlign(key: FilterableColumnKey) {
  return key === "risk" ? "right" : "left";
}

function getSortableHeaders(valueColumnLabel: string): Array<{ key: SortKey; label: string }> {
  return [
    { key: "name", label: "参数名称" },
    { key: "module", label: "模块" },
    { key: "source", label: "来源" },
    { key: "valueDiff", label: valueColumnLabel },
    { key: "range", label: "范围 / 单位" },
    { key: "risk", label: "重要性" },
    { key: "updatedAtTs", label: "更新时间" }
  ];
}

function formatParameterSource(row: ParameterRecord) {
  if (row.sourceFileName && row.sourceNodePath) {
    return `${row.sourceFileName} → ${row.sourceNodePath}`;
  }
  return "手动";
}

function getColumnFilterValue(row: ParameterRecord, key: SortKey) {
  if (key === "source") {
    return formatParameterSource(row);
  }
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



function getValueDiffMagnitude(row: ParameterRecord, targetValue = row.recommendedValue) {
  const current = Number.parseFloat(row.currentValue);
  const recommended = Number.parseFloat(targetValue);
  if (!Number.isFinite(current) || !Number.isFinite(recommended)) {
    return row.currentValue === targetValue ? 0 : 1;
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

function getParameterValueSummaryForRow(row: ParameterRecord) {
  return getParameterValueSummary(row.currentValue || row.recommendedValue);
}

function getModuleToneIndex(module: string) {
  return Array.from(module).reduce((total, char) => total + char.charCodeAt(0), 0) % 8;
}

function formatUpdatedAtForTable(updatedAt: string) {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return updatedAt;
  }

  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sortValue(row: ParameterRecord, key: SortKey, targetValue?: string) {
  if (key === "range") {
    return `${row.range} ${row.unit}`.trim();
  }

  if (key === "risk") {
    return riskScores[row.risk];
  }

  if (key === "valueDiff") {
    return getValueDiffMagnitude(row, targetValue);
  }
  if (key === "source") {
    return formatParameterSource(row);
  }

  return row[key];
}

function compareRows(left: ParameterRecord, right: ParameterRecord, sort: SortState, targetValues?: ReadonlyMap<string, string>) {
  const leftValue = sortValue(left, sort.key, targetValues?.get(left.id));
  const rightValue = sortValue(right, sort.key, targetValues?.get(right.id));
  const direction = sort.dir === "asc" ? 1 : -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return (leftValue - rightValue) * direction;
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * direction;
}

export function ParametersTable({
  rows,
  targetValues,
  totalRows,
  ariaLabel = "参数表",
  title,
  description,
  showToolbar = true,
  valueColumnLabel = "当前 → 推荐",
  searchQuery,
  searchMatchHints,
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
  const deferredQuery = useDeferredValue(activeSearchQuery);
  const searchIndex = useMemo(
    () => controlledSearch ? null : createSearchIndex(rows, parameterRecordSearchProfile),
    [controlledSearch, rows]
  );
  const searchHits = useMemo(
    () => deferredQuery.trim() ? searchIndex?.search(deferredQuery) : undefined,
    [deferredQuery, searchIndex]
  );
  const filteredRows = useMemo(() => searchHits?.map((hit) => hit.item) ?? rows, [searchHits, rows]);
  const matchHintById = useMemo(() => {
    if (controlledSearch) return searchMatchHints;
    const hints = new Map<string, string>();
    for (const hit of searchHits ?? []) {
      const hint = formatMatchHint(hit.matchedFields, ["name", "description", "module"]);
      if (hint) hints.set(hit.item.id, hint);
    }
    return hints;
  }, [controlledSearch, searchHits, searchMatchHints]);
  const columnFilteredRows = useMemo(
    () =>
      filteredRows.filter((row) =>
        filterableHeaders.every((header) => {
          const providedFilter = columnFilterByKey.get(header.key);
          // Tree-mode consumers own subtree filtering at the page/workbench
          // seam; the table only renders their controlled option surface.
          const selectedValues =
            providedFilter?.mode === "tree"
              ? []
              : providedFilter?.selectedValues ?? internalColumnFilters[header.key] ?? [];
          return selectedValues.length === 0 || selectedValues.includes(getColumnFilterValue(row, header.key));
        })
      ),
    [columnFilterByKey, filterableHeaders, filteredRows, internalColumnFilters]
  );
  const visibleRows = useMemo(() => {
    if (!sort) {
      return columnFilteredRows;
    }

    return [...columnFilteredRows].sort((left, right) => compareRows(left, right, sort, targetValues));
  }, [columnFilteredRows, sort, targetValues]);

  const [pageSize, setPageSize] = useState(100);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  // Compare filter values because controlled consumers may recreate their controls each render.
  const filterKey = JSON.stringify([
    deferredQuery,
    sort,
    internalColumnFilters,
    columnFilters.map((filter) => [filter.key, filter.mode === "tree" ? filter.selectedTreeIds : filter.selectedValues])
  ]);
  const focusedIndex = useMemo(() => visibleRows.findIndex((row) => row.id === focusedId), [visibleRows, focusedId]);
  const focusPage = focusedIndex < 0 ? null : Math.floor(focusedIndex / pageSize) + 1;
  const [pagination, setPagination] = useState({ page: focusPage ?? 1, filterKey, focusedId, focusPage, pageSize });
  let page = Math.min(pagination.page, pageCount);
  const filtersChanged = pagination.filterKey !== filterKey;
  if (filtersChanged || pagination.pageSize !== pageSize) page = 1;
  if (focusPage !== null && (pagination.focusedId !== focusedId || (pagination.focusPage !== focusPage && !filtersChanged && pagination.pageSize === pageSize))) {
    page = focusPage;
  }
  if (page !== pagination.page || filtersChanged || pagination.focusedId !== focusedId ||
      pagination.focusPage !== focusPage || pagination.pageSize !== pageSize) {
    setPagination({ page, filterKey, focusedId, focusPage, pageSize });
  }
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    body?.querySelector(".parameters-table-row-focused")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [focusedId, focusPage]);

  const rowActions = useRef({ onFocusRow, onEditRow, canEdit, selectedIds, onSelectedIdsChange });
  useLayoutEffect(() => {
    rowActions.current = { onFocusRow, onEditRow, canEdit, selectedIds, onSelectedIdsChange };
  }, [onFocusRow, onEditRow, canEdit, selectedIds, onSelectedIdsChange]);
  const focusRow = useCallback((id: string) => rowActions.current.onFocusRow(id), []);
  const editRow = useCallback((id: string) => rowActions.current.onEditRow?.(id), []);
  const toggleRow = useCallback((id: string) => {
    const actions = rowActions.current;
    if (!actions.canEdit) return;
    const next = new Set(actions.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    actions.onSelectedIdsChange(next);
  }, []);

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
      const { key: _filterKey, align, ...filterProps } = providedFilter;
      return <ColumnFilter {...filterProps} align={align ?? getColumnFilterAlign(header.key)} />;
    }

    return (
      <ColumnFilter
        label={header.label}
        groupLabel={`${header.label}筛选`}
        values={uniqueFilterValues(rows, (row) => getColumnFilterValue(row, header.key))}
        selectedValues={internalColumnFilters[header.key] ?? []}
        onToggle={(value) => toggleInternalColumnFilter(header.key, value)}
        onClear={() => clearInternalColumnFilter(header.key)}
        align={getColumnFilterAlign(header.key)}
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
          {!showToolbar ? <span className="parameters-table-count">显示 {visibleRows.length} / {rowCountTotal} 个参数</span> : null}
        </div>
      ) : null}

      {showToolbar ? (
        <div className="parameters-table-toolbar">
          <SearchField
            value={activeSearchQuery}
            onValueChange={handleSearchChange}
            placeholder="搜索参数名、描述、模块或路径"
            ariaLabel="搜索参数名、描述、模块或路径"
          />
          {filters ? <div className="parameters-table-filters">{filters}</div> : null}
          <span className="parameters-table-count">显示 {visibleRows.length} / {rowCountTotal} 个参数</span>
        </div>
      ) : null}

      <HorizontalDragScroll className="parameters-table-scroll">
        <table className="parameters-table-grid">
          <thead>
            <tr>
              <th scope="col">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="全选已修改项"
                  title="选择筛选结果中所有已修改项（含其他页）"
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
          <tbody ref={bodyRef}>
            {visibleRows.slice((page - 1) * pageSize, page * pageSize).map((row) => (
              <ParameterTableRow
                key={row.id}
                record={row}
                targetValue={targetValues?.get(row.id)}
                isFocused={focusedId === row.id}
                isModified={modifiedIds?.has(row.id) ?? false}
                isStashed={stashedIds?.has(row.id) ?? false}
                isSelected={selectedIds.has(row.id)}
                matchHint={matchHintById?.get(row.id)}
                canEdit={canEdit}
                valueColumnLabel={valueColumnLabel}
                onFocusRow={focusRow}
                onEditRow={editRow}
                onToggleRow={toggleRow}
              />
            ))}
          </tbody>
        </table>
      </HorizontalDragScroll>

      {visibleRows.length > 50 ? (
        <nav className="parameters-table-pagination" aria-label="参数分页">
          <label>
            每页条数
            <SelectControl
              value={String(pageSize)}
              ariaLabel="每页条数"
              onValueChange={(value) => setPageSize(Number(value))}
              size="filter"
              compactControl="pagination"
              options={[50, 100, 200].map((size) => ({ value: String(size), label: size }))}
            />
          </label>
          <span>第 {page} / {pageCount} 页</span>
          <div>
            <button type="button" className="button subtle" disabled={page === 1}
              onClick={() => setPagination({ ...pagination, page: page - 1 })}>上一页</button>
            <button type="button" className="button subtle" disabled={page === pageCount}
              onClick={() => setPagination({ ...pagination, page: page + 1 })}>下一页</button>
          </div>
        </nav>
      ) : null}

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


const ParameterTableRow = memo(function ParameterTableRow({
  record, targetValue, isFocused, isModified, isStashed, isSelected, matchHint, canEdit, valueColumnLabel,
  onFocusRow, onEditRow, onToggleRow
}: {
  record: ParameterRecord;
  targetValue?: string;
  isFocused: boolean;
  isModified: boolean;
  isStashed: boolean;
  isSelected: boolean;
  matchHint?: string;
  canEdit: boolean;
  valueColumnLabel: string;
  onFocusRow: (id: string) => void;
  onEditRow: (id: string) => void;
  onToggleRow: (id: string) => void;
}) {
  const row = targetValue === undefined ? record : { ...record, recommendedValue: targetValue };
  const hasComplexValue = shouldSummarizeComplexParameter(row, row.currentValue, row.recommendedValue);
  const valueSummary = getParameterValueSummaryForRow(row);
  const displayedUpdatedAt = formatUpdatedAtForTable(row.updatedAt);
  return (
    <tr
      className={[
        isFocused ? "parameters-table-row-focused" : "",
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
            checked={isSelected}
            disabled={!canEdit}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleRow(row.id)}
          />
        ) : null}
      </td>
      <td data-label="参数名称">
        <strong>{row.name}</strong>
        <small>{row.description}</small>
        {matchHint ? <small>{matchHint}</small> : null}
        {isStashed ? <span className="stash-badge">已暂存</span> : null}
      </td>
      <td data-label="模块">
        <span className={`module-badge module-tone-${row.module === "unset" ? 2 : getModuleToneIndex(row.module)}`}
          title={row.module === "unset" ? "未分配模块，请重新归类" : undefined}>{row.module === "unset" ? "unset（未分配）" : row.module}</span>
      </td>
      <td data-label="来源">
        <span className="parameter-source-text">{formatParameterSource(row)}</span>
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
      <td data-label="更新时间" title={displayedUpdatedAt === row.updatedAt ? undefined : row.updatedAt}>{displayedUpdatedAt}</td>
      <td data-label="操作">
        <div className="parameters-table-row-actions">
        {canEdit ? (
          <button
            type="button"
            className="edit-row-button"
            aria-label={`编辑 ${row.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onEditRow(row.id);
            }}
          >
            <Pencil size={15} />
          </button>
        ) : null}
        </div>
      </td>
    </tr>
  );
});
