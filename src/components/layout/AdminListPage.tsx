import type { ComponentProps, ReactNode } from "react";
import { DataTable, type DataTableProps } from "@/components/admin/DataTable";
import { RowActionMenu, type RowActionMenuProps } from "@/components/common/RowActionMenu";
import { SectionEmpty } from "@/components/common/SectionState";
import "./admin-list-page.css";

type AdminListPageProps<Row> = {
  label: string;
  headerActions: ReactNode;
  headerContent?: ReactNode;
  filterBar: ReactNode;
  notice?: ReactNode;
  table: Omit<DataTableProps<Row>, "toolbar" | "renderRowActions" | "compactControls">;
  rowActions?: (row: Row) => RowActionMenuProps;
  emptyState: Required<Pick<ComponentProps<typeof SectionEmpty>, "message" | "actionLabel" | "onAction">>;
  detailDrawer?: ReactNode;
  tableState?: ReactNode;
};

export function AdminListPageHeader({ label, content, actions, className = "" }: {
  label: string; content: ReactNode; actions: ReactNode; className?: string;
}) {
  return <div className={`admin-list-page__header ${className}`} role="group" aria-label={`${label}操作`}>
    <div className="admin-list-page__header-content">{content}</div>
    <div className="admin-list-page__header-actions">{actions}</div>
  </div>;
}

export function AdminListPage<Row>({ label, headerActions, headerContent, filterBar, notice, table, rowActions,
  emptyState, detailDrawer, tableState }: AdminListPageProps<Row>) {
  return (
    <section className="admin-list-page" aria-label={label}>
      {headerActions || headerContent ? <AdminListPageHeader label={label} content={headerContent ?? label} actions={headerActions} /> : null}
      {notice ? <div className="admin-list-page__notice">{notice}</div> : null}
      {filterBar ? <div className="admin-list-page__filters" role="group" aria-label={`${label}筛选`}>{filterBar}</div> : null}
      {tableState ?? <DataTable {...table} compactControls visibleScrollRail emptyState={table.emptyState ?? <SectionEmpty {...emptyState} />}
        renderRowActions={rowActions ? (row) => <RowActionMenu {...rowActions(row)} /> : undefined} />}
      {detailDrawer}
    </section>
  );
}
