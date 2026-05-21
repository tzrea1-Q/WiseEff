import { Search } from "lucide-react";
import type { RiskLevel } from "../../mockData";
import type { ComparisonFilters } from "../types";
import { ActiveFilterChips } from "./ActiveFilterChips";

export type ComparisonFilterBarProps = {
  filters: ComparisonFilters;
  moduleOptions: string[];
  visibleCount: number;
  totalCount: number;
  onQueryChange: (query: string) => void;
  onDriftOnlyChange: (driftOnly: boolean) => void;
  onRiskChange: (risk: RiskLevel[]) => void;
  onModulesChange: (modules: string[]) => void;
  onReset: () => void;
};

export function ComparisonFilterBar({
  filters,
  visibleCount,
  totalCount,
  onQueryChange,
  onDriftOnlyChange,
  onRiskChange,
  onModulesChange,
  onReset
}: ComparisonFilterBarProps) {
  return (
    <section className="comparison-filter-bar--v2" aria-label="参数矩阵筛选">
      <div className="comparison-filter-bar--v2__row">
        <label className="comparison-filter-bar--v2__search">
          <Search size={15} aria-hidden="true" />
          <input
            value={filters.query}
            placeholder="搜索参数键、模块或含义"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <button
          aria-checked={filters.driftOnly}
          className="comparison-filter-bar--v2__toggle"
          role="switch"
          type="button"
          onClick={() => onDriftOnlyChange(!filters.driftOnly)}
        >
          仅看差异
        </button>
        <button className="comparison-filter-bar--v2__clear" type="button" onClick={onReset}>
          重置
        </button>
        <span className="comparison-filter-bar--v2__count">
          {visibleCount} / {totalCount}
        </span>
      </div>
      <ActiveFilterChips
        filters={filters}
        onQueryChange={onQueryChange}
        onDriftOnlyChange={onDriftOnlyChange}
        onRiskChange={onRiskChange}
        onModulesChange={onModulesChange}
        onReset={onReset}
      />
    </section>
  );
}
