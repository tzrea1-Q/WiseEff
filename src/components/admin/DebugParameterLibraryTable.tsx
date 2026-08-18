import { Search } from "lucide-react";
import { useState } from "react";
import { DataTable, type DataTableSort } from "@/components/admin/DataTable";
import { LibraryRiskFilter } from "@/components/admin/LibraryRiskFilter";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import {
  filterDebugParameterLibrary,
  type DebugAdminSearch,
  type DebugParameterLibraryRow
} from "@/debugAdminLibraryFilters";
import { coverageLabel, isArchivedDebugParameter } from "@/debugAdminDraft";
import { getDebugValueFormatLabel } from "@/debugValueKind";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";
import type { DebugParameter as DomainDebugParameter } from "@/domain/debugging/types";
import type { RiskLevel } from "@/domain/parameters/types";
import "./debug-admin-library-table.css";

const RISK_LABEL = {
  High: "高",
  Medium: "中",
  Low: "低"
} as const;

const RISK_WEIGHT: Record<RiskLevel, number> = {
  High: 3,
  Medium: 2,
  Low: 1
};

const COVERAGE_OPTIONS: Array<{ value: DebugAdminSearch["coverage"]; label: string }> = [
  { value: "all", label: "全部" },
  { value: "dual", label: "双协议" },
  { value: "hdc-only", label: "HDC 已配置" },
  { value: "adb-only", label: "ADB 已配置" },
  { value: "missing-binding", label: "缺 HDC / ADB" },
  { value: "archived", label: "已归档" },
  { value: "disabled", label: "已停用" }
];

const COVERAGE_LABEL = Object.fromEntries(COVERAGE_OPTIONS.map((option) => [option.value, option.label])) as Record<
  DebugAdminSearch["coverage"],
  string
>;

const LIBRARY_PAGE_SIZE = 50;

function parseLibrarySort(sort: string): DataTableSort {
  if (sort.endsWith("-desc")) {
    return { key: sort.slice(0, -5), direction: "desc" };
  }
  if (sort.endsWith("-asc")) {
    return { key: sort.slice(0, -4), direction: "asc" };
  }
  return { key: "name", direction: "asc" };
}

export type DebugParameterLibraryTableProps = {
  parameters: readonly DebugParameterLibraryRow[];
  moduleNodes: readonly FlatModuleNode[];
  runtimeMode: "mock" | "api";
  search: DebugAdminSearch;
  onUpdateSearch: (patch: Partial<DebugAdminSearch>) => void;
  onEditDefinition: (parameterId: string) => void;
  onEditBindings: (parameterId: string) => void;
  onArchive: (parameterId: string) => void;
  onCreate?: () => void;
  canEdit?: boolean;
  loading?: boolean;
};

export function DebugParameterLibraryTable({
  parameters,
  moduleNodes,
  runtimeMode,
  search,
  onUpdateSearch,
  onEditDefinition,
  onEditBindings,
  onArchive,
  onCreate,
  canEdit = true,
  loading = false
}: DebugParameterLibraryTableProps) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const mockMode = runtimeMode === "mock";
  const filtered = filterDebugParameterLibrary(parameters, search, moduleNodes);
  const filtersActive =
    search.q.trim().length > 0 ||
    search.risk !== "all" ||
    search.modules.length > 0 ||
    search.coverage !== "all";
  const tableSort = parseLibrarySort(search.sort);

  const clearFilters = () => {
    onUpdateSearch({
      q: "",
      risk: "all",
      modules: [],
      coverage: "all"
    });
  };

  const rowActionsDisabled = (parameter: DebugParameterLibraryRow) =>
    isArchivedDebugParameter(parameter as DomainDebugParameter) || !canEdit;

  return (
    <section className="parameters-table param-admin-library-table debug-admin-library-table" aria-label="可调参数目录">
      <div className="parameters-table-heading">
        <div>
          <h2>可调参数目录</h2>
          <p>维护调试可调参数定义与 HDC / ADB 路径绑定，通过操作列进入弹窗编辑。</p>
        </div>
        <div className="param-admin-library-heading-actions">
          {onCreate ? (
            <button className="button subtle" type="button" onClick={onCreate}>
              新增参数
            </button>
          ) : null}
        </div>
      </div>

      <DataTable
        aria-label="可调参数目录"
        className="debug-admin-library-datatable"
        rows={loading ? [] : filtered}
        rowKey={(parameter) => parameter.id}
        pageSize={LIBRARY_PAGE_SIZE}
        sort={tableSort}
        onSort={(key) => {
          const nextDirection = tableSort.key === key && tableSort.direction === "asc" ? "desc" : "asc";
          onUpdateSearch({ sort: `${key}-${nextDirection}` });
        }}
        onRowClick={
          canEdit && !loading
            ? (parameter) => {
                if (!rowActionsDisabled(parameter)) {
                  onEditDefinition(parameter.id);
                }
              }
            : undefined
        }
        emptyState={
          loading ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">没有匹配的参数。</p>
              {filtersActive ? (
                <button type="button" className="button subtle" onClick={clearFilters}>
                  清除筛选条件
                </button>
              ) : null}
            </div>
          )
        }
        toolbar={
          <div className="parameters-table-toolbar">
            <label className="parameters-table-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="搜索可调参数"
                type="search"
                value={search.q}
                onChange={(event) => onUpdateSearch({ q: event.target.value })}
                placeholder="搜索参数、Key、模块或说明"
                disabled={loading}
              />
            </label>
            <div className="parameters-table-filters param-admin-library-filters">
              <LibraryRiskFilter
                value={search.risk}
                disabled={loading}
                onChange={(risk) => onUpdateSearch({ risk: risk as DebugAdminSearch["risk"] })}
              />
              <ModuleTreeSelect
                label="模块"
                mode="multi-filter"
                nodes={moduleNodes}
                value={search.modules}
                onChange={(modules) => onUpdateSearch({ modules: typeof modules === "string" ? [modules] : modules })}
                disabled={loading}
              />
              {!mockMode ? (
                <div className="dropdown-root">
                  <button
                    aria-expanded={coverageOpen}
                    aria-haspopup="listbox"
                    className="dropdown-trigger"
                    type="button"
                    onClick={() => setCoverageOpen((current) => !current)}
                    disabled={loading}
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
                            name="debug-coverage"
                            type="radio"
                            onChange={() => {
                              onUpdateSearch({ coverage: option.value });
                              setCoverageOpen(false);
                            }}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {filtersActive ? (
                <button aria-label="清除筛选" className="clear-filters" type="button" onClick={clearFilters}>
                  清除筛选
                </button>
              ) : null}
            </div>
            <span className="parameters-table-count">
              {filtered.length} / {parameters.length} 项
            </span>
          </div>
        }
        columns={[
          {
            key: "name",
            header: "参数名",
            sortAccessor: (parameter) => parameter.name,
            render: (parameter) => (
              <div className="debug-admin-library-name">
                <strong>{parameter.name}</strong>
                {parameter.description ? <small>{parameter.description}</small> : null}
              </div>
            )
          },
          {
            key: "risk",
            header: "风险",
            sortAccessor: (parameter) => RISK_WEIGHT[parameter.risk],
            render: (parameter) => (
              <span className={`risk-badge ${parameter.risk.toLowerCase()}`}>{RISK_LABEL[parameter.risk]}</span>
            )
          },
          {
            key: "format",
            header: "格式",
            sortAccessor: (parameter) => getDebugValueFormatLabel(parameter),
            render: (parameter) => (
              <span className="debug-admin-format-badge">{getDebugValueFormatLabel(parameter)}</span>
            )
          },
          {
            key: "coverage",
            header: "覆盖",
            sortAccessor: (parameter) => coverageLabel(parameter as DomainDebugParameter),
            render: (parameter) => (
              <span className="debug-admin-coverage-badge">
                {coverageLabel(parameter as DomainDebugParameter)}
              </span>
            )
          }
        ]}
        renderRowActions={(parameter) => {
          const disabled = rowActionsDisabled(parameter) || loading;
          return (
            <div className="param-admin-row-actions">
              <button
                type="button"
                className="button subtle param-admin-row-action"
                disabled={disabled}
                onClick={() => onEditDefinition(parameter.id)}
              >
                修改
              </button>
              <button
                type="button"
                className="button subtle param-admin-row-action"
                disabled={disabled}
                onClick={() => onEditBindings(parameter.id)}
              >
                路径绑定
              </button>
              <button
                type="button"
                className="button danger param-admin-row-action"
                disabled={disabled}
                aria-label={`归档 ${parameter.name}`}
                onClick={() => onArchive(parameter.id)}
              >
                归档
              </button>
            </div>
          );
        }}
      />
    </section>
  );
}
