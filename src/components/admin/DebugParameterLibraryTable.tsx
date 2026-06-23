import { Search } from "lucide-react";
import { useState } from "react";
import { LibraryRiskFilter } from "@/components/admin/LibraryRiskFilter";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import {
  filterDebugParameterLibrary,
  sortDebugParameterLibrary,
  type DebugAdminSearch,
  type DebugParameterLibraryRow
} from "@/debugAdminLibraryFilters";
import { coverageLabel, isArchivedDebugParameter } from "@/debugAdminDraft";
import type { DebugParameter as DomainDebugParameter } from "@/domain/debugging/types";

const RISK_LABEL = {
  High: "高",
  Medium: "中",
  Low: "低"
} as const;

const COVERAGE_OPTIONS: Array<{ value: DebugAdminSearch["coverage"]; label: string }> = [
  { value: "all", label: "全部" },
  { value: "dual", label: "双协议" },
  { value: "hdc-only", label: "HDC 已配置" },
  { value: "adb-only", label: "ADB 已配置" },
  { value: "missing-binding", label: "缺 HDC / ADB" },
  { value: "archived", label: "已归档" },
  { value: "disabled", label: "已停用" }
];

const COVERAGE_LABEL = Object.fromEntries(COVERAGE_OPTIONS.map((option) => [option.value, option.label])) as Record<
  DebugAdminSearch["coverage"],
  string
>;

export type DebugParameterLibraryTableProps = {
  parameters: readonly DebugParameterLibraryRow[];
  runtimeMode: "mock" | "api";
  search: DebugAdminSearch;
  onUpdateSearch: (patch: Partial<DebugAdminSearch>) => void;
  onEditDefinition: (parameterId: string) => void;
  onEditBindings: (parameterId: string) => void;
  onArchive: (parameterId: string) => void;
  onCreate?: () => void;
  canEdit?: boolean;
  loading?: boolean;
};

export function DebugParameterLibraryTable({
  parameters,
  runtimeMode,
  search,
  onUpdateSearch,
  onEditDefinition,
  onEditBindings,
  onArchive,
  onCreate,
  canEdit = true,
  loading = false
}: DebugParameterLibraryTableProps) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const mockMode = runtimeMode === "mock";
  const filtered = sortDebugParameterLibrary(filterDebugParameterLibrary(parameters, search), search.sort);
  const moduleOptions = Array.from(new Set(parameters.map((parameter) => parameter.module))).map((moduleName) => ({
    value: moduleName,
    label: moduleName
  }));
  const filtersActive =
    search.q.trim().length > 0 ||
    search.risk !== "all" ||
    search.modules.length > 0 ||
    search.coverage !== "all";

  const clearFilters = () => {
    onUpdateSearch({
      q: "",
      risk: "all",
      modules: [],
      coverage: "all"
    });
  };

  const rowActionsDisabled = (parameter: DebugParameterLibraryRow) =>
    isArchivedDebugParameter(parameter as DomainDebugParameter) || !canEdit;

  return (
    <section className="parameters-table param-admin-library-table" aria-label="可调参数目录">
      <div className="parameters-table-heading">
        <div>
          <h2>可调参数目录</h2>
          <p>维护调试可调参数定义与 HDC / ADB 路径绑定，通过操作列进入弹窗编辑。</p>
        </div>
        <div className="param-admin-library-heading-actions">
          {onCreate ? (
            <button className="button subtle" type="button" onClick={onCreate}>
              新增参数
            </button>
          ) : null}
        </div>
      </div>

      <div className="parameters-table-toolbar">
        <label className="parameters-table-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索可调参数"
            type="search"
            value={search.q}
            onChange={(event) => onUpdateSearch({ q: event.target.value })}
            placeholder="搜索参数、Key、模块或说明"
            disabled={loading}
          />
        </label>
        <div className="parameters-table-filters param-admin-library-filters">
          <LibraryRiskFilter
            value={search.risk}
            disabled={loading}
            onChange={(risk) => onUpdateSearch({ risk: risk as DebugAdminSearch["risk"] })}
          />
          <MultiSelectDropdown
            label="模块"
            options={moduleOptions}
            value={search.modules}
            onChange={(modules) => onUpdateSearch({ modules })}
          />
          {!mockMode ? (
            <div className="dropdown-root">
              <button
                aria-expanded={coverageOpen}
                aria-haspopup="listbox"
                className="dropdown-trigger"
                type="button"
                onClick={() => setCoverageOpen((current) => !current)}
                disabled={loading}
              >
                覆盖{search.coverage !== "all" ? ` · ${COVERAGE_LABEL[search.coverage]}` : ""} ▾
              </button>
              {coverageOpen ? (
                <div className="dropdown-menu" role="listbox">
                  {COVERAGE_OPTIONS.map((option) => (
                    <label className="dropdown-item" key={option.value}>
                      <input
                        aria-label={option.label}
                        checked={search.coverage === option.value}
                        name="debug-coverage"
                        type="radio"
                        onChange={() => {
                          onUpdateSearch({ coverage: option.value });
                          setCoverageOpen(false);
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <select
            aria-label="排序"
            className="library-sort"
            value={search.sort}
            onChange={(event) => onUpdateSearch({ sort: event.target.value })}
            disabled={loading}
          >
            <option value="name-asc">名称 A-Z</option>
            <option value="risk-desc">风险 ↓</option>
          </select>
          {filtersActive ? (
            <button aria-label="清除筛选" className="clear-filters" type="button" onClick={clearFilters}>
              清除筛选
            </button>
          ) : null}
        </div>
        <span className="parameters-table-count">
          {filtered.length} / {parameters.length} 项
        </span>
      </div>

      <div className="parameters-table-scroll">
        <table className="parameters-table-grid debug-admin-library-grid" aria-label="可调参数目录">
          <colgroup>
            <col className="debug-admin-col-index" />
            <col className="debug-admin-col-name" />
            <col className="debug-admin-col-risk" />
            <col className="debug-admin-col-coverage" />
            <col className="debug-admin-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">参数名</th>
              <th scope="col">风险</th>
              <th scope="col">覆盖</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5}>加载中…</td>
              </tr>
            ) : (
              filtered.map((parameter, index) => {
                const disabled = rowActionsDisabled(parameter);
                return (
                  <tr key={parameter.id}>
                    <td data-label="#">{index + 1}</td>
                    <td data-label="参数名">
                      <strong>{parameter.name}</strong>
                      {parameter.description ? <small>{parameter.description}</small> : null}
                    </td>
                    <td data-label="风险">
                      <span className={`risk-badge ${parameter.risk.toLowerCase()}`}>{RISK_LABEL[parameter.risk]}</span>
                    </td>
                    <td data-label="覆盖">
                      <span className="debug-admin-coverage-badge">
                        {coverageLabel(parameter as DomainDebugParameter)}
                      </span>
                    </td>
                    <td data-label="操作">
                      <div className="param-admin-row-actions">
                        <button
                          type="button"
                          className="button subtle param-admin-row-action"
                          disabled={disabled}
                          onClick={() => onEditDefinition(parameter.id)}
                        >
                          修改
                        </button>
                        <button
                          type="button"
                          className="button subtle param-admin-row-action"
                          disabled={disabled}
                          onClick={() => onEditBindings(parameter.id)}
                        >
                          路径绑定
                        </button>
                        <button
                          type="button"
                          className="button danger param-admin-row-action"
                          disabled={disabled}
                          aria-label={`归档 ${parameter.name}`}
                          onClick={() => onArchive(parameter.id)}
                        >
                          归档
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有匹配的参数。</p>
          {filtersActive ? (
            <button type="button" className="button subtle" onClick={clearFilters}>
              清除筛选条件
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
