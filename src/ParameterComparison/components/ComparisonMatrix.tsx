import type { ComparisonRow as ComparisonRowType } from "../types";
import { ColumnFilter, type ColumnFilterProps } from "../../components/ColumnFilter";
import { ComparisonEmptyState } from "./EmptyStates";
import { ComparisonRow } from "./ComparisonRow";

export type ComparisonColumnFilter = Pick<
  ColumnFilterProps,
  "label" | "groupLabel" | "values" | "selectedValues" | "renderLabel" | "onToggle" | "onClear"
> & { key: "risk" | "module" };

export type ComparisonMatrixProps = {
  rows: ComparisonRowType[];
  query: string;
  baseProjectCode: string;
  targetProjectCode: string;
  totalCount: number;
  columnFilters?: ComparisonColumnFilter[];
  onResetFilters: () => void;
  onSync: (key: string) => void;
  onIgnore: (key: string) => void;
};

export function ComparisonMatrix({
  rows,
  query,
  baseProjectCode,
  targetProjectCode,
  totalCount,
  columnFilters = [],
  onResetFilters,
  onSync,
  onIgnore
}: ComparisonMatrixProps) {
  const emptyKind = totalCount === 0 ? "all-synced" : "filtered";
  const riskFilter = columnFilters.find((filter) => filter.key === "risk");
  const moduleFilter = columnFilters.find((filter) => filter.key === "module");
  const renderColumnFilter = (filter: ComparisonColumnFilter | undefined) => {
    if (!filter) return null;
    const { key, ...filterProps } = filter;
    return <ColumnFilter key={key} {...filterProps} />;
  };

  return (
    <section className={`comparison-matrix--v2${columnFilters.length > 0 ? " comparison-matrix--column-filters" : ""}`} aria-label="参数差异矩阵">
      <div className="comparison-matrix--v2__head" role="row">
        <span className="comparison-matrix--v2__color-slot" aria-hidden="true" />
        <span role="columnheader">参数键</span>
        <span className="comparison-matrix--v2__header-cell" role="columnheader" aria-label="模块">
          <span>模块</span>
          <span className="comparison-matrix--v2__header-filters">{renderColumnFilter(moduleFilter)}</span>
        </span>
        <span className="comparison-matrix--v2__header-cell" role="columnheader" aria-label="重要性">
          <span>重要性</span>
          <span className="comparison-matrix--v2__header-filters">{renderColumnFilter(riskFilter)}</span>
        </span>
        <span role="columnheader">说明</span>
        <span className="comparison-matrix--v2__cell" role="columnheader">
          <i className="env-dot env-dot--base" aria-hidden="true" />
          {baseProjectCode}
        </span>
        <span className="comparison-matrix--v2__cell" role="columnheader">
          <i className="env-dot env-dot--target" aria-hidden="true" />
          {targetProjectCode} / Δ
        </span>
        <span role="columnheader">操作</span>
      </div>
      <div className="comparison-matrix--v2__body">
        {rows.length > 0 ? (
          rows.map((row) => <ComparisonRow key={row.key} row={row} query={query} onSync={onSync} onIgnore={onIgnore} />)
        ) : (
          <ComparisonEmptyState kind={emptyKind} onReset={emptyKind === "filtered" ? onResetFilters : undefined} />
        )}
      </div>
    </section>
  );
}
