import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterRecord } from "@/domain/prototype/types";
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
    valueKind: "scalar",
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
    valueKind: "scalar",
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
    valueKind: "scalar",
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
  valueKind: "complex",
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

    expect(screen.getByText(/显示\s+3\s+\/\s+3\s+个参数/)).toBeInTheDocument();
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.getByText("battery_temp_target_c")).toBeInTheDocument();
    expect(screen.getByText("soc_estimation_smoothing")).toBeInTheDocument();
  });

  it("filters rows by name, description, or module search text", () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText(/搜索参数名、描述、模块或路径/), { target: { value: "fast_charge" } });

    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByText("battery_temp_target_c")).not.toBeInTheDocument();
    expect(screen.queryByText("soc_estimation_smoothing")).not.toBeInTheDocument();
  });

  it("finds a parameter by Chinese description when the name does not match", () => {
    setup({
      rows: [
        ...rows,
        {
          ...rows[0],
          id: "p-cn",
          name: "cpu_current_limit",
          description: "低温场景限制 CPU 峰值放电电流",
          module: "Thermal"
        }
      ]
    });

    fireEvent.change(screen.getByLabelText("搜索参数名、描述、模块或路径"), { target: { value: "低温" } });

    expect(screen.getByText("cpu_current_limit")).toBeInTheDocument();
    expect(screen.queryByText("fast_charge_current_limit_ma")).not.toBeInTheDocument();
  });

  it("matches mixed tokens across name and description fields", () => {
    setup({
      rows: [
        {
          ...rows[0],
          id: "p-cn",
          name: "cpu_current_limit",
          description: "低温场景限制 CPU 峰值放电电流",
          module: "Thermal"
        }
      ]
    });

    fireEvent.change(screen.getByLabelText("搜索参数名、描述、模块或路径"), { target: { value: "cpu 电流" } });

    expect(screen.getByText("cpu_current_limit")).toBeInTheDocument();
  });

  it("renders an empty state and can clear the search filter", () => {
    setup();

    fireEvent.change(screen.getByLabelText("搜索参数名、描述、模块或路径"), { target: { value: "motor" } });

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
    setup({ rows: [complexRow] });

    const dtsRow = screen.getByText("dts_fast_charge_profile_matrix").closest("tr");
    expect(dtsRow).toBeInTheDocument();
    expect(within(dtsRow!).getByText("复杂配置")).toBeInTheDocument();
    expect(within(dtsRow!).getByText("fast-charge-profile-matrix")).toBeInTheDocument();
    expect(within(dtsRow!).getByText(/当前与推荐一致/)).toBeInTheDocument();
    expect(within(dtsRow!).queryByText(/"0", "5000"/)).not.toBeInTheDocument();
  });

  it("summarizes multiline values even when valueKind is still scalar", () => {
    setup({
      rows: [
        {
          ...complexRow,
          valueKind: "scalar"
        }
      ]
    });

    expect(screen.getByText("复杂配置")).toBeInTheDocument();
    expect(screen.queryByText(/"0", "5000"/)).not.toBeInTheDocument();
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
    const isoTimestamp = "2026-06-14T12:27:58.378Z";
    setup({
      rows: [
        {
          ...rows[0],
          id: "p-api-time",
          updatedAt: isoTimestamp,
          updatedAtTs: isoTimestamp
        }
      ]
    });

    const date = new Date(Date.parse(isoTimestamp));
    const pad = (value: number) => String(value).padStart(2, "0");
    const expected = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(isoTimestamp)).not.toBeInTheDocument();
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

  it("does not render withdrawn detail controls while value editing remains available", () => {
    const onEditRow = vi.fn();
    const { onFocusRow } = setup({ onEditRow });

    expect(screen.queryByRole("button", { name: /查看 / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 battery_temp_target_c" }));
    expect(onEditRow).toHaveBeenCalledWith("p2");
    expect(onFocusRow).not.toHaveBeenCalled();
  });

  it("keeps values readable without detail or edit actions in read-only mode", () => {
    setup({ canEdit: false, onEditRow: vi.fn() });

    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看 / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑 / })).not.toBeInTheDocument();
    expect(screen.queryByText("Read only")).not.toBeInTheDocument();
  });

  it("selects only filtered visible modified rows from the header checkbox", () => {
    const { onSelectedIdsChange } = setup({ modifiedIds: new Set(["p1", "p2", "p3"]) });

    fireEvent.change(screen.getByLabelText("搜索参数名、描述、模块或路径"), { target: { value: "fast_charge" } });
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

  it("preserves caller ids when the reusable tree filter hides a structural root", () => {
    const onTreeChange = vi.fn();
    setup({
      columnFilters: [
        {
          key: "module",
          label: "模块",
          groupLabel: "模块筛选",
          mode: "tree",
          treeNodes: [
            { id: "power", label: "电源", parentId: null },
            { id: "charging", label: "充电", parentId: "power" }
          ],
          selectedTreeIds: [],
          onTreeChange,
          onClear: vi.fn()
        }
      ]
    });

    const moduleHeader = screen.getByRole("columnheader", { name: /模块/ });
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块" }));
    expect(within(moduleHeader).queryByRole("checkbox", { name: "电源" })).not.toBeInTheDocument();
    fireEvent.click(within(moduleHeader).getByRole("checkbox", { name: "充电" }));

    expect(onTreeChange).toHaveBeenCalledWith(["charging"]);
    expect(screen.getByText("fast_charge_current_limit_ma")).toBeInTheDocument();
  });

  it("right-aligns the importance filter menu away from row actions", () => {
    setup();

    const moduleHeader = screen.getByRole("columnheader", { name: /模块/ });
    const riskHeader = screen.getByRole("columnheader", { name: /重要性/ });
    expect(moduleHeader.querySelector(".parameters-column-filter")).toHaveClass("parameters-column-filter--left");
    expect(riskHeader.querySelector(".parameters-column-filter")).toHaveClass("parameters-column-filter--right");
  });

  it("keeps provided column filter identity separate from React props", () => {
    const source = readFileSync(resolve(__dirname, "ParametersTable.tsx"), "utf8");

    expect(source).not.toContain("<ColumnFilter {...providedFilter}");
  });
});
