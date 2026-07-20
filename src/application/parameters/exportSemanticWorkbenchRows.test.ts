import { describe, expect, it } from "vitest";

import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import { buildSemanticWorkbenchCsv } from "./exportSemanticWorkbenchRows";

function row(overrides: Partial<DtsParameterWorkbenchRow> = {}): DtsParameterWorkbenchRow {
  return {
    bindingId: "binding-1",
    parameterSpecId: "spec-1",
    parameterSpecVersionId: "spec-v-1",
    logicalNodeId: "logical-1",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatible: "vendor,sc8562",
    instanceName: "sc8562@6E",
    moduleId: "charge",
    moduleName: "充电策略",
    importance: "high",
    moduleSortOrder: 0,
    moduleMapped: true,
    unitAddress: "6E",
    topologyPath: "/amba/i2c@FDF5E000/sc8562@6E",
    topologyNodeId: "node-1",
    sourceOccurrenceId: null,
    sourceFileName: "board.dts",
    sourceNodePath: "/amba/i2c@FDF5E000/sc8562@6E",
    sourceLine: 27,
    rawValue: "<&gpio13 29 0>",
    effectiveValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "0", value: "0" }]] },
    valueShapeSummary: "cell-array",
    schemaState: "valid",
    policyState: "pass",
    mappingOpen: false,
    governanceState: "valid",
    effects: [],
    searchText: "gpio_int",
    view: "effective",
    ...overrides
  };
}

describe("buildSemanticWorkbenchCsv", () => {
  it("exports identity-aware columns without recommendedValue vocabulary", () => {
    const csv = buildSemanticWorkbenchCsv([
      row(),
      row({
        bindingId: "binding-2",
        propertyKey: "gpio_int",
        driverModule: "mt5788",
        moduleName: "充电策略",
        instanceName: "mt5788@2B",
        parameterSpecId: "spec-mt"
      })
    ]);
    expect(csv).toContain("bindingId,propertyKey,moduleName");
    expect(csv).toContain("binding-1");
    expect(csv).toContain("binding-2");
    expect(csv).toContain("充电策略");
    expect(csv).toContain("sc8562");
    expect(csv).toContain("mt5788");
    expect(csv).not.toMatch(/recommendedValue|推荐值/);
  });

  it("prefixes formula-like cells to prevent spreadsheet injection", () => {
    const csv = buildSemanticWorkbenchCsv([
      row({ rawValue: "=cmd|'/c calc'!A0", propertyKey: "+danger" })
    ]);
    expect(csv).toContain("'=cmd|'/c calc'!A0");
    expect(csv).toContain("'+danger");
  });
});
