import { Eye, Pencil } from "lucide-react";
import { SearchField } from "@/components/common/SearchField";

import { DataTable, type Column } from "@/components/admin/DataTable";
import { ColumnFilter } from "@/components/ColumnFilter";
import { dtsReloadBlockReasonLabels } from "@/domain/dtsReload/types";
import type { DtsReloadCandidate } from "@/domain/dtsReload/types";
import type { TreeFilterNode } from "@/domain/tree-filter/treeFilter";
import { candidateModuleLabel } from "@/features/dts-reload/dtsReloadPresentation";
import { cn } from "@/lib/utils";
import { hasMeaningfulDebugChange } from "@/domain/dtsReload/debugValue";

import "./dts-reload-candidate-table.css";

export const DTS_RELOAD_CANDIDATE_PAGE_SIZE = 10;

export type DtsReloadCandidateTableProps = {
  rows: DtsReloadCandidate[];
  selectedBindingIds: readonly string[];
  loading?: boolean;
  canSelect?: boolean;
  debugValues?: Readonly<Record<string, string>>;
  hasActiveFilters?: boolean;
  filterSummary?: string;
  onClearFilters?: () => void;
  nameQuery: string;
  onNameQueryChange: (value: string) => void;
  listedCount: number;
  totalCount: number;
  moduleFilterOptions?: readonly string[];
  selectedModuleFilters?: readonly string[];
  onToggleModuleFilter?: (value: string) => void;
  onClearModuleFilter: () => void;
  moduleFilterNodes?: readonly TreeFilterNode[];
  selectedModuleFilterIds?: readonly string[];
  onChangeModuleFilter?: (next: string[]) => void;
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
  canSelect = true,
  debugValues = {},
  hasActiveFilters = false,
  filterSummary,
  onClearFilters,
  nameQuery,
  onNameQueryChange,
  listedCount,
  totalCount,
  moduleFilterOptions = [],
  selectedModuleFilters = [],
  onToggleModuleFilter = () => undefined,
  onClearModuleFilter,
  moduleFilterNodes,
  selectedModuleFilterIds,
  onChangeModuleFilter,
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
          data-binding-id={candidate.bindingId}
          aria-label={`选择 ${candidateName(candidate)}`}
          checked={selectedBindingIds.includes(candidate.bindingId)}
          disabled={!candidate.debuggable || !canSelect}
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
      headerFilter: moduleFilterNodes && selectedModuleFilterIds && onChangeModuleFilter ? (
        <ColumnFilter
          label="模块"
          groupLabel="模块筛选"
          mode="tree"
          treeNodes={moduleFilterNodes}
          selectedTreeIds={selectedModuleFilterIds}
          onTreeChange={onChangeModuleFilter}
          onClear={onClearModuleFilter}
          treeSearchable
        />
      ) : (
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
      header: "库基线 / 本轮调试",
      sortAccessor: (candidate) => candidate.baselineValue ?? "",
      className: "dts-reload-candidate-table__baseline",
      render: (candidate) => {
        const selected = selectedBindingIds.includes(candidate.bindingId);
        const debugValue = debugValues[candidate.bindingId] ?? candidate.baselineValue ?? "";
        const changed = selected && hasMeaningfulDebugChange(debugValue, candidate.baselineValue, candidate.resolvedValueShape);
        return <div className="dts-reload-candidate-table__values">
          <code title={candidate.baselineValue ?? undefined}>{candidate.baselineValue ?? "—"}</code>
          {selected ? <>
            <code title={debugValue} className={changed ? "is-changed" : undefined}>→ {debugValue || "（空属性）"}</code>
            <small>{changed ? "本轮已修改" : "本轮未修改"}</small>
          </> : null}
        </div>;
      }
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
        emptyMessage={hasActiveFilters || nameQuery.trim() ? "没有符合当前筛选条件的参数。" : "当前项目暂无可列出的参数。"}
        emptyState={loading ? <p role="status" className="text-sm text-muted-foreground">正在加载项目参数…</p> : undefined}
        toolbar={
          <div className="parameters-table-toolbar dts-reload-candidates-toolbar">
            <SearchField
              value={nameQuery}
              onValueChange={onNameQueryChange}
              placeholder="搜索参数名、描述、模块或路径"
              ariaLabel="按名称搜索参数"
            />
            <span className="parameters-table-count">
              显示 {listedCount} / {totalCount} 项
            </span>
            {hasActiveFilters || nameQuery.trim() ? <div className="dts-reload-active-filters" role="status">
              <span>{filterSummary || "已应用筛选"}</span>
              {onClearFilters ? <button type="button" className="button subtle" onClick={onClearFilters}>清除全部筛选</button> : null}
            </div> : null}
          </div>
        }
        renderRowActions={(candidate) => <>
            <button
              type="button"
              className="button subtle dts-parameter-workbench-table__icon-action dts-reload-candidate-table__edit"
              aria-label={`${candidate.debuggable ? "编辑" : "查看"} ${candidateName(candidate)}`}
              title={candidate.debuggable ? "编辑参数" : "查看参数详情与不可调试原因"}
              onClick={(event) => {
                event.currentTarget.focus();
                onEdit(candidate);
              }}
            >
              {candidate.debuggable ? <Pencil size={16} strokeWidth={1.9} aria-hidden="true" /> : <Eye size={16} strokeWidth={1.9} aria-hidden="true" />}
            </button>
            {!candidate.debuggable ? <span data-row-status className="dts-reload-status-text"
              title={dtsReloadBlockReasonLabels[candidate.blockReason ?? "unsupported-value-shape"]}>
              仅查看
            </span> : null}
          </>
        }
      />
    </section>
  );
}
