import { describe, expect, it } from "vitest";
import { initialState, projects } from "@/mockData";
import { buildComparisonData } from "./comparison";
import type { ComparisonFilters } from "@/ParameterComparison/types";

const baseFilters: ComparisonFilters = {
  driftOnly: true,
  risk: [],
  modules: [],
  query: ""
};

describe("buildComparisonData", () => {
  it("builds comparison rows for the selected projects", () => {
    const data = buildComparisonData({
      parameters: initialState.parameters,
      baseProjectId: projects[0].id,
      targetProjectId: projects[1].id,
      filters: baseFilters
    });

    const row = data.rows.find((item) => item.key === "fast_charge_current_limit_ma");
    expect(row).toMatchObject({
      module: "Charging Policy",
      baseValue: "3850 mA",
      targetValue: "4200 mA",
      status: "drift",
      risk: "High"
    });
  });

  it("applies combined drift, risk, module, and query filters", () => {
    const data = buildComparisonData({
      parameters: initialState.parameters,
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
});
