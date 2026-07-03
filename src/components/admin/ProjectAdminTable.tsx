import { Pencil, Search } from "lucide-react";
import { useMemo } from "react";
import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";

type ProjectAdminTableProps = {
  rows: ParameterAdminProjectRow[];
  search: ParamAdminProjectsSearch;
  onUpdateSearch: (patch: Partial<ParamAdminProjectsSearch>) => void;
  onCreateProject: () => void;
  onEditProject: (projectId: string) => void;
};

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "initialized", label: "在研" },
  { value: "maintenance", label: "维护" },
  { value: "initialization_pending_review", label: "待审阅" },
  { value: "initialization_rejected", label: "已驳回" },
  { value: "not_initialized", label: "未初始化" }
];

function filterRows(rows: ParameterAdminProjectRow[], search: ParamAdminProjectsSearch) {
  const query = search.q.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesQuery =
      !query || row.name.toLowerCase().includes(query) || row.code.toLowerCase().includes(query) || row.id.toLowerCase().includes(query);
    const matchesStatus = search.status === "all" || row.status === search.status;
    return matchesQuery && matchesStatus;
  });
}

function sortRows(rows: ParameterAdminProjectRow[], sort: string) {
  const next = [...rows];
  next.sort((left, right) => {
    switch (sort) {
      case "updated-desc":
        return right.updatedAt.localeCompare(left.updatedAt);
      case "parameters-desc":
        return right.parameterCount - left.parameterCount || left.name.localeCompare(right.name, "zh-CN");
      case "name-desc":
        return right.name.localeCompare(left.name, "zh-CN");
      case "name-asc":
      default:
        return left.name.localeCompare(right.name, "zh-CN");
    }
  });
  return next;
}

export function ProjectAdminTable({ rows, search, onUpdateSearch, onCreateProject, onEditProject }: ProjectAdminTableProps) {
  const filteredRows = useMemo(() => sortRows(filterRows(rows, search), search.sort), [rows, search]);
  const filtersActive = search.q.trim().length > 0 || search.status !== "all";

  return (
    <section className="parameters-table param-admin-library-table project-admin-library-table">
      <div className="parameters-table-heading">
        <div>
          <h2>项目清单</h2>
          <p>维护项目基础信息与初始化状态，通过操作列进入弹窗编辑。</p>
        </div>
        <div className="param-admin-library-heading-actions">
          <button type="button" className="button primary" onClick={onCreateProject}>
            新建项目
          </button>
        </div>
      </div>

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
          <select
            aria-label="状态筛选"
            className="library-sort"
            value={search.status}
            onChange={(event) => onUpdateSearch({ status: event.target.value })}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            aria-label="排序"
            className="library-sort"
            value={search.sort}
            onChange={(event) => onUpdateSearch({ sort: event.target.value })}
          >
            <option value="name-asc">名称 A-Z</option>
            <option value="name-desc">名称 Z-A</option>
            <option value="updated-desc">最近更新</option>
            <option value="parameters-desc">参数数量</option>
          </select>
          {filtersActive ? (
            <button
              aria-label="清除筛选"
              className="clear-filters"
              type="button"
              onClick={() => onUpdateSearch({ q: "", status: "all" })}
            >
              清除筛选
            </button>
          ) : null}
        </div>
        <span className="parameters-table-count">
          {filteredRows.length} / {rows.length} 项
        </span>
      </div>

      <div className="parameters-table-scroll">
        <table aria-label="项目管理列表" className="parameters-table-grid project-admin-library-grid">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">项目名称</th>
              <th scope="col">项目代号</th>
              <th scope="col">状态</th>
              <th scope="col">模块</th>
              <th scope="col">参数</th>
              <th scope="col">最近更新</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, index) => (
              <tr key={row.id}>
                <td data-label="#">{index + 1}</td>
                <td data-label="项目名称">
                  <strong>{row.name}</strong>
                </td>
                <td data-label="项目代号" className="mono">
                  {row.code}
                </td>
                <td data-label="状态">
                  <span className={`project-admin-status project-admin-status--${row.status}`}>{row.statusLabel}</span>
                </td>
                <td data-label="模块" className="project-admin-col-numeric">
                  {row.moduleCount}
                </td>
                <td data-label="参数" className="project-admin-col-numeric">
                  {row.parameterCount}
                </td>
                <td data-label="最近更新" className="project-admin-col-updated-cell">
                  {row.updatedAtLabel}
                </td>
                <td data-label="操作">
                  <div className="param-admin-row-actions project-admin-row-actions">
                    <button
                      type="button"
                      className="icon-button project-admin-row-edit"
                      aria-label={`编辑 ${row.name}`}
                      title={`编辑 ${row.name}`}
                      onClick={() => onEditProject(row.id)}
                    >
                      <Pencil size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredRows.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有匹配的项目。调整筛选条件，或新建第一个项目。</p>
          {filtersActive ? (
            <button type="button" className="button subtle" onClick={() => onUpdateSearch({ q: "", status: "all" })}>
              清除筛选条件
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
