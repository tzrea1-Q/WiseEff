import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    updatedAtTs: "2026-05-10T08:00:00Z"
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
    updatedAtTs: "2026-05-10T05:00:00Z"
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
    updatedAtTs: "2026-05-09T10:00:00Z"
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
});
