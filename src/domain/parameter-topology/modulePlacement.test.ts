import { describe, expect, it } from "vitest";

import {
  BOARD_INSTANCE_MODULE_NAME,
  classifyModuleInstanceTaxonomy,
  driverGroupDisplayNameFromCompatible,
  instanceModuleNameForNode,
  isModuleScaffoldingNode,
  planInstanceModulePlacements,
  type ResolvedPlacementNode,
} from "./modulePlacement";

describe("isModuleScaffoldingNode", () => {
  it("returns true for bus and interconnect scaffolding nodes", () => {
    for (const name of ["gic", "amba", "gpio5", "gpio13", "spmi", "spmi1", "i2c@FDF5E000", "pmic@0"]) {
      expect(isModuleScaffoldingNode({ name, nodePath: name })).toBe(true);
    }
  });

  it("returns false for manageable driver and instance nodes", () => {
    expect(isModuleScaffoldingNode({ name: "scharger_v800", nodePath: "spmi1/scharger_v800" })).toBe(false);
    expect(isModuleScaffoldingNode({ name: "battery0", nodePath: "battery_charge_balance/battery0" })).toBe(false);
    expect(
      isModuleScaffoldingNode({
        name: "hl7603",
        unitAddress: "75",
        nodePath: "amba/i2c@FF24E000/hl7603@75",
      }),
    ).toBe(false);
  });
});

describe("classifyModuleInstanceTaxonomy", () => {
  it("classifies Type U, N, C, and scaffolding per the locked taxonomy", () => {
    expect(
      classifyModuleInstanceTaxonomy({
        name: "gpio5",
        compatible: "hisilicon,gpio",
        nodePath: "gpio5",
      }),
    ).toBe("scaffolding");
    expect(
      classifyModuleInstanceTaxonomy({
        name: "hl7603",
        unitAddress: "75",
        compatible: "huawei,bypass_bst_hl7603",
        nodePath: "amba/i2c@FF24E000/hl7603@75",
      }),
    ).toBe("U");
    expect(
      classifyModuleInstanceTaxonomy({
        name: "fm1230_1",
        compatible: "huawei,fm1230",
        nodePath: "fm1230_1",
      }),
    ).toBe("N");
    expect(
      classifyModuleInstanceTaxonomy({
        name: "battery0",
        nodePath: "battery_charge_balance/battery0",
      }),
    ).toBe("C");
  });
});

describe("driverGroupDisplayNameFromCompatible", () => {
  it("uses the compatible tail as the driver-group module name", () => {
    expect(driverGroupDisplayNameFromCompatible("huawei,bypass_bst_hl7603")).toBe("bypass_bst_hl7603");
    expect(driverGroupDisplayNameFromCompatible("huawei,fm1230")).toBe("fm1230");
  });
});

describe("planInstanceModulePlacements", () => {
  const nodes: ResolvedPlacementNode[] = [
    {
      name: "hl7603",
      unitAddress: "75",
      compatible: "huawei,bypass_bst_hl7603",
      nodePath: "amba/i2c@FF24E000/hl7603@75",
    },
    {
      name: "hl7603",
      unitAddress: "77",
      compatible: "huawei,bypass_bst_hl7603",
      nodePath: "amba/i2c@FF24E000/hl7603@77",
    },
    {
      name: "fm1230",
      compatible: "huawei,fm1230",
      nodePath: "fm1230",
    },
    {
      name: "fm1230_1",
      compatible: "huawei,fm1230",
      nodePath: "fm1230_1",
    },
    {
      name: "battery_charge_balance",
      compatible: "huawei,battery_charge_balance",
      nodePath: "battery_charge_balance",
    },
    {
      name: "battery0",
      nodePath: "battery_charge_balance/battery0",
    },
    {
      name: "scharger_v800",
      nodePath: "spmi1/scharger_v800",
    },
    {
      name: "scharger_v800_coul",
      nodePath: "spmi1/scharger_v800/scharger_v800_coul",
    },
  ];

  const businessCategoryForPath = (nodePath: string) => {
    if (nodePath.includes("hl7603")) return "Charger IC";
    if (nodePath.includes("fm1230")) return "Battery Authentication";
    if (nodePath.includes("battery")) return "Battery Balance";
    if (nodePath.includes("scharger")) return "Charger IC";
    return "Board Identity";
  };

  it("places Type U instances under a compatible-keyed driver group and skips scaffolding", () => {
    const plan = planInstanceModulePlacements(nodes, businessCategoryForPath);
    const hl7603Group = plan.driverGroups.get("huawei,bypass_bst_hl7603");
    expect(hl7603Group).toMatchObject({
      moduleName: "hl7603",
      businessCategory: "Charger IC",
    });
    expect(plan.instances.get("hl7603@75")).toMatchObject({
      parentModuleName: "hl7603",
      taxonomy: "U",
    });
    expect(plan.instances.get("hl7603@77")).toMatchObject({
      parentModuleName: "hl7603",
      taxonomy: "U",
    });
    expect(plan.instances.has("amba")).toBe(false);
    expect(plan.instances.has("i2c@fdf5e000")).toBe(false);
  });

  it("places Type N siblings under the same driver group", () => {
    const plan = planInstanceModulePlacements(nodes, businessCategoryForPath);
    expect(plan.driverGroups.get("huawei,fm1230")).toMatchObject({
      moduleName: "fm1230",
      businessCategory: "Battery Authentication",
    });
    expect(plan.instances.get("fm1230")).toMatchObject({ parentModuleName: "Battery Authentication", taxonomy: "N" });
    expect(plan.instances.get("fm1230_1")).toMatchObject({ parentModuleName: "fm1230", taxonomy: "N" });
  });

  it("nests Type C children under the parent instance module", () => {
    const plan = planInstanceModulePlacements(nodes, businessCategoryForPath);
    expect(plan.instances.get("battery_charge_balance")).toMatchObject({
      parentModuleName: "Battery Balance",
      taxonomy: "N",
    });
    expect(plan.instances.get("battery0")).toMatchObject({
      parentModuleName: "battery_charge_balance",
      taxonomy: "C",
    });
    expect(plan.instances.get("scharger_v800")).toMatchObject({
      parentModuleName: "Charger IC",
      taxonomy: "C",
    });
    expect(plan.instances.get("scharger_v800_coul")).toMatchObject({
      parentModuleName: "scharger_v800",
      taxonomy: "C",
    });
  });

  it("exposes the board instance module name constant", () => {
    expect(BOARD_INSTANCE_MODULE_NAME).toBe("board");
  });

  it("derives stable instance module names from node identity", () => {
    expect(instanceModuleNameForNode({ name: "hl7603", unitAddress: "75" })).toBe("hl7603@75");
    expect(instanceModuleNameForNode({ name: "fm1230_1" })).toBe("fm1230_1");
  });
});
