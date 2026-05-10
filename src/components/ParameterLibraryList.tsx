import { Search } from "lucide-react";
import type { ParamAdminSearch } from "../hooks/useParamAdminSearch";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "../powerManagementConfig";
import { FilterChipGroup } from "./FilterChipGroup";

const RISK_TO_FILTER = {
  High: "high",
  Medium: "medium",
  Low: "low"
} as const;

const RISK_LABEL = {
  High: "高",
  Medium: "中",
  Low: "低"
} as const;

export function ParameterLibraryList({
  parameters,
  selectedId,
  onSelect,
  search,
  onUpdateSearch
}: {
  parameters: PowerManagementParameterTemplate[];
  projects: readonly PowerManagementProject[];
  selectedId?: string;
  onSelect: (id: string) => void;
  search: ParamAdminSearch;
  onUpdateSearch: (patch: Partial<ParamAdminSearch>) => void;
}) {
  const filtered = parameters.filter((parameter) => {
    if (search.q) {
      const needle = search.q.toLowerCase();
      const haystack = `${parameter.name} ${parameter.module} ${parameter.description} ${parameter.explanation}`.toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }

    if (search.risk !== "all" && RISK_TO_FILTER[parameter.risk] !== search.risk) {
      return false;
    }

    return true;
  });

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
      </div>

      {filtered.length > 0 ? (
        <div className="library-list" role="listbox" aria-label="项目共享参数库">
          {filtered.map((parameter) => (
            <div
              aria-selected={selectedId === parameter.id}
              className={selectedId === parameter.id ? "library-row selected" : "library-row"}
              key={parameter.id}
              role="option"
              tabIndex={selectedId === parameter.id ? 0 : -1}
              onClick={() => onSelect(parameter.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(parameter.id);
                }
              }}
            >
              <span className="library-row-main">
                <strong>{parameter.name}</strong>
                <small>{parameter.module}</small>
              </span>
              <span className={`risk-badge ${parameter.risk.toLowerCase()}`}>{RISK_LABEL[parameter.risk]}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="library-empty">没有匹配的参数。</div>
      )}
    </div>
  );
}
