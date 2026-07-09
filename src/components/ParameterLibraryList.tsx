import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { ParamAdminSearch } from "../hooks/useParamAdminSearch";
import { groupParametersByModuleTree, modulePathLabelForTemplate } from "../parameterAdminLibrary";
import { filterParameterLibrary, sortParameterLibrary } from "../parameterAdminLibraryFilters";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "../powerManagementConfig";
import type { ParameterCoverage } from "../parameterAdminAnalytics";
import { ModuleTreeSelect } from "./common/ModuleTreeSelect";
import { FilterChipGroup } from "./FilterChipGroup";

const RISK_LABEL = {
  High: "高",
  Medium: "中",
  Low: "低"
} as const;

const COVERAGE_OPTIONS: Array<{ value: ParamAdminSearch["coverage"]; label: string }> = [
  { value: "all", label: "全部" },
  { value: "full", label: "3 个项目都有" },
  { value: "partial", label: "缺某个项目" },
  { value: "orphan", label: "闲置参数" }
];

const COVERAGE_LABEL = Object.fromEntries(COVERAGE_OPTIONS.map((option) => [option.value, option.label])) as Record<
  ParamAdminSearch["coverage"],
  string
>;

const COLLAPSED_GROUPS_KEY = "parameter-admin.collapsed-groups";

export function ParameterLibraryList({
  parameters,
  projects,
  moduleNodes,
  selectedId,
  onSelect,
  search,
  onUpdateSearch
}: {
  parameters: PowerManagementParameterTemplate[];
  projects: readonly PowerManagementProject[];
  moduleNodes: readonly FlatModuleNode[];
  selectedId?: string;
  onSelect: (id: string) => void;
  search: ParamAdminSearch;
  onUpdateSearch: (patch: Partial<ParamAdminSearch>) => void;
}) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(COLLAPSED_GROUPS_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    sessionStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Array.from(collapsedGroups)));
  }, [collapsedGroups]);

  const filtered = useMemo(
    () => sortParameterLibrary(filterParameterLibrary(parameters, projects, search, moduleNodes), search.sort),
    [moduleNodes, parameters, projects, search]
  );
  const forceExpandGroups = search.q.trim().length > 0;
  const filtersActive = search.q.trim().length > 0 || search.risk !== "all" || search.modules.length > 0 || search.coverage !== "all";
  const groupedEntries = useMemo(
    () => groupParametersByModuleTree(filtered, moduleNodes).filter(({ parameters: items }) => items.length > 0),
    [filtered, moduleNodes]
  );

  const toggleGroup = (moduleId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  return (
    <div className="library-panel parameter-library-panel">
      <div className="library-header">
        <div>
          <strong>项目共享参数库</strong>
          <span>{filtered.length} / {parameters.length} 项</span>
        </div>
        <label className="library-search">
          <Search size={14} aria-hidden="true" />
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
        <div className="library-filter-row">
          <ModuleTreeSelect
            label="模块"
            mode="multi-filter"
            nodes={moduleNodes}
            value={search.modules}
            onChange={(modules) => onUpdateSearch({ modules: Array.isArray(modules) ? modules : [modules] })}
          />
          <div className="dropdown-root">
            <button
              aria-expanded={coverageOpen}
              aria-haspopup="listbox"
              className="dropdown-trigger"
              type="button"
              onClick={() => setCoverageOpen((current) => !current)}
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
      </div>

      {filtered.length > 0 ? (
        <div className="library-list" role="region" aria-label="项目共享参数库">
          {groupedEntries.map(({ node, parameters: items }) => {
            const collapsed = !forceExpandGroups && collapsedGroups.has(node.id);
            return (
              <section className="param-group param-group--tree" data-depth={node.depth} key={node.id}>
                <button
                  aria-expanded={!collapsed}
                  className="param-group-header"
                  style={{ paddingLeft: `${Math.max(node.depth - 1, 0) * 12 + 8}px` }}
                  type="button"
                  onClick={() => toggleGroup(node.id)}
                >
                  <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
                  <strong>{node.name}</strong>
                  <span className="param-group-count">({items.length})</span>
                </button>
                {collapsed ? null : (
                  <ul className="param-group-list" aria-label={node.name}>
                    {items.map((parameter) => (
                      <li className={selectedId === parameter.id ? "library-row selected" : "library-row"} key={parameter.id}>
                        <button
                          aria-pressed={selectedId === parameter.id}
                          className="library-row-button"
                          type="button"
                          onClick={() => onSelect(parameter.id)}
                        >
                          <span className="library-row-main">
                            <strong>{parameter.name}</strong>
                            <small>{modulePathLabelForTemplate(parameter, moduleNodes)}</small>
                          </span>
                          <span className={`risk-badge ${parameter.risk.toLowerCase()}`}>{RISK_LABEL[parameter.risk]}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="library-empty">
          {search.coverage === "orphan" ? "所有参数都被项目使用中 · 没有闲置参数" : "没有匹配的参数。"}
        </div>
      )}
    </div>
  );
}
