import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type Column, type DataTableColumn } from "./DataTable";

type Row = {
  id: string;
  name: string;
  status: "Complete" | "Failed";
  confidence: number;
};

const rows: Row[] = [
  { id: "r1", name: "charging_thermal_trace.log", status: "Complete", confidence: 92 },
  { id: "r2", name: "thermal_snapshot.bin", status: "Failed", confidence: 0 }
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "文件名", render: (row) => row.name },
  { key: "status", header: "状态", render: (row) => row.status },
  { key: "confidence", header: "置信度", render: (row) => `${row.confidence}%`, align: "right" }
];

describe("DataTable", () => {
  it("renders table headers and cells", () => {
    render(<DataTable ariaLabel="日志分析记录" columns={columns} rows={rows} rowKey={(row) => row.id} />);

    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getByRole("columnheader", { name: "文件名" })).toBeInTheDocument();
    expect(within(table).getByText("charging_thermal_trace.log")).toBeInTheDocument();
    expect(within(table).getByText("thermal_snapshot.bin")).toBeInTheDocument();
  });

  it("renders empty state when no rows", () => {
    render(
      <DataTable
        ariaLabel="日志分析记录"
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyMessage="暂无记录"
      />
    );

    expect(screen.getByText("暂无记录")).toBeInTheDocument();
  });

  it("calls onRowClick when a row is clicked", async () => {
    const onRowClick = vi.fn();

    render(<DataTable ariaLabel="日志分析记录" columns={columns} rows={rows} rowKey={(row) => row.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByRole("row", { name: /thermal_snapshot\.bin/ }));

    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("supports sortable columns", async () => {
    const onSort = vi.fn();

    render(
      <DataTable
        ariaLabel="日志分析记录"
        columns={[{ ...columns[0], sortable: true }, columns[1]]}
        rows={rows}
        rowKey={(row) => row.id}
        sort={{ key: "name", direction: "asc" }}
        onSort={onSort}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /文件名/ }));

    expect(onSort).toHaveBeenCalledWith("name");
    expect(screen.getByRole("button", { name: /文件名/ })).toHaveAttribute("aria-sort", "ascending");
  });

  it("renders selected row with aria-selected", () => {
    render(
      <DataTable
        ariaLabel="日志分析记录"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectedRowKey="r2"
      />
    );

    expect(screen.getByRole("row", { name: /thermal_snapshot\.bin/ })).toHaveAttribute("aria-selected", "true");
  });

  it("supports custom row actions", () => {
    render(
      <DataTable
        ariaLabel="日志分析记录"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        renderRowActions={(row) => <button type="button">查看 {row.id}</button>}
      />
    );

    expect(screen.getByRole("button", { name: "查看 r1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 r2" })).toBeInTheDocument();
  });
});

type SimpleRow = { id: string; name: string; score: number };

const simpleRows: SimpleRow[] = [
  { id: "r1", name: "Alpha", score: 30 },
  { id: "r2", name: "Bravo", score: 10 },
  { id: "r3", name: "Charlie", score: 20 }
];

const simpleColumns: Column<SimpleRow>[] = [
  { key: "name", header: "Name", render: (row) => row.name, sortAccessor: (row) => row.name },
  { key: "score", header: "Score", render: (row) => row.score, sortAccessor: (row) => row.score, align: "right" }
];

describe("DataTable planned API", () => {
  it("renders all rows with columns", () => {
    render(<DataTable aria-label="t" rows={simpleRows} rowKey={(row) => row.id} columns={simpleColumns} />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders empty state when no rows", () => {
    render(
      <DataTable
        aria-label="t"
        rows={[]}
        rowKey={(row: SimpleRow) => row.id}
        columns={simpleColumns}
        emptyState={<div>没有记录</div>}
      />
    );

    expect(screen.getByText("没有记录")).toBeInTheDocument();
  });

  it("sorts ascending then descending on column header click", async () => {
    render(<DataTable aria-label="t" rows={simpleRows} rowKey={(row) => row.id} columns={simpleColumns} />);
    const scoreHeader = screen.getByRole("button", { name: /Score/ });

    await userEvent.click(scoreHeader);
    let tableRows = screen.getAllByRole("row").slice(1);
    expect(within(tableRows[0]).getByText("Bravo")).toBeInTheDocument();
    expect(within(tableRows[2]).getByText("Alpha")).toBeInTheDocument();

    await userEvent.click(scoreHeader);
    tableRows = screen.getAllByRole("row").slice(1);
    expect(within(tableRows[0]).getByText("Alpha")).toBeInTheDocument();
    expect(within(tableRows[2]).getByText("Bravo")).toBeInTheDocument();
  });

  it("sets aria-sort on active column", async () => {
    render(<DataTable aria-label="t" rows={simpleRows} rowKey={(row) => row.id} columns={simpleColumns} />);
    const scoreHeader = screen.getByRole("columnheader", { name: /Score/ });

    expect(scoreHeader).toHaveAttribute("aria-sort", "none");
    await userEvent.click(within(scoreHeader).getByRole("button"));

    expect(scoreHeader).toHaveAttribute("aria-sort", "ascending");
  });

  it("triggers onRowClick with the row data", async () => {
    const onRowClick = vi.fn();

    render(
      <DataTable
        aria-label="t"
        rows={simpleRows}
        rowKey={(row) => row.id}
        columns={simpleColumns}
        onRowClick={onRowClick}
      />
    );
    await userEvent.click(screen.getByText("Bravo"));

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: "r2" }));
  });

  it("applies selected row highlight via data-selected", () => {
    render(
      <DataTable
        aria-label="t"
        rows={simpleRows}
        rowKey={(row) => row.id}
        columns={simpleColumns}
        selectedRowKey="r2"
        onRowClick={() => {}}
      />
    );

    expect(screen.getByText("Bravo").closest("tr")).toHaveAttribute("data-selected", "true");
  });

  it("paginates with pageSize=2", () => {
    render(<DataTable aria-label="t" rows={simpleRows} rowKey={(row) => row.id} columns={simpleColumns} pageSize={2} />);
    const bodyRows = screen.getAllByRole("row").slice(1);

    expect(bodyRows).toHaveLength(2);
    expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
  });

  it("goes to next page on next button", async () => {
    render(<DataTable aria-label="t" rows={simpleRows} rowKey={(row) => row.id} columns={simpleColumns} pageSize={2} />);

    await userEvent.click(screen.getByRole("button", { name: /下一页|Next/i }));

    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders toolbar slot above the table", () => {
    render(
      <DataTable
        aria-label="t"
        rows={simpleRows}
        rowKey={(row) => row.id}
        columns={simpleColumns}
        toolbar={<div>TOOLBAR</div>}
      />
    );

    expect(screen.getByText("TOOLBAR")).toBeInTheDocument();
  });

  it("supports aria-label on the table element", () => {
    render(<DataTable aria-label="Records" rows={simpleRows} rowKey={(row) => row.id} columns={simpleColumns} />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-label", "Records");
  });
});
