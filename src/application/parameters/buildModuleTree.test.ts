import { describe, expect, it } from "vitest";

import type { DtsParameterWorkbenchRow } from "@/domain/parameter-topology/workbenchTypes";
import { buildModuleTree } from "./buildModuleTree";

function row(overrides: Partial<DtsParameterWorkbenchRow>): DtsParameterWorkbenchRow {
  return {
    bindingId: "binding",
    parameterSpecId: "spec",
    parameterSpecVersionId: "spec-v",
    logicalNodeId: "logical",
    propertyKey: "gpio_int",
    driverModule: "sc8562",
    compatible: "vendor,sc8562",
    instanceName: "sc8562@6E",
    moduleId: "charge",
    moduleName: "充电策略",
    modulePath: ["充电策略"],
    importance: "high",
    moduleSortOrder: 0,
    moduleMapped: true,
    unitAddress: "6E",
    topologyPath: "/amba/i2c@FDF5E000/sc8562@6E",
    topologyNodeId: "node",
    sourceOccurrenceId: null,
    sourceFileName: null,
    sourceNodePath: null,
    sourceLine: null,
    rawValue: "<0>",
    effectiveValue: { kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "0", value: "0" }]] },
    valueShapeSummary: "cell-array · 32 bit · 1 cell",
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

describe("buildModuleTree", () => {
  it("groups bindings directly under module by default", () => {
    const tree = buildModuleTree({
      rows: [
        row({ bindingId: "b1", moduleId: "charge", moduleName: "充电策略", instanceName: "sc8562@6E", driverModule: "sc8562" }),
        row({ bindingId: "b2", moduleId: "charge", moduleName: "充电策略", instanceName: "sc8562@6E", driverModule: "sc8562", propertyKey: "watchdog_time" })
      ]
    });
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe("充电策略");
    expect(tree[0]?.bindingCount).toBe(2);
    expect(tree[0]?.children).toHaveLength(0);
    expect(tree[0]?.bindingIds).toEqual(["b1", "b2"]);
  });

  it("optionally groups bindings as module -> device/driver -> parameter", () => {
    const tree = buildModuleTree({
      groupByDevice: true,
      rows: [
        row({ bindingId: "b1", moduleId: "charge", moduleName: "充电策略", instanceName: "sc8562@6E", driverModule: "sc8562" }),
        row({ bindingId: "b2", moduleId: "charge", moduleName: "充电策略", instanceName: "sc8562@6E", driverModule: "sc8562", propertyKey: "watchdog_time" })
      ]
    });
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.bindingIds).toEqual(["b1", "b2"]);
  });

  it("keeps same-named properties distinct under different device/driver nodes when grouped", () => {
    const tree = buildModuleTree({
      groupByDevice: true,
      rows: [
        row({ bindingId: "sc", moduleId: "charge", moduleName: "充电策略", propertyKey: "gpio_int", driverModule: "sc8562", instanceName: "sc8562@6E" }),
        row({ bindingId: "mt", moduleId: "charge", moduleName: "充电策略", propertyKey: "gpio_int", driverModule: "mt5788", instanceName: "mt5788@2B" })
      ]
    });
    expect(tree[0]?.children).toHaveLength(2);
    const deviceBindingIds = tree[0]?.children.map((child) => child.bindingIds).flat();
    expect(deviceBindingIds).toContain("sc");
    expect(deviceBindingIds).toContain("mt");
  });

  it("aggregates attention counts up to the module node", () => {
    const tree = buildModuleTree({
      rows: [
        row({ bindingId: "ok", governanceState: "valid" }),
        row({ bindingId: "warn", governanceState: "attention", instanceName: "sc8562@6E" })
      ]
    });
    expect(tree[0]?.attentionCount).toBe(1);
  });

  it("separates bindings into different module roots", () => {
    const tree = buildModuleTree({
      rows: [
        row({ bindingId: "c", moduleId: "charge", moduleName: "充电策略" }),
        row({ bindingId: "s", moduleId: "safety", moduleName: "电池安全", driverModule: "bq", instanceName: "bq@1" })
      ]
    });
    expect(tree).toHaveLength(2);
  });

  it("orders module roots by moduleSortOrder before label", () => {
    const tree = buildModuleTree({
      rows: [
        row({ bindingId: "z", moduleId: "zeta", moduleName: "Z模块", moduleSortOrder: 2 }),
        row({ bindingId: "a", moduleId: "alpha", moduleName: "A模块", moduleSortOrder: 0, driverModule: "a", instanceName: "a@1" })
      ]
    });
    expect(tree.map((node) => node.label)).toEqual(["A模块", "Z模块"]);
  });

  it("nests instance modules under registry ancestors when modules are provided", () => {
    const tree = buildModuleTree({
      modules: [
        { id: "power", name: "Power", parentId: null, sortOrder: 0, importance: "medium" },
        { id: "battery", name: "Battery", parentId: "power", sortOrder: 1, importance: "medium" },
        { id: "balance", name: "Battery Balance", parentId: "battery", sortOrder: 2, importance: "medium" },
        { id: "bcb", name: "battery_charge_balance", parentId: "balance", sortOrder: 3, importance: "medium" },
        { id: "b0", name: "battery0", parentId: "bcb", sortOrder: 4, importance: "medium" }
      ],
      rows: [
        row({
          bindingId: "w",
          moduleId: "b0",
          moduleName: "battery0",
          moduleSortOrder: 4,
          propertyKey: "weight"
        })
      ]
    });

    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe("Battery");
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children[0]?.label).toBe("Battery Balance");
    expect(tree[0]?.children[0]?.children[0]?.label).toBe("battery_charge_balance");
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.label).toBe("battery0");
    expect(tree[0]?.bindingCount).toBe(1);
    expect(tree[0]?.children[0]?.children[0]?.children[0]?.bindingIds).toEqual(["w"]);
  });

  it("promotes children when the registry tree has a single wrapper root", () => {
    const tree = buildModuleTree({
      modules: [
        { id: "power", name: "Power", parentId: null, sortOrder: 0, importance: "medium" },
        { id: "battery", name: "Battery", parentId: "power", sortOrder: 1, importance: "medium" },
        { id: "charging", name: "Charging", parentId: "power", sortOrder: 2, importance: "medium" },
        { id: "bcb", name: "battery_charge_balance", parentId: "battery", sortOrder: 3, importance: "medium" },
        { id: "core", name: "charging_core", parentId: "charging", sortOrder: 4, importance: "medium" }
      ],
      rows: [
        row({ bindingId: "b1", moduleId: "bcb", moduleName: "battery_charge_balance", moduleSortOrder: 3 }),
        row({
          bindingId: "b2",
          moduleId: "core",
          moduleName: "charging_core",
          moduleSortOrder: 4,
          driverModule: "charging_core",
          instanceName: "charging_core"
        })
      ]
    });

    expect(tree.map((node) => node.label)).toEqual(["Battery", "Charging"]);
    expect(tree.every((node) => node.parentId === null)).toBe(true);
  });

  it("keeps flat roots when modules registry is omitted", () => {
    const tree = buildModuleTree({
      rows: [
        row({ bindingId: "b1", moduleId: "b0", moduleName: "battery0" }),
        row({ bindingId: "b2", moduleId: "bcb", moduleName: "battery_charge_balance" })
      ]
    });
    expect(tree.map((node) => node.label).sort()).toEqual(["battery0", "battery_charge_balance"]);
    expect(tree.every((node) => node.children.length === 0)).toBe(true);
  });
});
