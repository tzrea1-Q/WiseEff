import { describe, expect, it } from "vitest";
import { initialState, projects } from "../../mockData";
import { useComparisonData } from "../hooks/useComparisonData";
import type { ComparisonFilters } from "../types";

const baseFilters: ComparisonFilters = {
  driftOnly: true,
  risk: [],
  modules: [],
  query: ""
};

describe("useComparisonData", () => {
  it("builds comparison rows for the selected projects", () => {
    const data = useComparisonData({
      state: initialState,
      baseProjectId: projects[0].id,
      targetProjectId: projects[1].id,
      filters: baseFilters
    });

    const row = data.rows.find((item) => item.key === "fast_charge_current_limit_ma");
    expect(row).toMatchObject({
      module: "Charging Policy",
      baseValue: "3850 mA",
      targetValue: "4200 mA",
      baseNumeric: 3850,
      targetNumeric: 4200,
      status: "drift",
      risk: "High"
    });
  });

  it("filters synced rows out by default", () => {
    const data = useComparisonData({
      state: initialState,
      baseProjectId: projects[0].id,
      targetProjectId: projects[1].id,
      filters: baseFilters
    });

    expect(data.filteredRows.every((row) => row.status === "drift")).toBe(true);
  });

  it("applies query, risk, and module filters", () => {
    const data = useComparisonData({
      state: initialState,
      baseProjectId: projects[0].id,
      targetProjectId: projects[1].id,
      filters: {
        driftOnly: true,
        risk: ["High"],
        modules: ["Charging Policy"],
        query: "voltage"
      }
    });

    expect(data.filteredRows.map((row) => row.key)).toEqual(["charge_voltage_limit_mv"]);
  });

  it("returns metrics and module options", () => {
    const data = useComparisonData({
      state: initialState,
      baseProjectId: projects[0].id,
      targetProjectId: projects[1].id,
      filters: baseFilters
    });

    expect(data.metrics.total).toBe(data.rows.length);
    expect(data.metrics.drift).toBeGreaterThan(0);
    expect(data.metrics.highRisk).toBeGreaterThan(0);
    expect(data.moduleOptions).toContain("Charging Policy");
  });
});
