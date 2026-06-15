import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterRecord } from "../mockData";
import { ParametersTable, type ParametersTableProps } from "./ParametersTable";

const rows: ParameterRecord[] = [
  {
    id: "p1",
    name: "fast_charge_current_limit_ma",
    description: "Fast charge input current limit",
    explanation: "Limits fast charge current to keep thermal load controlled.",
    configFormat: "charging.fast_charge_current_limit_ma=3200",
    module: "Charging Policy",
    projectId: "aurora",
    currentValue: "3800",
    recommendedValue: "3200",
    range: "2500-3800",
    unit: "mA",
    risk: "High",
    updatedAt: "2 小时前",
    updatedAtTs: "2026-05-10T08:00:00Z",
    history: []
  },
  {
    id: "p2",
    name: "battery_temp_target_c",
    description: "Target battery pack temperature",
    explanation: "Keeps the battery target temperature below thermal foldback.",
    configFormat: "battery.temp_target_c=35",
    module: "Battery Safety",
    projectId: "aurora",
    currentValue: "38",
    recommendedValue: "35",
    range: "30-40",
    unit: "°C",
    risk: "Medium",
    updatedAt: "5 小时前",
    updatedAtTs: "2026-05-10T05:00:00Z",
    history: []
  },
  {
    id: "p3",
    name: "soc_estimation_smoothing",
    description: "SOC smoothing factor",
    explanation: "Smooths short-term battery state of charge noise.",
    configFormat: "battery.soc_estimation_smoothing=0.72",
    module: "Battery Estimation",
    projectId: "aurora",
    currentValue: "0.82",
    recommendedValue: "0.72",
    range: "0.50-0.95",
    unit: "ratio",
    risk: "Low",
    updatedAt: "1 天前",
    updatedAtTs: "2026-05-09T10:00:00Z",
    history: []
  }
];

const dtsValue = `fast-charge-profile-matrix =
  "0", "5000", "1500", "40", "entry",
  "1", "9000", "3000", "43", "balanced",
  "2", "11000", "4200", "46", "burst";`;

const complexRow: ParameterRecord = {
  id: "p-dts",
  name: "dts_fast_charge_profile_matrix",
  description: "DTS string-list fast charge profile matrix.",
  explanation: "Uses a device-tree string-list property.",
  configFormat: dtsValue,
  module: "Charging Policy",
  projectId: "aurora",
  currentValue: dtsValue,
  recommendedValue: dtsValue,
  range: "0 - 1",
  unit: "profile",
  risk: "Low",
  updatedAt: "today 14:05",
  updatedAtTs: "2026-05-10T14:05:00Z",
  history: []
};

function setup(overrides: Partial<ParametersTableProps> = {}) {
  const onSelectedIdsChange = vi.fn();
  const onFocusRow = vi.fn();

  render(
    <ParametersTable
      rows={rows}
      selectedIds={new Set()}
      onSelectedIdsChange={onSelectedIdsChange}
      focusedId={null}
      onFocusRow={onFocusRow}
      {...overrides}
    />
  );

  return { onFocusRow, onSelectedIdsChange };
}

function visibleParameterNames() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1].textContent ?? "");
}

afterEach(() => {
  cleanup();
});

describe("ParametersTable", () => {
  it("shows all rows by default with the visible count", () => {
    setup();

    expect(screen.getByText(/Showing\s+3\s+of\s+3/)).toBeInTheDocument();
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(screen.getByText("soc_estimation_smoothing")).toBeInTheDocument();
  });

  it("filters rows by name, description, or module search text", () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText(/按名称 \/ 描述 \/ 模块搜索/), { target: { value: "charge" } });

    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByText("battery_temp_target_c")).not.toBeInTheDocument();
    expect(screen.queryByText("soc_estimation_smoothing")).not.toBeInTheDocument();
  });

  it("renders an empty state and can clear the search filter", () => {
    setup();

    fireEvent.change(screen.getByLabelText("按名称 / 描述 / 模块搜索"), { target: { value: "motor" } });

    expect(screen.getByText("没有匹配的参数")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除筛选条件" }));

    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
  });

  it("keeps the input row order before a sort is selected", () => {
    setup();

    expect(visibleParameterNames()).toEqual([
      "fast_charge_current_limit_maFast charge input current limit",
      "battery_temp_target_cTarget battery pack temperature",
      "soc_estimation_smoothingSOC smoothing factor"
    ]);
  });

  it("sorts by parameter name ascending and descending from the header", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: /按 参数名称 排序/ }));

    expect(visibleParameterNames()[0]).toContain("battery_temp_target_c");

    fireEvent.click(screen.getByRole("button", { name: /按 参数名称 排序/ }));

    expect(visibleParameterNames()[0]).toContain("soc_estimation_smoothing");
  });

  it("sorts importance with high risk first", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: /按 重要性 排序/ }));

    expect(visibleParameterNames()[0]).toContain("fast_charge_current_limit_ma");
  });

  it("renders current and recommended values as one diff column", () => {
    setup({ modifiedIds: new Set(["p1"]) });

    expect(screen.getByRole("columnheader", { name: "当前 → 推荐" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "当前值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "推荐值" })).not.toBeInTheDocument();
    const fastChargeRow = screen.getByRole("checkbox", { name: /fast_charge/ }).closest("tr");
    const diffCell = fastChargeRow?.querySelector<HTMLTableCellElement>("td[data-label='当前 → 推荐']");

    expect(diffCell).toBeInTheDocument();
    expect(diffCell?.querySelector(".parameter-value-diff")).toHaveTextContent("3800");
    expect(diffCell?.querySelector(".parameter-value-diff")).toHaveTextContent("3200");
  });

  it("summarizes multiline DTS values in the table instead of expanding the full config", () => {
    setup({ rows: [complexRow], onViewRow: vi.fn() });

    const dtsRow = screen.getByText("dts_fast_charge_profile_matrix").closest("tr");
    expect(dtsRow).toBeInTheDocument();
    expect(within(dtsRow!).getByText("复杂配置")).toBeInTheDocument();
    expect(within(dtsRow!).getByText("fast-charge-profile-matrix")).toBeInTheDocument();
    expect(within(dtsRow!).getByText(/当前与推荐一致/)).toBeInTheDocument();
    expect(within(dtsRow!).queryByText(/"0", "5000"/)).not.toBeInTheDocument();
  });

  it("adds modified row styling and module badge hooks", () => {
    setup({ modifiedIds: new Set(["p1"]) });
    const modifiedRow = screen.getByRole("checkbox", { name: /fast_charge/ }).closest("tr");

    expect(modifiedRow).toHaveClass("row-modified");
    expect(document.querySelector(".module-badge")).toHaveTextContent("Charging Policy");
  });

  it("clicking the risk header reports descending sort order", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: /按 重要性 排序/ }));

    expect(screen.getByRole("button", { name: /按 重要性 排序/ }).closest("th")).toHaveAttribute(
      "aria-sort",
      "descending"
    );
  });

  it("sorts update time by ISO timestamp", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: /按 更新时间 排序/ }));

    expect(visibleParameterNames()[0]).toContain("soc_estimation_smoothing");
  });

  it("formats API ISO update timestamps for the table column", () => {
    setup({
      rows: [
        {
          ...rows[0],
          id: "p-api-time",
          updatedAt: "2026-06-14T12:27:58.378Z",
          updatedAtTs: "2026-06-14T12:27:58.378Z"
        }
      ]
    });

    expect(screen.getByText("06-14 20:27")).toBeInTheDocument();
    expect(screen.queryByText("2026-06-14T12:27:58.378Z")).not.toBeInTheDocument();
  });

  it("selects one row without focusing the row", () => {
    const { onFocusRow, onSelectedIdsChange } = setup({ modifiedIds: new Set(["p1", "p2", "p3"]) });

    fireEvent.click(screen.getByRole("checkbox", { name: /勾选 fast_charge/ }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0]).toEqual(new Set(["p1"]));
    expect(onFocusRow).not.toHaveBeenCalled();
  });

  it("selects all modified rows in the current view from the header checkbox", () => {
    const { onSelectedIdsChange } = setup({ modifiedIds: new Set(["p1", "p2", "p3"]) });

    fireEvent.click(screen.getByRole("checkbox", { name: "全选已修改项" }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0]).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("removes all visible rows when the current view is already fully selected", () => {
    const { onSelectedIdsChange } = setup({ selectedIds: new Set(["p1", "p2", "p3"]), modifiedIds: new Set(["p1", "p2", "p3"]) });

    fireEvent.click(screen.getByRole("checkbox", { name: "全选已修改项" }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0].size).toBe(0);
  });

  it("marks the header checkbox indeterminate when some visible rows are selected", () => {
    setup({ selectedIds: new Set(["p1"]), modifiedIds: new Set(["p1", "p2", "p3"]) });

    expect(screen.getByRole("checkbox", { name: "全选已修改项" })).toHaveProperty("indeterminate", true);
  });

  it("clicking a row calls onFocusRow with that row id", () => {
    const { onFocusRow } = setup();

    fireEvent.click(screen.getByText("battery_temp_target_c"));

    expect(onFocusRow).toHaveBeenCalledWith("p2");
  });

  it("renders a view action", () => {
    const onViewRow = vi.fn();
    const { onFocusRow } = setup({ onViewRow });

    fireEvent.click(screen.getByRole("button", { name: "查看 battery_temp_target_c" }));

    expect(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 battery_temp_target_c" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 soc_estimation_smoothing" })).toBeInTheDocument();
    expect(onViewRow).toHaveBeenCalledTimes(1);
    expect(onViewRow).toHaveBeenCalledWith("p2");
    expect(onFocusRow).not.toHaveBeenCalled();
  });

  it("does not render inert view actions without a view handler", () => {
    setup();

    expect(screen.queryByRole("button", { name: "查看 fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 battery_temp_target_c" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 soc_estimation_smoothing" })).not.toBeInTheDocument();
  });

  it("keeps view actions available in read-only mode without edit actions", () => {
    const onViewRow = vi.fn();
    const { onFocusRow } = setup({ canEdit: false, onViewRow, onEditRow: vi.fn() });

    fireEvent.click(screen.getByRole("button", { name: "查看 fast_charge_current_limit_ma" }));

    expect(onViewRow).toHaveBeenCalledTimes(1);
    expect(onViewRow).toHaveBeenCalledWith("p1");
    expect(onFocusRow).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "编辑 fast_charge_current_limit_ma" })).not.toBeInTheDocument();
    expect(screen.queryByText("Read only")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /查看 / })).toHaveLength(3);
  });

  it("selects only filtered visible modified rows from the header checkbox", () => {
    const { onSelectedIdsChange } = setup({ modifiedIds: new Set(["p1", "p2", "p3"]) });

    fireEvent.change(screen.getByLabelText("按名称 / 描述 / 模块搜索"), { target: { value: "charge" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "全选已修改项" }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0]).toEqual(new Set(["p1"]));
  });

  it("keeps filters only on module and importance while update time remains sortable", () => {
    setup();

    [
      ["模块", "筛选模块", "Charging Policy"],
      ["重要性", "筛选重要性", "High"]
    ].forEach(([headerName, buttonName, optionName]) => {
      const header = screen.getByRole("columnheader", { name: new RegExp(headerName) });
      const button = within(header).getByRole("button", { name: buttonName });
      fireEvent.click(button);
      expect(within(header).getByRole("group", { name: `${headerName}筛选` })).toBeInTheDocument();
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      fireEvent.click(button);
    });

    expect(screen.queryByRole("button", { name: "筛选参数名称" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选当前 → 推荐" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选范围 / 单位" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选更新时间" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按 更新时间 排序" })).toBeInTheDocument();
  });

  it("keeps sticky columns anchored and gives the search wrapper a focus ring", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toMatch(
      /\.parameters-table-grid th:first-child,\s*\.parameters-table-grid td:first-child\s*\{[^}]*position:\s*sticky;[^}]*left:\s*0;/s
    );
    expect(styles).toMatch(
      /\.parameters-table-grid th:nth-child\(2\),\s*\.parameters-table-grid td:nth-child\(2\)\s*\{[^}]*left:\s*48px;/s
    );
    expect(styles).toMatch(/\.parameters-table-search:focus-within\s*\{[^}]*box-shadow:/s);
  });

  it("does not force desktop horizontal scrolling with a wide table min-width", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const tableGridRule = styles.match(/\.parameters-table-grid\s*\{[^}]*\}/)?.[0] ?? "";
    const tableHeaderRule = styles.match(/\.parameters-table-grid th\s*\{[^}]*\}/)?.[0] ?? "";
    const nameColumnRule = styles.match(/\.parameters-table-grid th:nth-child\(2\),\s*\.parameters-table-grid td:nth-child\(2\)\s*\{[^}]*\}/)?.[0] ?? "";

    expect(tableGridRule).not.toMatch(/min-width:\s*980px/);
    expect(tableGridRule).toMatch(/min-width:\s*0/);
    expect(tableGridRule).toMatch(/table-layout:\s*fixed/);
    expect(tableHeaderRule).not.toMatch(/white-space:\s*nowrap/);
    expect(nameColumnRule).toMatch(/min-width:\s*0/);
  });

  it("lets long DTS-style parameter descriptions wrap inside the name column", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toMatch(
      /\.parameters-table-grid td:nth-child\(2\) strong,\s*\.parameters-table-grid td:nth-child\(2\) small\s*\{[^}]*white-space:\s*normal;[^}]*\}/s
    );
    expect(styles).toMatch(
      /\.parameters-table-grid td:nth-child\(2\) strong,\s*\.parameters-table-grid td:nth-child\(2\) small\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*\}/s
    );
  });

  it("keeps multiline parameter values inside the current-to-recommended column", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const diffRule = styles.match(/\.parameter-value-diff\s*\{[^}]*\}/)?.[0] ?? "";
    const diffChildRule = styles.match(/\.parameter-value-diff\s*>\s*span,\s*\.parameter-value-diff\s*>\s*strong\s*\{[^}]*\}/)?.[0] ?? "";

    expect(diffRule).toMatch(/display:\s*grid/);
    expect(diffRule).toMatch(/white-space:\s*normal/);
    expect(diffRule).toMatch(/max-width:\s*100%/);
    expect(diffChildRule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(diffChildRule).toMatch(/white-space:\s*pre-wrap/);
  });

  it("lets column filter menus escape the table scroll container", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const filteredTableRule =
      styles.match(/\.parameters-table--column-filters\s+\.parameters-table-scroll\s*\{[^}]*\}/)?.[0] ?? "";
    const parametersWorkbenchRule =
      styles.match(/\.parameters-page-layout\s+\.workbench-main\s*\{[^}]*\}/)?.[0] ?? "";

    expect(filteredTableRule).toMatch(/overflow:\s*visible/);
    expect(filteredTableRule).not.toMatch(/overflow-x:\s*auto/);
    expect(parametersWorkbenchRule).toMatch(/overflow:\s*visible/);
  });

  it("keeps header filter buttons adjacent to header labels", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const headCellRule = styles.match(/\.parameters-table-head-cell\s*\{[^}]*\}/)?.[0] ?? "";

    expect(headCellRule).toMatch(/justify-content:\s*flex-start/);
    expect(headCellRule).toMatch(/width:\s*fit-content/);
    expect(headCellRule).not.toMatch(/justify-content:\s*space-between/);
  });

  it("right-aligns the importance filter menu away from row actions", () => {
    setup();

    const headers = screen.getAllByRole("columnheader");
    expect(headers[2].querySelector(".parameters-column-filter")).toHaveClass("parameters-column-filter--left");
    expect(headers[5].querySelector(".parameters-column-filter")).toHaveClass("parameters-column-filter--right");
  });

  it("keeps provided column filter identity separate from React props", () => {
    const source = readFileSync(resolve(__dirname, "ParametersTable.tsx"), "utf8");

    expect(source).not.toContain("<ColumnFilter {...providedFilter}");
  });

  it("turns the parameter table into mobile cards instead of a forced wide grid", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain(".parameters-table-grid thead");
    expect(styles).toContain("display: none");
    expect(styles).toContain(".parameters-table-grid tbody tr");
    expect(styles).toContain("display: grid");
    expect(styles).not.toMatch(/@media \(max-width: 900px\)[\s\S]*?\.parameters-table-grid\s*\{[^}]*min-width:\s*980px/);
  });

  it("keeps mobile card table values readable beside their labels", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toMatch(/\.parameters-table-grid tbody tr\s*\{[^}]*min-width:\s*0;/s);
    expect(styles).toMatch(/\.parameters-table-grid td\s*\{[^}]*grid-template-columns:\s*minmax\(76px,\s*0\.32fr\)\s*minmax\(0,\s*1fr\);/s);
    expect(styles).toMatch(/\.parameters-table-grid tbody td\s*\{[^}]*width:\s*auto;/s);
    expect(styles).toMatch(/\.parameters-table-grid tbody td:nth-child\(n\)\s*\{[^}]*width:\s*auto;[^}]*left:\s*auto;/s);
    expect(styles).toMatch(/\.parameters-table-grid td\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(styles).toMatch(/\.parameters-table-grid td\s*\{[^}]*word-break:\s*normal;/s);
  });
});
