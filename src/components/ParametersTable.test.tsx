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
    setup();

    expect(screen.getByRole("columnheader", { name: "当前 → 推荐" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "当前值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "推荐值" })).not.toBeInTheDocument();
    const fastChargeRow = screen.getByRole("checkbox", { name: /fast_charge/ }).closest("tr");
    const diffCell = fastChargeRow?.querySelector<HTMLTableCellElement>("td[data-label='当前 → 推荐']");

    expect(diffCell).toBeInTheDocument();
    expect(diffCell?.querySelector(".parameter-value-diff")).toHaveTextContent("3800");
    expect(diffCell?.querySelector(".parameter-value-diff")).toHaveTextContent("3200");
  });

  it("adds high-risk row styling and module badge hooks", () => {
    setup();
    const highRiskRow = screen.getByRole("checkbox", { name: /fast_charge/ }).closest("tr");

    expect(highRiskRow).toHaveClass("row-risk-high");
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

  it("selects one row without focusing the row", () => {
    const { onFocusRow, onSelectedIdsChange } = setup();

    fireEvent.click(screen.getByRole("checkbox", { name: /勾选 fast_charge/ }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0]).toEqual(new Set(["p1"]));
    expect(onFocusRow).not.toHaveBeenCalled();
  });

  it("selects all rows in the current view from the header checkbox", () => {
    const { onSelectedIdsChange } = setup();

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前视图" }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0]).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("removes all visible rows when the current view is already fully selected", () => {
    const { onSelectedIdsChange } = setup({ selectedIds: new Set(["p1", "p2", "p3"]) });

    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前视图" }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0].size).toBe(0);
  });

  it("marks the header checkbox indeterminate when some visible rows are selected", () => {
    setup({ selectedIds: new Set(["p1"]) });

    expect(screen.getByRole("checkbox", { name: "全选当前视图" })).toHaveProperty("indeterminate", true);
  });

  it("clicking a row calls onFocusRow with that row id", () => {
    const { onFocusRow } = setup();

    fireEvent.click(screen.getByText("battery_temp_target_c"));

    expect(onFocusRow).toHaveBeenCalledWith("p2");
  });

  it("selects only filtered visible rows from the header checkbox", () => {
    const { onSelectedIdsChange } = setup();

    fireEvent.change(screen.getByLabelText("按名称 / 描述 / 模块搜索"), { target: { value: "charge" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前视图" }));

    expect(onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSelectedIdsChange.mock.calls[0][0]).toEqual(new Set(["p1"]));
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

  it("turns the parameter table into mobile cards instead of a forced wide grid", () => {
    const styles = readFileSync(resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain(".parameters-table-grid thead");
    expect(styles).toContain("display: none");
    expect(styles).toContain(".parameters-table-grid tbody tr");
    expect(styles).toContain("display: grid");
    expect(styles).not.toMatch(/@media \(max-width: 900px\)[\s\S]*?\.parameters-table-grid\s*\{[^}]*min-width:\s*980px/);
  });
});
