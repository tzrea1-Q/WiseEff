import { Pencil, Search } from "lucide-react";

import { DataTable, type Column } from "@/components/admin/DataTable";
import { ColumnFilter } from "@/components/ColumnFilter";
import { dtsReloadBlockReasonLabels } from "@/domain/dtsReload/types";
import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import { candidateModuleLabel } from "@/features/dts-reload/dtsReloadPresentation";
import { cn } from "@/lib/utils";

import "./dts-reload-candidate-table.css";

export const DTS_RELOAD_CANDIDATE_PAGE_SIZE = 10;

export type DtsReloadCandidateTableProps = {
  rows: DtsReloadCandidate[];
  selectedBindingIds: readonly string[];
  loading?: boolean;
  nameQuery: string;
  onNameQueryChange: (value: string) => void;
  listedCount: number;
  totalCount: number;
  moduleFilterOptions: readonly string[];
  selectedModuleFilters: readonly string[];
  onToggleModuleFilter: (value: string) => void;
  onClearModuleFilter: () => void;
  onToggle: (bindingId: string) => void;
  onEdit: (candidate: DtsReloadCandidate) => void;
  pageSize?: number;
};

function candidateName(candidate: DtsReloadCandidate) {
  return candidate.displayName || candidate.propertyKey;
}

export function DtsReloadCandidateTable({
  rows,
  selectedBindingIds,
  loading = false,
  nameQuery,
  onNameQueryChange,
  listedCount,
  totalCount,
  moduleFilterOptions,
  selectedModuleFilters,
  onToggleModuleFilter,
  onClearModuleFilter,
  onToggle,
  onEdit,
  pageSize = DTS_RELOAD_CANDIDATE_PAGE_SIZE
}: DtsReloadCandidateTableProps) {
  const columns: Column<DtsReloadCandidate>[] = [
    {
      key: "select",
      header: "选择",
      align: "center",
      widthClass: "dts-reload-candidate-table__select",
      render: (candidate) => (
        <input
          type="checkbox"
          aria-label={`选择 ${candidateName(candidate)}`}
          checked={selectedBindingIds.includes(candidate.bindingId)}
          disabled={!candidate.debuggable}
          onChange={() => onToggle(candidate.bindingId)}
          onClick={(event) => event.stopPropagation()}
        />
      )
    },
    {
      key: "parameter",
      header: "参数",
      sortAccessor: (candidate) => candidateName(candidate),
      className: "dts-reload-candidate-table__param",
      render: (candidate) => (
        <div className={cn("dts-reload-candidate-table__identity", !candidate.debuggable && "is-blocked")}>
          <strong title={candidateName(candidate)}>{candidateName(candidate)}</strong>
          <small title={candidate.nodePath ?? "无路径"}>{candidate.nodePath ?? "无路径"}</small>
        </div>
      )
    },
    {
      key: "module",
      header: "模块",
      sortAccessor: (candidate) => candidateModuleLabel(candidate),
      className: "dts-reload-candidate-table__module",
      headerFilter: (
        <ColumnFilter
          label="模块"
          groupLabel="模块筛选"
          values={[...moduleFilterOptions]}
          selectedValues={[...selectedModuleFilters]}
          onToggle={onToggleModuleFilter}
          onClear={onClearModuleFilter}
        />
      ),
      render: (candidate) => {
        const label = candidateModuleLabel(candidate);
        return <span title={label}>{label}</span>;
      }
    },
    {
      key: "baseline",
      header: "库基线",
      sortAccessor: (candidate) => candidate.baselineValue ?? "",
      className: "dts-reload-candidate-table__baseline",
      render: (candidate) => <code title={candidate.baselineValue ?? undefined}>{candidate.baselineValue ?? "—"}</code>
    }
  ];

  return (
    <section className="parameters-table dts-reload-candidate-table-wrap" aria-label="可调试参数">
      <DataTable
        aria-label="可调试参数"
        className="dts-reload-candidate-table"
        tableClassName="dts-reload-candidate-table__grid"
        rows={loading ? [] : rows}
        rowKey={(candidate) => candidate.bindingId}
        columns={columns}
        pageSize={pageSize}
        selectedRowKeys={selectedBindingIds}
        emptyMessage="当前筛选条件下没有可列出的参数。"
        emptyState={loading ? <p className="text-sm text-muted-foreground">加载中…</p> : undefined}
        toolbar={
          <div className="parameters-table-toolbar dts-reload-candidates-toolbar">
            <label className="parameters-table-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                aria-label="按名称搜索参数"
                value={nameQuery}
                onChange={(event) => onNameQueryChange(event.target.value)}
                placeholder="参数名"
              />
            </label>
            <span className="parameters-table-count">
              显示 {listedCount} / {totalCount} 项
            </span>
          </div>
        }
        renderRowActions={(candidate) =>
          candidate.debuggable ? (
            <button
              type="button"
              className="button subtle dts-parameter-workbench-table__icon-action dts-reload-candidate-table__edit"
              aria-label={`编辑 ${candidateName(candidate)}`}
              title="编辑"
              onClick={() => onEdit(candidate)}
            >
              <Pencil size={16} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : (
            <span
              className="dts-reload-status-text"
              title={dtsReloadBlockReasonLabels[candidate.blockReason ?? "unsupported-value-shape"]}
            >
              {dtsReloadBlockReasonLabels[candidate.blockReason ?? "unsupported-value-shape"]}
            </span>
          )
        }
      />
    </section>
  );
}
