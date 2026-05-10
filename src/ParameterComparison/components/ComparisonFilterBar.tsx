import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import type { RiskLevel } from "../../mockData";
import type { ComparisonFilters } from "../types";
import { ActiveFilterChips } from "./ActiveFilterChips";

const riskOptions: RiskLevel[] = ["High", "Medium", "Low"];

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

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function MultiSelect({
  label,
  selectedCount,
  options,
  selected,
  onChange
}: {
  label: string;
  selectedCount: number;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="filter-multi">
      <button className="filter-multi__trigger" type="button" onClick={() => setOpen((current) => !current)}>
        {label}
        {selectedCount > 0 ? <span className="filter-multi__count">{selectedCount}</span> : null}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <ul className="filter-multi__list" role="listbox" aria-label={`${label}筛选`}>
          {options.length > 0 ? (
            options.map((option) => (
              <li
                aria-selected={selected.includes(option)}
                className="filter-multi__option"
                key={option}
                role="option"
                onClick={() => onChange(toggleValue(selected, option))}
              >
                <input checked={selected.includes(option)} readOnly type="checkbox" tabIndex={-1} />
                {option}
              </li>
            ))
          ) : (
            <li className="filter-multi__empty">暂无选项</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function ComparisonFilterBar({
  filters,
  moduleOptions,
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
          仅看漂移
        </button>
        <MultiSelect label="重要性" selectedCount={filters.risk.length} options={riskOptions} selected={filters.risk} onChange={(values) => onRiskChange(values as RiskLevel[])} />
        <MultiSelect label="模块" selectedCount={filters.modules.length} options={moduleOptions} selected={filters.modules} onChange={onModulesChange} />
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
