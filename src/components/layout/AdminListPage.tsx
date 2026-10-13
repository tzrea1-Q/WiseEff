import type { ComponentProps, ReactNode } from "react";
import { DataTable, type DataTableProps } from "@/components/admin/DataTable";
import { RowActionMenu, type RowActionMenuProps } from "@/components/common/RowActionMenu";
import { SectionEmpty } from "@/components/common/SectionState";
import "./admin-list-page.css";

type AdminListPageProps<Row> = {
  label: string;
  headerActions: ReactNode;
  filterBar: ReactNode;
  notice?: ReactNode;
  table: Omit<DataTableProps<Row>, "toolbar" | "emptyState" | "renderRowActions" | "compactControls">;
  rowActions?: (row: Row) => RowActionMenuProps;
  emptyState: Required<Pick<ComponentProps<typeof SectionEmpty>, "message" | "actionLabel" | "onAction">>;
  detailDrawer?: ReactNode;
  tableState?: ReactNode;
};

export function AdminListPage<Row>({ label, headerActions, filterBar, notice, table, rowActions,
  emptyState, detailDrawer, tableState }: AdminListPageProps<Row>) {
  return (
    <section className="admin-list-page" aria-label={label}>
      <div className="admin-list-page__header" role="group" aria-label={`${label}操作`}>{headerActions}</div>
      {notice ? <div className="admin-list-page__notice">{notice}</div> : null}
      <div className="admin-list-page__filters" role="group" aria-label={`${label}筛选`}>{filterBar}</div>
      {tableState ?? <DataTable {...table} compactControls visibleScrollRail emptyState={<SectionEmpty {...emptyState} />}
        renderRowActions={rowActions ? (row) => <RowActionMenu {...rowActions(row)} /> : undefined} />}
      {detailDrawer}
    </section>
  );
}
