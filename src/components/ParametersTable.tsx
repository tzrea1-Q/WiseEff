import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ParameterRecord } from "../mockData";

export type ParametersTableProps = {
  rows: ParameterRecord[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  focusedId: string | null;
  onFocusRow: (id: string) => void;
};

function matchesQuery(row: ParameterRecord, query: string) {
  if (!query) {
    return true;
  }

  return [row.name, row.description, row.module].some((value) => value.toLowerCase().includes(query));
}

export function ParametersTable({ rows, selectedIds, onSelectedIdsChange, focusedId, onFocusRow }: ParametersTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesQuery(row, normalizedQuery)),
    [normalizedQuery, rows]
  );

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
              <th scope="col">选择</th>
              <th scope="col">参数名称</th>
              <th scope="col">模块</th>
              <th scope="col">当前值</th>
              <th scope="col">推荐值</th>
              <th scope="col">范围 / 单位</th>
              <th scope="col">重要性</th>
              <th scope="col">更新时间</th>
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
