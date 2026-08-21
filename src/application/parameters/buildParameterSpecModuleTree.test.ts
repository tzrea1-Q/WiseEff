import { describe, expect, it } from "vitest";

import type { ParameterSpecLibraryRow } from "@/components/parameter-topology/ParameterSpecLibrary";
import {
  buildParameterSpecModuleTree,
  filterParameterSpecsByModuleNode
} from "./buildParameterSpecModuleTree";

function spec(
  id: string,
  propertyKey: string,
  attributionModules: ParameterSpecLibraryRow["attributionModules"]
): ParameterSpecLibraryRow {
  return {
    id,
    organizationId: "org-chargelab",
    propertyKey,
    attributionSubjectId: null,
    attributionModules,
    driverModule: null,
    compatible: null,
    valueType: "cells",
    valueShape: { kind: "cells" },
    schemaSource: "manual",
    schemaVersion: 1,
    exampleValue: null,
    reviewState: "active",
    usageCount: 0
  };
}

describe("buildParameterSpecModuleTree", () => {
  const specs = [
    spec("spec-gpio", "gpio_int", [
      {
        id: "module-charge",
        name: "超长充电协议参数定义模块",
        kind: "driver-group",
        path: ["Power", "Charging", "超长充电协议参数定义模块"]
      }
    ]),
    spec("spec-watchdog", "watchdog_time", [
      {
        id: "module-charge",
        name: "超长充电协议参数定义模块",
        kind: "driver-group",
        path: ["Power", "Charging", "超长充电协议参数定义模块"]
      }
    ]),
    spec("spec-thermal", "thermal_limit", [
      {
        id: "module-thermal",
        name: "Thermal",
        kind: "driver-group",
        path: ["Power", "Thermal"]
      }
    ]),
    spec("spec-unclassified", "board_id", [])
  ];

  it("builds a path-preserving definition tree with distinct subtree counts", () => {
    const tree = buildParameterSpecModuleTree(specs);

    expect(tree.map((node) => node.label)).toEqual(["Power", "未归类"]);
    expect(tree[0]?.bindingCount).toBe(3);
    expect(tree[0]?.children.map((node) => node.label)).toEqual(["Charging", "Thermal"]);
    expect(tree[0]?.children[0]?.bindingCount).toBe(2);
    expect(tree[1]?.bindingCount).toBe(1);
  });

  it("filters by the selected subtree and returns all definitions for an empty selection", () => {
    const tree = buildParameterSpecModuleTree(specs);
    const charging = tree[0]?.children[0];

    expect(
      filterParameterSpecsByModuleNode(specs, tree, charging?.id ?? null).map((item) => item.id)
    ).toEqual(["spec-gpio", "spec-watchdog"]);
    expect(filterParameterSpecsByModuleNode(specs, tree, null)).toEqual(specs);
  });
});
