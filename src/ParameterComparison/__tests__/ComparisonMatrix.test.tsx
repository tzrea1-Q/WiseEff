import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ComparisonMatrix } from "../components/ComparisonMatrix";
import type { ComparisonRow } from "../types";

const rows: ComparisonRow[] = [
  {
    key: "fast_charge_current_limit_ma",
    module: "Charging Policy",
    description: "限制快充阶段的最大充电电流。",
    baseValue: "3850 mA",
    targetValue: "4200 mA",
    baseNumeric: 3850,
    targetNumeric: 4200,
    unit: "mA",
    status: "drift",
    risk: "High"
  },
  {
    key: "usb_pd_profile_limit_w",
    module: "Charging Protocol",
    description: "USB-PD 协商功率上限。",
    baseValue: "33 W",
    targetValue: "33 W",
    baseNumeric: 33,
    targetNumeric: 33,
    unit: "W",
    status: "synced",
    risk: "Low"
  }
];

describe("ComparisonMatrix", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the v2 table headers and rows", () => {
    render(
      <ComparisonMatrix
        rows={rows}
        query=""
        baseProjectCode="AUR-Prod"
        targetProjectCode="NEB-RD"
        totalCount={rows.length}
        onResetFilters={() => undefined}
        onSync={() => undefined}
        onIgnore={() => undefined}
      />
    );

    expect(screen.getByRole("columnheader", { name: "参数键" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "模块" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "重要性" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "AUR-Prod" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "NEB-RD / Δ" })).toBeInTheDocument();
    expect(screen.getAllByText("fast_charge_current_limit_ma").length).toBeGreaterThan(0);
    expect(screen.getByText("Charging Policy")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("+9.1%")).toBeInTheDocument();
    expect(screen.getAllByText("已同步")).toHaveLength(2);
  });

  it("highlights parameter-key matches from the search query", () => {
    const { container } = render(
      <ComparisonMatrix
        rows={rows}
        query="fast"
        baseProjectCode="AUR-Prod"
        targetProjectCode="NEB-RD"
        totalCount={rows.length}
        onResetFilters={() => undefined}
        onSync={() => undefined}
        onIgnore={() => undefined}
      />
    );

    const highlight = container.querySelector("mark");
    expect(highlight).toHaveTextContent("fast");
  });

  it("fires row actions for drift rows", () => {
    const onSync = vi.fn();
    const onIgnore = vi.fn();
    render(
      <ComparisonMatrix
        rows={rows}
        query=""
        baseProjectCode="AUR-Prod"
        targetProjectCode="NEB-RD"
        totalCount={rows.length}
        onResetFilters={() => undefined}
        onSync={onSync}
        onIgnore={onIgnore}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "同步 fast_charge_current_limit_ma" }));
    fireEvent.click(screen.getByRole("button", { name: "忽略 fast_charge_current_limit_ma" }));

    expect(onSync).toHaveBeenCalledWith("fast_charge_current_limit_ma");
    expect(onIgnore).toHaveBeenCalledWith("fast_charge_current_limit_ma");
  });

  it("renders the filtered empty state", () => {
    const onResetFilters = vi.fn();
    render(
      <ComparisonMatrix
        rows={[]}
        query="none"
        baseProjectCode="AUR-Prod"
        targetProjectCode="NEB-RD"
        totalCount={rows.length}
        onResetFilters={onResetFilters}
        onSync={() => undefined}
        onIgnore={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    expect(screen.getByRole("heading", { name: "没有匹配参数" })).toBeInTheDocument();
    expect(onResetFilters).toHaveBeenCalledTimes(1);
  });

  it("keeps header filters only on module and importance", () => {
    const onRiskToggle = vi.fn();
    const onModuleToggle = vi.fn();

    render(
      <ComparisonMatrix
        rows={rows}
        query=""
        baseProjectCode="AUR-Prod"
        targetProjectCode="NEB-RD"
        totalCount={rows.length}
        columnFilters={[
          {
            key: "risk",
            label: "重要性",
            groupLabel: "重要性筛选",
            values: ["High", "Medium", "Low"],
            selectedValues: ["High"],
            onToggle: onRiskToggle,
            onClear: vi.fn()
          },
          {
            key: "module",
            label: "模块",
            groupLabel: "模块筛选",
            values: ["Battery Safety", "Charging Policy"],
            selectedValues: [],
            onToggle: onModuleToggle,
            onClear: vi.fn()
          }
        ]}
        onResetFilters={() => undefined}
        onSync={() => undefined}
        onIgnore={() => undefined}
      />
    );

    const riskHeader = screen.getByRole("columnheader", { name: /重要性/ });
    const moduleHeader = screen.getByRole("columnheader", { name: /模块/ });
    const descHeader = screen.getByRole("columnheader", { name: /说明/ });
    const baseHeader = screen.getByRole("columnheader", { name: /AUR-Prod/ });
    const targetHeader = screen.getByRole("columnheader", { name: /NEB-RD \/ Δ/ });

    fireEvent.click(within(riskHeader).getByRole("button", { name: "筛选重要性" }));
    fireEvent.click(within(riskHeader).getByRole("checkbox", { name: "Medium" }));
    fireEvent.click(within(moduleHeader).getByRole("button", { name: "筛选模块" }));
    fireEvent.click(within(moduleHeader).getByRole("checkbox", { name: "Battery Safety" }));

    expect(within(riskHeader).getByRole("button", { name: "筛选重要性" })).toHaveClass("active");
    expect(onRiskToggle).toHaveBeenCalledWith("Medium");
    expect(onModuleToggle).toHaveBeenCalledWith("Battery Safety");

    expect(screen.queryByRole("button", { name: "筛选参数键" })).not.toBeInTheDocument();
    expect(within(descHeader).queryByRole("button", { name: "筛选说明" })).not.toBeInTheDocument();
    expect(within(baseHeader).queryByRole("button", { name: "筛选AUR-Prod" })).not.toBeInTheDocument();
    expect(within(targetHeader).queryByRole("button", { name: "筛选NEB-RD / Δ" })).not.toBeInTheDocument();
  });
});
