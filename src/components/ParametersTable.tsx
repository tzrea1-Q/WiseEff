import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParameterRecord } from "../mockData";

type SortKey = "name" | "module" | "currentValue" | "recommendedValue" | "range" | "risk" | "updatedAtTs";
type SortState = { key: SortKey; dir: "asc" | "desc" };

export type ParametersTableProps = {
  rows: ParameterRecord[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
};

const riskScores: Record<ParameterRecord["risk"], number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

const sortableHeaders: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "参数名称" },
  { key: "module", label: "模块" },
  { key: "currentValue", label: "当前值" },
  { key: "recommendedValue", label: "推荐值" },
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

function sortValue(row: ParameterRecord, key: SortKey) {
  if (key === "risk") {
    return riskScores[row.risk];
  }

  if (key === "range") {
    return `${row.range} ${row.unit}`.trim();
  }

  return row[key];
}

function compareRows(left: ParameterRecord, right: ParameterRecord, sort: SortState) {
  const leftValue = sortValue(left, sort.key);
  const rightValue = sortValue(right, sort.key);
  const direction = sort.dir === "asc" ? 1 : -1;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return sort.key === "risk" ? (rightValue - leftValue) * direction : (leftValue - rightValue) * direction;
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: "base" }) * direction;
}

export function ParametersTable({ rows, selectedIds, onSelectedIdsChange, focusedId, onFocusRow }: ParametersTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesQuery(row, normalizedQuery)),
    [normalizedQuery, rows]
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
        return { key, dir: "asc" };
      }

      if (current.dir === "asc") {
        return { key, dir: "desc" };
      }

      return null;
    });
  };
  const visibleIds = useMemo(() => visibleRows.map((row) => row.id), [visibleRows]);
  const selectedVisibleCount = useMemo(
    () => visibleIds.reduce((count, id) => count + (selectedIds.has(id) ? 1 : 0), 0),
    [selectedIds, visibleIds]
  );
  const hasVisibleRows = visibleIds.length > 0;
  const allVisibleSelected = hasVisibleRows && selectedVisibleCount === visibleIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
    }
  }, [selectedVisibleCount, visibleIds.length]);

  const updateVisibleSelection = () => {
    const nextSelectedIds = new Set(selectedIds);

    if (allVisibleSelected) {
      visibleIds.forEach((id) => nextSelectedIds.delete(id));
    } else {
      visibleIds.forEach((id) => nextSelectedIds.add(id));
    }

    onSelectedIdsChange(nextSelectedIds);
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
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <span className="parameters-table-count">Showing {visibleRows.length} of {rows.length}</span>
      </div>

      <div className="parameters-table-scroll">
        <table className="parameters-table-grid">
          <thead>
            <tr>
              <th scope="col">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="全选当前视图"
                  checked={allVisibleSelected}
                  disabled={!hasVisibleRows}
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
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                className={focusedId === row.id ? "parameters-table-row-focused" : ""}
                onClick={() => onFocusRow(row.id)}
              >
                <td>
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
                </td>
                <td>
                  <strong>{row.name}</strong>
                  <small>{row.description}</small>
                </td>
                <td>{row.module}</td>
                <td className="mono">{row.currentValue}</td>
                <td className="mono recommended">{row.recommendedValue}</td>
                <td>
                  <span>{row.range}</span>
                  <small>{row.unit}</small>
                </td>
                <td>{row.risk}</td>
                <td>{row.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visibleRows.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有匹配的参数</p>
          <button type="button" className="button subtle" onClick={() => setSearchQuery("")}>
            清除筛选条件
          </button>
        </div>
      ) : null}
    </section>
  );
}
