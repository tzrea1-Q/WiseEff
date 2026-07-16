import { Search } from "lucide-react";
import { LibraryRiskFilter } from "@/components/admin/LibraryRiskFilter";
import { LibrarySelectFilter } from "@/components/admin/LibrarySelectFilter";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import { RadioDropdownFilter } from "@/components/common/RadioDropdownFilter";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { ParamAdminSearch } from "@/hooks/useParamAdminSearch";
import { getCoverage, type ParameterCoverage } from "@/parameterAdminAnalytics";
import { modulePathLabelForTemplate } from "@/parameterAdminLibrary";
import {
  filterParameterLibrary,
  getParameterRecommendedValue,
  PARAMETER_COVERAGE_LABEL,
  sortParameterLibrary
} from "@/parameterAdminLibraryFilters";
import { getParameterValueSummary, shouldSummarizeComplexParameter } from "@/parameterValueKind";
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

const SORT_OPTIONS = [
  { value: "updatedAt-desc", label: "更新时间 ↓" },
  { value: "name-asc", label: "名称 A-Z" },
  { value: "risk-desc", label: "风险 ↓" }
] as const;

export type ParameterLibraryTableProps = {
  parameters: readonly PowerManagementParameterTemplate[];
  projects: readonly PowerManagementProject[];
  moduleNodes: readonly FlatModuleNode[];
  search: ParamAdminSearch;
  onUpdateSearch: (patch: Partial<ParamAdminSearch>) => void;
  onEditDefinition: (parameterId: string) => void;
  onEditValues: (parameterId: string) => void;
  onCreateParameter?: () => void;
  onManageModules?: () => void;
  onDeleteParameter?: (parameterId: string) => void;
};

export function ParameterLibraryTable({
  parameters,
  projects,
  moduleNodes,
  search,
  onUpdateSearch,
  onEditDefinition,
  onEditValues,
  onCreateParameter,
  onManageModules,
  onDeleteParameter
}: ParameterLibraryTableProps) {
  const filtered = sortParameterLibrary(filterParameterLibrary(parameters, projects, search, moduleNodes), search.sort);
  const filtersActive =
    search.q.trim().length > 0 || search.risk !== "all" || search.modules.length > 0 || search.coverage !== "all";

  return (
    <section className="parameters-table param-admin-library-table" aria-label="项目共享参数库">
      <div className="parameters-table-heading">
        <div>
          <h2>项目共享参数库</h2>
          <p>
            Mock 模式扁平参数库（兼容旧演示）。API 模式已切换为参数规格库：按属性键 / 驱动规格治理，不再以完整路径作为名称。
          </p>
        </div>
        <div className="param-admin-library-heading-actions">
          {onManageModules ? (
            <button className="button subtle" type="button" onClick={onManageModules}>
              模块管理
            </button>
          ) : null}
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
        <div className="parameters-table-filters param-admin-library-filters">
          <LibraryRiskFilter
            value={search.risk}
            onChange={(risk) => onUpdateSearch({ risk: risk as ParamAdminSearch["risk"] })}
          />
          <ModuleTreeSelect
            label="模块"
            mode="multi-filter"
            nodes={moduleNodes}
            value={search.modules}
            onChange={(modules) => onUpdateSearch({ modules: Array.isArray(modules) ? modules : [modules] })}
          />
          <RadioDropdownFilter
            allValue="all"
            label="覆盖"
            options={COVERAGE_OPTIONS}
            value={search.coverage}
            onChange={(coverage) => onUpdateSearch({ coverage: coverage as ParameterCoverage })}
          />
          <LibrarySelectFilter
            ariaLabel="排序"
            options={SORT_OPTIONS}
            value={search.sort}
            onChange={(sort) => onUpdateSearch({ sort })}
          />
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
              const moduleLabel = modulePathLabelForTemplate(parameter, moduleNodes);
              return (
                <tr key={parameter.id}>
                  <td data-label="#">{index + 1}</td>
                  <td data-label="参数名">
                    <strong>{parameter.name}</strong>
                    {parameter.description ? <small>{parameter.description}</small> : null}
                  </td>
                  <td data-label="模块" title={moduleLabel}>
                    {moduleLabel}
                  </td>
                  <td data-label="风险">
                    <span className={`risk-badge ${parameter.risk.toLowerCase()}`}>{RISK_LABEL[parameter.risk]}</span>
                  </td>
                  <td data-label="推荐值">
                    {(() => {
                      const recommendedValue = getParameterRecommendedValue(parameter, projects);
                      const hasComplexValue = shouldSummarizeComplexParameter(parameter, recommendedValue);
                      if (!hasComplexValue) {
                        return (
                          <>
                            {recommendedValue}
                            {parameter.unit ? <small>{parameter.unit}</small> : null}
                          </>
                        );
                      }

                      const summary = getParameterValueSummary(recommendedValue || parameter.configFormat);
                      return (
                        <span className="parameter-value-summary" title={recommendedValue}>
                          <span>复杂配置</span>
                          <strong>{summary.propertyName}</strong>
                          <small>{summary.lineCount} 行</small>
                        </span>
                      );
                    })()}
                  </td>
                  <td data-label="覆盖">{PARAMETER_COVERAGE_LABEL[coverage]}</td>
                  <td data-label="操作">
                    <div className="param-admin-row-actions">
                      <button
                        type="button"
                        className="button subtle param-admin-row-action"
                        onClick={() => onEditDefinition(parameter.id)}
                      >
                        修改
                      </button>
                      <button
                        type="button"
                        className="button subtle param-admin-row-action"
                        onClick={() => onEditValues(parameter.id)}
                      >
                        项目参数
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
