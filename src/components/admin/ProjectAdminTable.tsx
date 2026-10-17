import { useMemo, type ReactNode } from "react";
import { SearchField } from "@/components/common/SearchField";
import { filterItems } from "@/lib/search";
import { projectAdminSearchProfile } from "@/lib/search/profiles";
import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";
import { AdminListPage } from "@/components/layout/AdminListPage";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { projectDeleteConfirmation } from "./DeleteProjectDialog";
import type { Column, DataTableSort } from "./DataTable";

type ProjectAdminTableProps = {
  rows: ParameterAdminProjectRow[];
  search: ParamAdminProjectsSearch;
  onUpdateSearch: (patch: Partial<ParamAdminProjectsSearch>) => void;
  onCreateProject: () => void;
  onEditProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void | Promise<void>;
  onManageFiles: (projectId: string) => void;
  onConfigureReviewRoles?: (projectId: string) => void;
  onArchiveProject?: (projectId: string, archive: boolean) => void;
  primaryActionLabel?: string;
  detailDrawer?: ReactNode;
};

const STATUS_FILTER_OPTIONS = [
  { value: "initialized", label: "在研" },
  { value: "maintenance", label: "维护" },
  { value: "initialization_pending_review", label: "待审阅" },
  { value: "initialization_rejected", label: "已驳回" },
  { value: "not_initialized", label: "未初始化" },
  { value: "archived", label: "已归档" }
] as const;

const statusClasses: Record<string, string> = {
  initialized: "bg-[var(--success-soft)] text-[var(--success)]",
  maintenance: "bg-[var(--info-soft)] text-[var(--info)]",
  initialization_pending_review: "bg-[var(--warning-soft)] text-[var(--warning)]"
};

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
  onConfigureReviewRoles,
  onArchiveProject,
  primaryActionLabel = "管理文件",
  detailDrawer
}: ProjectAdminTableProps) {
  const selectedStatuses = search.statuses ?? [];
  const filteredRows = useMemo(
    () => {
      const searched = filterItems(rows, search.q, projectAdminSearchProfile);
      return searched.filter((row) => selectedStatuses.length === 0 ? row.status !== "archived" : selectedStatuses.includes(row.status));
    },
    [rows, search.q, selectedStatuses]
  );
  const filtersActive = search.q.trim().length > 0 || selectedStatuses.length > 0;
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
      render: (row) => <strong title={row.name}>{row.name}</strong>
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
      headerFilter: {
        label: "状态",
        groupLabel: "状态筛选",
        values: statusValues,
        selectedValues: selectedStatuses,
        getValue: (row) => row.status,
        renderLabel: (value) => statusLabelByValue[value] ?? value,
        onToggle: toggleStatus,
        onClear: () => onUpdateSearch({ statuses: [] })
      },
      render: (row) => (
        <Badge variant={row.status === "initialization_rejected" ? "destructive" : "secondary"} className={statusClasses[row.status]}>{row.statusLabel}</Badge>
      )
    },
    {
      key: "conflicts",
      header: "冲突",
      align: "center",
      className: "tabular-nums",
      render: (row) =>
        row.openConflictCount > 0 ? (
          <Badge variant="secondary" className="bg-[var(--warning-soft)] text-[var(--warning)]">
            {row.openConflictCount}
          </Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
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
              ? "text-[var(--success)] font-semibold tabular-nums"
              : "text-muted-foreground tabular-nums"
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
      className: "tabular-nums",
      render: (row) => row.moduleCount
    },
    {
      key: "parameters",
      header: "参数",
      align: "center",
      className: "tabular-nums",
      sortAccessor: (row) => row.parameterCount,
      render: (row) => row.parameterCount
    },
    {
      key: "updated",
      header: "最近更新",
      align: "center",
      className: "tabular-nums",
      sortAccessor: (row) => row.updatedAt,
      render: (row) => row.updatedAtLabel
    }
  ];

  return (
    <AdminListPage
      label="项目清单"
      detailDrawer={detailDrawer}
      headerActions={<Button type="button" onClick={onCreateProject}>新建项目</Button>}
      headerContent={<>
        <p>维护项目基础信息与初始化状态；冲突与基线列标出需要治理关注的项目。</p>
        {rows.some((row) => row.canonicalOwned) ?
          <p id="canonical-project-retention-policy">项目需保留规范历史，不能删除；可归档后从默认清单收起。</p> : null}
      </>}
      table={{
        ariaLabel: "项目管理列表", rows: filteredRows, rowKey: (row) => row.id, columns, pageSize: 10,
        page: search.page ?? 1, onPageChange: (page) => onUpdateSearch({ page }), sort: tableSort,
        onSort: (key) => onUpdateSearch({ sort: nextSearchSort(key, tableSort) }),
        onRowClick: (row) => onManageFiles(row.id)
      }}
      filterBar={
          <>
            <SearchField
              value={search.q}
              onValueChange={(value) => onUpdateSearch({ q: value })}
              placeholder="搜索项目名称、代号或 ID"
              ariaLabel="搜索项目"
            />
              {filtersActive ? (
                <Button
                  aria-label="清除筛选"
                  variant="outline" size="sm"
                  type="button"
                  onClick={() => onUpdateSearch({ q: "", statuses: [] })}
                >
                  清除筛选
                </Button>
              ) : null}
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {filteredRows.length} / {rows.length} 项
            </span>
          </>
        }
      emptyState={{ message: filtersActive ? "没有匹配的项目。" : "暂无项目。",
        actionLabel: filtersActive ? "清除筛选条件" : "新建项目",
        onAction: filtersActive ? () => onUpdateSearch({ q: "", statuses: [] }) : onCreateProject }}
      rowActions={(row) => ({
        label: `${row.name}操作`,
        primaryAction: { id: "configure", label: primaryActionLabel, ariaLabel: `${primaryActionLabel} ${row.name}`, onSelect: () => onManageFiles(row.id) },
        items: [
          ...(onConfigureReviewRoles ? [{ id: "review-roles", label: "审核角色", ariaLabel: `审核角色 ${row.name}`, onSelect: () => onConfigureReviewRoles(row.id) }] : []),
          { id: "edit", label: "编辑", ariaLabel: `编辑 ${row.name}`, onSelect: () => onEditProject(row.id) },
          ...(onArchiveProject ? [{ id: "archive", label: row.status === "archived" ? "恢复项目" : "归档",
            ariaLabel: `${row.status === "archived" ? "恢复项目" : "归档"} ${row.name}`,
            onSelect: () => onArchiveProject(row.id, row.status !== "archived") }] : []),
          { id: "delete", label: "删除", ariaLabel: `删除 ${row.name}`, disabled: row.canonicalOwned,
            descriptionId: row.canonicalOwned ? "canonical-project-retention-policy" : undefined,
            destructive: true, confirmation: projectDeleteConfirmation(row), onSelect: () => onDeleteProject(row.id) }
        ]
      })}
    />
  );
}
