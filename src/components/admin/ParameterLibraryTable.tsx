import { Search } from "lucide-react";
import { useState } from "react";
import { FilterChipGroup } from "@/components/FilterChipGroup";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import type { ParamAdminSearch } from "@/hooks/useParamAdminSearch";
import { getCoverage, type ParameterCoverage } from "@/parameterAdminAnalytics";
import {
  filterParameterLibrary,
  getParameterRecommendedValue,
  PARAMETER_COVERAGE_LABEL,
  sortParameterLibrary
} from "@/parameterAdminLibraryFilters";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "@/powerManagementConfig";

const RISK_LABEL = {
  High: "高",
  Medium: "中",
  Low: "低"
} as const;

const COVERAGE_OPTIONS: Array<{ value: ParamAdminSearch["coverage"]; label: string }> = [
  { value: "all", label: PARAMETER_COVERAGE_LABEL.all },
  { value: "full", label: PARAMETER_COVERAGE_LABEL.full },
  { value: "partial", label: PARAMETER_COVERAGE_LABEL.partial },
  { value: "orphan", label: PARAMETER_COVERAGE_LABEL.orphan }
];

export type ParameterLibraryTableProps = {
  parameters: readonly PowerManagementParameterTemplate[];
  projects: readonly PowerManagementProject[];
  search: ParamAdminSearch;
  onUpdateSearch: (patch: Partial<ParamAdminSearch>) => void;
  onEditDefinition: (parameterId: string) => void;
  onEditValues: (parameterId: string) => void;
  onCreateParameter?: () => void;
  onDeleteParameter?: (parameterId: string) => void;
};

export function ParameterLibraryTable({
  parameters,
  projects,
  search,
  onUpdateSearch,
  onEditDefinition,
  onEditValues,
  onCreateParameter,
  onDeleteParameter
}: ParameterLibraryTableProps) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const filtered = sortParameterLibrary(filterParameterLibrary(parameters, projects, search), search.sort);
  const moduleOptions = Array.from(new Set(parameters.map((parameter) => parameter.module))).map((moduleName) => ({
    value: moduleName,
    label: moduleName
  }));
  const filtersActive =
    search.q.trim().length > 0 || search.risk !== "all" || search.modules.length > 0 || search.coverage !== "all";

  return (
    <section className="parameters-table param-admin-library-table" aria-label="项目共享参数库">
      <div className="parameters-table-heading">
        <div>
          <h2>项目共享参数库</h2>
          <p>维护跨项目共享的参数定义与各项目实际取值，通过操作列进入弹窗编辑。</p>
        </div>
        <div className="param-admin-library-heading-actions">
          {onCreateParameter ? (
            <button className="button subtle" type="button" onClick={onCreateParameter}>
              新增参数
            </button>
          ) : null}
        </div>
      </div>

      <div className="parameters-table-toolbar">
        <label className="parameters-table-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="搜索参数"
            type="search"
            value={search.q}
            onChange={(event) => onUpdateSearch({ q: event.target.value })}
            placeholder="搜索参数、模块或说明"
          />
        </label>
        <FilterChipGroup
          ariaLabel="风险等级"
          value={search.risk}
          options={[
            { value: "all", label: "全部" },
            { value: "high", label: "高" },
            { value: "medium", label: "中" },
            { value: "low", label: "低" }
          ]}
          onChange={(risk) => onUpdateSearch({ risk: risk as ParamAdminSearch["risk"] })}
        />
        <div className="parameters-table-filters param-admin-library-filters">
          <MultiSelectDropdown
            label="模块"
            options={moduleOptions}
            value={search.modules}
            onChange={(modules) => onUpdateSearch({ modules })}
          />
          <div className="dropdown-root">
            <button
              aria-expanded={coverageOpen}
              aria-haspopup="listbox"
              className="dropdown-trigger"
              type="button"
              onClick={() => setCoverageOpen((current) => !current)}
            >
              覆盖{search.coverage !== "all" ? ` · ${PARAMETER_COVERAGE_LABEL[search.coverage]}` : ""} ▾
            </button>
            {coverageOpen ? (
              <div className="dropdown-menu" role="listbox">
                {COVERAGE_OPTIONS.map((option) => (
                  <label className="dropdown-item" key={option.value}>
                    <input
                      aria-label={option.label}
                      checked={search.coverage === option.value}
                      name="coverage"
                      type="radio"
                      onChange={() => {
                        onUpdateSearch({ coverage: option.value as ParameterCoverage });
                        setCoverageOpen(false);
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <select
            aria-label="排序"
            className="library-sort"
            value={search.sort}
            onChange={(event) => onUpdateSearch({ sort: event.target.value })}
          >
            <option value="updatedAt-desc">更新时间 ↓</option>
            <option value="name-asc">名称 A-Z</option>
            <option value="risk-desc">风险 ↓</option>
          </select>
          {filtersActive ? (
            <button
              aria-label="清除筛选"
              className="clear-filters"
              type="button"
              onClick={() => onUpdateSearch({ q: "", risk: "all", modules: [], coverage: "all" })}
            >
              清除筛选
            </button>
          ) : null}
        </div>
        <span className="parameters-table-count">{filtered.length} / {parameters.length} 项</span>
      </div>

      <div className="parameters-table-scroll">
        <table className="parameters-table-grid param-admin-library-grid">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">参数名</th>
              <th scope="col">模块</th>
              <th scope="col">风险</th>
              <th scope="col">推荐值</th>
              <th scope="col">覆盖</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((parameter, index) => {
              const coverage = getCoverage(parameter, projects);
              return (
                <tr key={parameter.id}>
                  <td data-label="#">{index + 1}</td>
                  <td data-label="参数名">
                    <strong>{parameter.name}</strong>
                    {parameter.description ? <small>{parameter.description}</small> : null}
                  </td>
                  <td data-label="模块">{parameter.module}</td>
                  <td data-label="风险">
                    <span className={`risk-badge ${parameter.risk.toLowerCase()}`}>{RISK_LABEL[parameter.risk]}</span>
                  </td>
                  <td data-label="推荐值">
                    {getParameterRecommendedValue(parameter, projects)}
                    {parameter.unit ? <small>{parameter.unit}</small> : null}
                  </td>
                  <td data-label="覆盖">{PARAMETER_COVERAGE_LABEL[coverage]}</td>
                  <td data-label="操作">
                    <div className="param-admin-row-actions">
                      <button
                        type="button"
                        className="button subtle param-admin-row-action"
                        onClick={() => onEditDefinition(parameter.id)}
                      >
                        修改参数定义
                      </button>
                      <button
                        type="button"
                        className="button subtle param-admin-row-action"
                        onClick={() => onEditValues(parameter.id)}
                      >
                        修改项目参数值
                      </button>
                      {onDeleteParameter ? (
                        <button
                          type="button"
                          className="button danger param-admin-row-action"
                          disabled={parameters.length <= 1}
                          aria-label={`删除 ${parameter.name}`}
                          onClick={() => onDeleteParameter(parameter.id)}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 ? (
        <div className="parameters-table-empty">
          <p>{search.coverage === "orphan" ? "所有参数都被项目使用中 · 没有闲置参数" : "没有匹配的参数。"}</p>
          {filtersActive ? (
            <button
              type="button"
              className="button subtle"
              onClick={() => onUpdateSearch({ q: "", risk: "all", modules: [], coverage: "all" })}
            >
              清除筛选条件
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
