import { Pencil, Search, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { ColumnFilter } from "@/components/ColumnFilter";
import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";
import { DataTable, type Column, type DataTableSort } from "./DataTable";

type ProjectAdminTableProps = {
  rows: ParameterAdminProjectRow[];
  search: ParamAdminProjectsSearch;
  onUpdateSearch: (patch: Partial<ParamAdminProjectsSearch>) => void;
  onCreateProject: () => void;
  onEditProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onManageFiles: (projectId: string) => void;
  primaryActionLabel?: string;
};

const STATUS_FILTER_OPTIONS = [
  { value: "initialized", label: "在研" },
  { value: "maintenance", label: "维护" },
  { value: "initialization_pending_review", label: "待审阅" },
  { value: "initialization_rejected", label: "已驳回" },
  { value: "not_initialized", label: "未初始化" }
] as const;

function tableSortFromSearch(sort: string): DataTableSort {
  switch (sort) {
    case "name-desc":
      return { key: "name", direction: "desc" };
    case "updated-asc":
      return { key: "updated", direction: "asc" };
    case "updated-desc":
      return { key: "updated", direction: "desc" };
    case "parameters-asc":
      return { key: "parameters", direction: "asc" };
    case "parameters-desc":
      return { key: "parameters", direction: "desc" };
    case "name-asc":
    default:
      return { key: "name", direction: "asc" };
  }
}

function nextSearchSort(key: string, current: DataTableSort) {
  const defaultDirection = key === "name" ? "asc" : "desc";
  const direction = current.key === key
    ? current.direction === "asc" ? "desc" : "asc"
    : defaultDirection;
  return `${key}-${direction}`;
}

export function ProjectAdminTable({
  rows,
  search,
  onUpdateSearch,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onManageFiles,
  primaryActionLabel = "管理文件"
}: ProjectAdminTableProps) {
  const selectedStatuses = search.statuses ?? [];
  const query = search.q.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchesQuery =
          !query ||
          row.name.toLowerCase().includes(query) ||
          row.code.toLowerCase().includes(query) ||
          row.id.toLowerCase().includes(query);
        const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(row.status);
        return matchesQuery && matchesStatus;
      }),
    [query, rows, selectedStatuses]
  );
  const filtersActive = query.length > 0 || selectedStatuses.length > 0;
  const tableSort = tableSortFromSearch(search.sort);
  const statusValues = STATUS_FILTER_OPTIONS.map((option) => option.value);
  const statusLabelByValue = Object.fromEntries(
    STATUS_FILTER_OPTIONS.map((option) => [option.value, option.label])
  ) as Record<string, string>;

  const toggleStatus = (value: string) => {
    const next = selectedStatuses.includes(value)
      ? selectedStatuses.filter((item) => item !== value)
      : [...selectedStatuses, value];
    onUpdateSearch({ statuses: next });
  };

  const columns: Column<ParameterAdminProjectRow>[] = [
    {
      key: "name",
      header: "项目名称",
      sortAccessor: (row) => row.name,
      render: (row) => <strong>{row.name}</strong>
    },
    {
      key: "code",
      header: "项目代号",
      render: (row) => <span className="mono">{row.code}</span>
    },
    {
      key: "status",
      header: "状态",
      align: "center",
      headerFilter: (
        <ColumnFilter
          label="状态"
          groupLabel="状态筛选"
          values={statusValues}
          selectedValues={selectedStatuses}
          renderLabel={(value) => statusLabelByValue[value] ?? value}
          onToggle={toggleStatus}
          onClear={() => onUpdateSearch({ statuses: [] })}
        />
      ),
      render: (row) => (
        <span className={`project-admin-status project-admin-status--${row.status}`}>{row.statusLabel}</span>
      )
    },
    {
      key: "conflicts",
      header: "冲突",
      align: "center",
      className: "project-admin-col-numeric",
      render: (row) =>
        row.openConflictCount > 0 ? (
          <span className="project-admin-attention project-admin-attention--conflict">
            {row.openConflictCount}
          </span>
        ) : (
          <span className="project-admin-attention-muted">0</span>
        )
    },
    {
      key: "baseline",
      header: "基线",
      align: "center",
      render: (row) => (
        <span
          className={
            row.releasedBaselineCount > 0
              ? "project-admin-attention project-admin-attention--baseline"
              : "project-admin-attention-muted"
          }
        >
          {row.baselineLabel}
        </span>
      )
    },
    {
      key: "modules",
      header: "模块",
      align: "center",
      className: "project-admin-col-numeric",
      render: (row) => row.moduleCount
    },
    {
      key: "parameters",
      header: "参数",
      align: "center",
      className: "project-admin-col-numeric",
      sortAccessor: (row) => row.parameterCount,
      render: (row) => row.parameterCount
    },
    {
      key: "updated",
      header: "最近更新",
      align: "center",
      className: "project-admin-col-updated-cell",
      sortAccessor: (row) => row.updatedAt,
      render: (row) => row.updatedAtLabel
    }
  ];

  return (
    <section className="parameters-table param-admin-library-table project-admin-library-table">
      <div className="parameters-table-heading">
        <div>
          <h2>项目清单</h2>
          <p>维护项目基础信息与初始化状态；冲突与基线列标出需要治理关注的项目。</p>
        </div>
        <div className="param-admin-library-heading-actions">
          <button type="button" className="button primary" onClick={onCreateProject}>
            新建项目
          </button>
        </div>
      </div>

      <DataTable
        aria-label="项目管理列表"
        className="project-admin-library-datatable"
        tableClassName="parameters-table-grid project-admin-library-grid"
        rows={filteredRows}
        rowKey={(row) => row.id}
        columns={columns}
        pageSize={10}
        visibleScrollRail
        sort={tableSort}
        onSort={(key) => onUpdateSearch({ sort: nextSearchSort(key, tableSort) })}
        onRowClick={(row) => onManageFiles(row.id)}
        toolbar={
          <div className="parameters-table-toolbar">
            <label className="parameters-table-search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="搜索项目"
                type="search"
                value={search.q}
                placeholder="搜索项目名称、代号或 ID"
                onChange={(event) => onUpdateSearch({ q: event.target.value })}
              />
            </label>
            <div className="parameters-table-filters param-admin-library-filters">
              {filtersActive ? (
                <button
                  aria-label="清除筛选"
                  className="clear-filters"
                  type="button"
                  onClick={() => onUpdateSearch({ q: "", statuses: [] })}
                >
                  清除筛选
                </button>
              ) : null}
            </div>
            <span className="parameters-table-count">
              {filteredRows.length} / {rows.length} 项
            </span>
          </div>
        }
        emptyState={
          <div className="parameters-table-empty">
            <p>没有匹配的项目。</p>
            {filtersActive ? (
              <button
                type="button"
                className="button subtle"
                onClick={() => onUpdateSearch({ q: "", statuses: [] })}
              >
                清除筛选条件
              </button>
            ) : null}
          </div>
        }
        renderRowActions={(row) => (
          <div className="param-admin-row-actions project-admin-row-actions">
            <button
              type="button"
              className="button subtle project-admin-row-manage-files"
              aria-label={`${primaryActionLabel} ${row.name}`}
              title={`${primaryActionLabel} ${row.name}`}
              onClick={() => onManageFiles(row.id)}
            >
              {primaryActionLabel}
            </button>
            <button
              type="button"
              className="icon-button project-admin-row-edit"
              aria-label={`编辑 ${row.name}`}
              title={`编辑 ${row.name}`}
              onClick={() => onEditProject(row.id)}
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button project-admin-row-delete"
              aria-label={`删除 ${row.name}`}
              title={`删除 ${row.name}`}
              onClick={() => onDeleteProject(row.id)}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      />
    </section>
  );
}
