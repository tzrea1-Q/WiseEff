import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterRecord } from "@/domain/prototype/types";
import { declarationFor, declarationsFor, readStylesheet } from "../test/cssAssertions";
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

  it("summarizes multiline values even when valueKind is still scalar", () => {
    setup({
      rows: [
        {
          ...complexRow,
          valueKind: "scalar"
        }
      ],
      onViewRow: vi.fn()
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

  it("keeps sticky columns anchored and gives the search wrapper a focus ring", () => {
    const styles = readStylesheet("src/styles.css");
    const firstColumn = declarationsFor(styles, ".parameters-table-grid th:first-child");
    const nameColumn = declarationsFor(styles, ".parameters-table-grid th:nth-child(2)");

    expect(firstColumn.position).toBe("sticky");
    expect(firstColumn.left).toBe("0");
    expect(nameColumn.left).toBe("48px");
    expect(declarationFor(styles, ".parameters-table-search:focus-within", "box-shadow")).toBeTruthy();
  });

  it("does not force desktop horizontal scrolling with a wide table min-width", () => {
    const styles = readStylesheet("src/styles.css");
    const tableGrid = declarationsFor(styles, ".parameters-table-grid");
    const tableHeader = declarationsFor(styles, ".parameters-table-grid th");
    const nameColumn = declarationsFor(styles, ".parameters-table-grid th:nth-child(2)");
    const scroll = declarationsFor(styles, ".parameters-table-scroll");

    expect(tableGrid["min-width"]).toBe("0");
    expect(tableGrid["table-layout"]).toBe("fixed");
    expect(tableHeader["white-space"]).toBeUndefined();
    expect(nameColumn.width).toContain("clamp(");
    expect(scroll["overflow-x"]).toBe("auto");
  });

  it("lets long DTS-style parameter descriptions wrap inside the name column", () => {
    const styles = readStylesheet("src/styles.css");
    const nameContent = declarationsFor(styles, ".parameters-table-grid td:nth-child(2) strong");
    const nameMeta = declarationsFor(styles, ".parameters-table-grid td:nth-child(2) small");

    expect(nameContent["white-space"]).toBe("normal");
    expect(nameContent["overflow-wrap"]).toBe("anywhere");
    expect(nameMeta["white-space"]).toBe("normal");
    expect(nameMeta["overflow-wrap"]).toBe("anywhere");
  });

  it("keeps multiline parameter values inside the current-to-recommended column", () => {
    const styles = readStylesheet("src/styles.css");
    const diff = declarationsFor(styles, ".parameter-value-diff");
    const diffChildSpan = declarationsFor(styles, ".parameter-value-diff > span");
    const diffChildStrong = declarationsFor(styles, ".parameter-value-diff > strong");

    expect(diff.display).toBe("grid");
    expect(diff["white-space"]).toBe("normal");
    expect(diff["max-width"]).toBe("100%");
    expect(diffChildSpan["overflow-wrap"]).toBe("anywhere");
    expect(diffChildSpan["white-space"]).toBe("pre-wrap");
    expect(diffChildStrong["overflow-wrap"]).toBe("anywhere");
    expect(diffChildStrong["white-space"]).toBe("pre-wrap");
  });

  it("keeps column filter menus usable while the table scrolls horizontally", () => {
    const styles = readStylesheet("src/styles.css");

    expect(
      declarationFor(styles, ".parameters-table--column-filters .parameters-table-scroll", "overflow-x")
    ).toBe("auto");
    expect(declarationFor(styles, ".parameters-page-layout .workbench-main", "overflow")).toBe("hidden");
    expect(declarationFor(styles, ".parameters-column-filter__menu--fixed", "position")).toBe("fixed");
  });

  it("keeps header filter buttons adjacent to header labels", () => {
    const styles = readStylesheet("src/styles.css");
    const headCell = declarationsFor(styles, ".parameters-table-head-cell");

    expect(headCell["justify-content"]).toBe("flex-start");
    expect(headCell.width).toBe("fit-content");
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

  it("turns the parameter table into mobile cards instead of a forced wide grid", () => {
    const styles = readStylesheet("src/styles.css");
    const mobile = { within: "(max-width: 960px)" };

    expect(declarationFor(styles, ".parameters-table-grid thead", "display", mobile)).toBe("none");
    expect(declarationFor(styles, ".parameters-table-grid tbody tr", "display", mobile)).toBe("grid");
    expect(
      declarationFor(styles, ".parameters-table-grid", "min-width", { within: "(max-width: 900px)" })
    ).toBe("0");
  });

  it("keeps mobile card table values readable beside their labels", () => {
    const styles = readStylesheet("src/styles.css");
    const mobile = { within: "(max-width: 960px)" };
    const mobileRow = declarationsFor(styles, ".parameters-table-grid tbody tr", mobile);
    const mobileCell = declarationsFor(styles, ".parameters-table-grid td", mobile);
    const mobileBodyCell = declarationsFor(styles, ".parameters-table-grid tbody td", mobile);
    const mobileAnyBodyCell = declarationsFor(styles, ".parameters-table-grid tbody td:nth-child(n)", mobile);

    expect(mobileRow["min-width"]).toBe("0");
    expect(mobileCell["grid-template-columns"]).toBe("minmax(76px, 0.32fr) minmax(0, 1fr)");
    expect(mobileBodyCell.width).toBe("auto");
    expect(mobileAnyBodyCell.width).toBe("auto");
    expect(mobileAnyBodyCell.left).toBe("auto");
    expect(mobileCell["overflow-wrap"]).toBe("anywhere");
    expect(mobileCell["word-break"]).toBe("normal");
  });

  it("keeps debugging toolbar search from stretching vertically on narrow viewports (TD-107)", () => {
    const styles = readStylesheet("src/styles.css");
    const searchSelector = ".debugging-page .parameters-table-search";
    const narrow = { within: "(max-width: 960px)" };

    const desktop = declarationsFor(styles, searchSelector);
    expect(desktop.flex).toBe("0 0 auto");
    expect(desktop.width).toBe("min(260px, 100%)");
    expect(desktop["flex-basis"]).toBeUndefined();

    const mobile = declarationsFor(styles, searchSelector, narrow);
    expect(mobile.width).toBe("100%");
    expect(mobile["max-width"]).toBe("none");
    expect(mobile["min-width"]).toBe("0");
    expect(mobile.height).toBe("auto");
    expect(mobile["flex-basis"]).toBeUndefined();
  });
});
