import { Pencil, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { ColumnFilter } from "@/components/ColumnFilter";
import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";

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

function filterRows(rows: ParameterAdminProjectRow[], search: ParamAdminProjectsSearch) {
  const query = search.q.trim().toLowerCase();
  const statuses = search.statuses ?? [];
  return rows.filter((row) => {
    const matchesQuery =
      !query || row.name.toLowerCase().includes(query) || row.code.toLowerCase().includes(query) || row.id.toLowerCase().includes(query);
    const matchesStatus = statuses.length === 0 || statuses.includes(row.status);
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
  const filteredRows = useMemo(() => sortRows(filterRows(rows, search), search.sort), [rows, search]);
  const selectedStatuses = search.statuses ?? [];
  const filtersActive = search.q.trim().length > 0 || selectedStatuses.length > 0;
  const statusValues = STATUS_FILTER_OPTIONS.map((option) => option.value);
  const statusLabelByValue = Object.fromEntries(
    STATUS_FILTER_OPTIONS.map((option) => [option.value, option.label])
  ) as Record<string, string>;
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRailRef = useRef<HTMLDivElement | null>(null);
  const tableScrollThumbRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scroller = tableScrollRef.current;
    const rail = tableScrollRailRef.current;
    const thumb = tableScrollThumbRef.current;
    if (!scroller || !rail || !thumb) return;

    const updateThumb = () => {
      const view = scroller.clientWidth;
      const total = scroller.scrollWidth;
      const maxScroll = Math.max(total - view, 0);
      const needsScroll = maxScroll > 1;
      rail.hidden = !needsScroll;
      if (!needsScroll) return;

      const track = Math.max(rail.clientWidth, 1);
      const thumbWidth = Math.max(Math.round((view / total) * track), 40);
      const maxThumbLeft = Math.max(track - thumbWidth, 0);
      const thumbLeft = maxScroll === 0 ? 0 : Math.round((scroller.scrollLeft / maxScroll) * maxThumbLeft);
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${thumbLeft}px)`;
    };

    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;

    const onScrollerScroll = () => updateThumb();
    const onThumbPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      dragStartX = event.clientX;
      dragStartScroll = scroller.scrollLeft;
      thumb.setPointerCapture(event.pointerId);
    };
    const onThumbPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const view = scroller.clientWidth;
      const total = scroller.scrollWidth;
      const maxScroll = Math.max(total - view, 0);
      const track = Math.max(rail.clientWidth, 1);
      const thumbWidth = Math.max(Math.round((view / total) * track), 40);
      const maxThumbLeft = Math.max(track - thumbWidth, 0);
      if (maxThumbLeft === 0 || maxScroll === 0) return;
      const delta = event.clientX - dragStartX;
      scroller.scrollLeft = dragStartScroll + (delta / maxThumbLeft) * maxScroll;
    };
    const onThumbPointerUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (thumb.hasPointerCapture(event.pointerId)) {
        thumb.releasePointerCapture(event.pointerId);
      }
    };
    const onTrackPointerDown = (event: PointerEvent) => {
      if (event.target === thumb || thumb.contains(event.target as Node)) return;
      const view = scroller.clientWidth;
      const total = scroller.scrollWidth;
      const maxScroll = Math.max(total - view, 0);
      const track = Math.max(rail.clientWidth, 1);
      const thumbWidth = Math.max(Math.round((view / total) * track), 40);
      const maxThumbLeft = Math.max(track - thumbWidth, 0);
      if (maxThumbLeft === 0 || maxScroll === 0) return;
      const rect = rail.getBoundingClientRect();
      const clickLeft = event.clientX - rect.left - thumbWidth / 2;
      scroller.scrollLeft = (Math.min(Math.max(clickLeft, 0), maxThumbLeft) / maxThumbLeft) * maxScroll;
    };

    scroller.addEventListener("scroll", onScrollerScroll, { passive: true });
    rail.addEventListener("pointerdown", onTrackPointerDown);
    thumb.addEventListener("pointerdown", onThumbPointerDown);
    thumb.addEventListener("pointermove", onThumbPointerMove);
    thumb.addEventListener("pointerup", onThumbPointerUp);
    thumb.addEventListener("pointercancel", onThumbPointerUp);
    updateThumb();
    const resizeObserver = new ResizeObserver(updateThumb);
    resizeObserver.observe(scroller);
    resizeObserver.observe(rail);
    if (scroller.firstElementChild) {
      resizeObserver.observe(scroller.firstElementChild);
    }

    return () => {
      scroller.removeEventListener("scroll", onScrollerScroll);
      rail.removeEventListener("pointerdown", onTrackPointerDown);
      thumb.removeEventListener("pointerdown", onThumbPointerDown);
      thumb.removeEventListener("pointermove", onThumbPointerMove);
      thumb.removeEventListener("pointerup", onThumbPointerUp);
      thumb.removeEventListener("pointercancel", onThumbPointerUp);
      resizeObserver.disconnect();
    };
  }, [filteredRows.length]);

  const toggleStatus = (value: string) => {
    const next = selectedStatuses.includes(value)
      ? selectedStatuses.filter((item) => item !== value)
      : [...selectedStatuses, value];
    onUpdateSearch({ statuses: next });
  };

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

      <div className="project-admin-table-scroll-shell">
        <div className="parameters-table-scroll" ref={tableScrollRef}>
          <table aria-label="项目管理列表" className="parameters-table-grid project-admin-library-grid">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">项目名称</th>
                <th scope="col">项目代号</th>
                <th scope="col">
                  <span className="param-admin-library-head-cell">
                    <span>状态</span>
                    <ColumnFilter
                      label="状态"
                      groupLabel="状态筛选"
                      values={statusValues}
                      selectedValues={selectedStatuses}
                      renderLabel={(value) => statusLabelByValue[value] ?? value}
                      onToggle={toggleStatus}
                      onClear={() => onUpdateSearch({ statuses: [] })}
                    />
                  </span>
                </th>
                <th scope="col">冲突</th>
                <th scope="col">基线</th>
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
                  <td data-label="冲突" className="project-admin-col-numeric">
                    {row.openConflictCount > 0 ? (
                      <span className="project-admin-attention project-admin-attention--conflict">
                        {row.openConflictCount}
                      </span>
                    ) : (
                      <span className="project-admin-attention-muted">0</span>
                    )}
                  </td>
                  <td data-label="基线">
                    <span
                      className={
                        row.releasedBaselineCount > 0
                          ? "project-admin-attention project-admin-attention--baseline"
                          : "project-admin-attention-muted"
                      }
                    >
                      {row.baselineLabel}
                    </span>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          ref={tableScrollRailRef}
          className="project-admin-h-rail"
          aria-hidden="true"
        >
          <div ref={tableScrollThumbRef} className="project-admin-h-rail-thumb" />
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <div className="parameters-table-empty">
          <p>没有匹配的项目。</p>
          {filtersActive ? (
            <button type="button" className="button subtle" onClick={() => onUpdateSearch({ q: "", statuses: [] })}>
              清除筛选条件
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
