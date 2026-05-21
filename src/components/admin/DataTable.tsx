import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: ReactNode;
  headerFilter?: ReactNode;
  render: (row: T) => ReactNode;
  sortAccessor?: (row: T) => string | number;
  align?: "left" | "center" | "right";
  widthClass?: string;
  className?: string;
};

export type DataTableColumn<TData> = Column<TData> & {
  header: string;
  sortable?: boolean;
};

export type DataTableSort = {
  key: string;
  direction: "asc" | "desc";
};

export type DataTableProps<TData> = {
  rows: TData[];
  rowKey: (row: TData) => string;
  columns: Array<Column<TData> | DataTableColumn<TData>>;
  onRowClick?: (row: TData) => void;
  selectedRowKey?: string;
  toolbar?: ReactNode;
  emptyState?: ReactNode;
  emptyMessage?: string;
  pageSize?: number;
  ariaLabel?: string;
  "aria-label"?: string;
  sort?: DataTableSort;
  onSort?: (key: string) => void;
  renderRowActions?: (row: TData) => ReactNode;
  className?: string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

const alignClass = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
} as const;

function getColumnAccessor<TData>(column: Column<TData> | DataTableColumn<TData>) {
  if (column.sortAccessor) {
    return column.sortAccessor;
  }
  if ("sortable" in column && column.sortable) {
    return (row: TData) => {
      const value = (row as Record<string, unknown>)[column.key];
      return typeof value === "number" || typeof value === "string" ? value : "";
    };
  }
  return undefined;
}

export function DataTable<TData>({
  rows,
  rowKey,
  columns,
  onRowClick,
  selectedRowKey,
  toolbar,
  emptyState,
  emptyMessage = "当前筛选条件下没有数据。",
  pageSize = 10,
  ariaLabel,
  "aria-label": ariaLabelProp,
  sort: controlledSort,
  onSort,
  renderRowActions,
  className
}: DataTableProps<TData>) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const activeSort = controlledSort ? { key: controlledSort.key, dir: controlledSort.direction } : sort;
  const tableLabel = ariaLabelProp ?? ariaLabel;
  const hasActions = Boolean(renderRowActions);
  const hasHeaderFilters = columns.some((column) => Boolean(column.headerFilter));

  const sortedRows = useMemo(() => {
    if (!activeSort) {
      return rows;
    }
    const column = columns.find((candidate) => candidate.key === activeSort.key);
    const accessor = column ? getColumnAccessor(column) : undefined;

    if (!accessor) {
      return rows;
    }

    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av < bv) {
        return activeSort.dir === "asc" ? -1 : 1;
      }
      if (av > bv) {
        return activeSort.dir === "asc" ? 1 : -1;
      }
      return 0;
    });
  }, [activeSort, columns, rows]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, pageSize, sortedRows]
  );

  const handleSort = (column: Column<TData> | DataTableColumn<TData>) => {
    const accessor = getColumnAccessor(column);
    if (!accessor) {
      return;
    }
    setPage(1);
    if (onSort) {
      onSort(column.key);
      return;
    }
    setSort((previous) => {
      if (!previous || previous.key !== column.key) {
        return { key: column.key, dir: "asc" };
      }
      if (previous.dir === "asc") {
        return { key: column.key, dir: "desc" };
      }
      return null;
    });
  };

  const ariaSortOf = (column: Column<TData> | DataTableColumn<TData>): "none" | "ascending" | "descending" => {
    if (!activeSort || activeSort.key !== column.key) {
      return "none";
    }
    return activeSort.dir === "asc" ? "ascending" : "descending";
  };

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", hasHeaderFilters && "overflow-visible", className)}>
      {toolbar ? <div className="border-b border-border p-3">{toolbar}</div> : null}
      {sortedRows.length === 0 ? (
        <div className="p-8 text-center">{emptyState ?? <p className="text-sm text-muted-foreground">{emptyMessage}</p>}</div>
      ) : (
        <>
          <div className={cn("overflow-x-auto", hasHeaderFilters && "overflow-visible")}>
            {/* M7 note: narrow screens use horizontal overflow; card-style row folding belongs in a later dedicated spec. */}
            <table aria-label={tableLabel} className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {columns.map((column) => {
                    const alignment = column.align ?? "left";
                    const accessor = getColumnAccessor(column);
                    const sortState = ariaSortOf(column);

                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={sortState}
                        className={cn(
                          "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                          alignClass[alignment],
                          column.widthClass,
                          column.className
                        )}
                      >
                        {accessor ? (
                          <button
                            type="button"
                            aria-sort={sortState}
                            onClick={() => handleSort(column)}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground",
                              alignment === "right" && "justify-end"
                            )}
                          >
                            <span>{column.header}</span>
                            {sortState === "ascending" ? (
                              <ChevronUp className="size-3" />
                            ) : sortState === "descending" ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronsUpDown className="size-3 opacity-50" />
                            )}
                          </button>
                        ) : (
                          <span>{column.header}</span>
                        )}
                        {column.headerFilter ? <span className="data-table-column-filter">{column.headerFilter}</span> : null}
                      </th>
                    );
                  })}
                  {hasActions ? (
                    <th scope="col" aria-sort="none" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      操作
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const key = rowKey(row);
                  const selected = selectedRowKey === key;
                  const clickable = Boolean(onRowClick);

                  return (
                    <tr
                      key={key}
                      aria-selected={selected}
                      data-selected={selected ? "true" : "false"}
                      tabIndex={clickable ? 0 : undefined}
                      className={cn(
                        "border-b border-border last:border-b-0",
                        selected && "bg-primary/5",
                        clickable &&
                          "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      )}
                      onClick={() => onRowClick?.(row)}
                      onKeyDown={(event) => {
                        if (!clickable) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowClick?.(row);
                        }
                      }}
                    >
                      {columns.map((column) => {
                        const alignment = column.align ?? "left";

                        return (
                          <td
                            key={column.key}
                            className={cn("px-4 py-3 align-middle text-foreground", alignClass[alignment], column.className)}
                          >
                            {column.render(row)}
                          </td>
                        );
                      })}
                      {renderRowActions ? <td className="px-4 py-3 text-right align-middle">{renderRowActions(row)}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                第 {currentPage} / {totalPages} 页 · 共 {sortedRows.length} 条
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="上一页"
                  disabled={currentPage === 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="下一页"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="inline-flex size-7 items-center justify-center rounded-md border border-border transition-colors hover:bg-muted disabled:opacity-40"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
