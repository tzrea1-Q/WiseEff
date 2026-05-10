import { X } from "lucide-react";
import type { RiskLevel } from "../../mockData";
import type { ComparisonFilters } from "../types";

export type ActiveFilterChipsProps = {
  filters: ComparisonFilters;
  onQueryChange: (query: string) => void;
  onDriftOnlyChange: (driftOnly: boolean) => void;
  onRiskChange: (risk: RiskLevel[]) => void;
  onModulesChange: (modules: string[]) => void;
  onReset: () => void;
};

export function ActiveFilterChips({
  filters,
  onQueryChange,
  onDriftOnlyChange,
  onRiskChange,
  onModulesChange,
  onReset
}: ActiveFilterChipsProps) {
  const hasFilters = !filters.driftOnly || filters.query || filters.risk.length > 0 || filters.modules.length > 0;

  if (!hasFilters) {
    return null;
  }

  return (
    <div className="comparison-filter-chips" aria-label="当前筛选">
      {!filters.driftOnly ? (
        <span className="comparison-filter-chip">
          显示已同步项
          <button type="button" aria-label="移除显示已同步项筛选" onClick={() => onDriftOnlyChange(true)}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {filters.query ? (
        <span className="comparison-filter-chip">
          {filters.query}
          <button type="button" aria-label={`移除 ${filters.query} 筛选`} onClick={() => onQueryChange("")}>
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ) : null}
      {filters.risk.map((risk) => (
        <span className="comparison-filter-chip" key={risk}>
          {risk}
          <button
            type="button"
            aria-label={`移除 ${risk} 筛选`}
            onClick={() => onRiskChange(filters.risk.filter((item) => item !== risk))}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      {filters.modules.map((module) => (
        <span className="comparison-filter-chip" key={module}>
          {module}
          <button
            type="button"
            aria-label={`移除 ${module} 筛选`}
            onClick={() => onModulesChange(filters.modules.filter((item) => item !== module))}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button className="comparison-filter-chips__clear" type="button" onClick={onReset}>
        清除全部
      </button>
    </div>
  );
}
