import type { ComparisonRow as ComparisonRowType } from "../types";
import { ComparisonEmptyState } from "./EmptyStates";
import { ComparisonRow } from "./ComparisonRow";

export type ComparisonMatrixProps = {
  rows: ComparisonRowType[];
  query: string;
  baseProjectCode: string;
  targetProjectCode: string;
  totalCount: number;
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
  onResetFilters,
  onSync,
  onIgnore
}: ComparisonMatrixProps) {
  const emptyKind = totalCount === 0 ? "all-synced" : "filtered";

  return (
    <section className="comparison-matrix--v2" aria-label="参数差异矩阵">
      <div className="comparison-matrix--v2__head" role="row">
        <span className="comparison-matrix--v2__color-slot" aria-hidden="true" />
        <span role="columnheader">参数键 / 模块</span>
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
