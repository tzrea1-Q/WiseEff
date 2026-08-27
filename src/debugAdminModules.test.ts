import { describe, expect, it } from "vitest";
import {
  buildDebugModuleTree,
  buildDebugModulesFromNodes,
  buildModuleSelectOptions,
  buildRuntimeDebugModuleTree,
  countDebugNodesByModuleId,
  debugNodeModuleId,
  debugNodesInModuleId,
  filterDebugNodesByModuleTree
} from "./debugAdminModules";
import { legacyModuleIdFromName } from "@/domain/modules/moduleTree";
import { createEmptyParameterModule } from "./powerManagementConfig";

const nodes = [
  {
    id: "node-1",
    name: "Fast charge current",
    description: "Brief",
    detailedDescription: "Detailed",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "Battery Charging",
    enabled: true,
    bindings: []
  },
  {
    id: "node-2",
    name: "Cycle count",
    description: "",
    detailedDescription: "",
    writeFormatExample: "",
    writeFormatHint: "",
    module: "Battery Health",
    enabled: true,
    bindings: []
  }
];

describe("debugAdminModules", () => {
  it("builds module registry from nodes and preserves existing metadata", () => {
    expect(
      buildDebugModulesFromNodes(nodes, [
        createEmptyParameterModule("Battery Charging"),
        { name: "Battery Health", description: "Health metrics", scope: "Battery" }
      ])
    ).toEqual([
      expect.objectContaining({ name: "Battery Charging" }),
      expect.objectContaining({ name: "Battery Health", description: "Health metrics", scope: "Battery" })
    ]);
  });

  it("builds flat module tree nodes from nodes", () => {
    const tree = buildDebugModuleTree(nodes);
    expect(tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: legacyModuleIdFromName("Battery Charging"), name: "Battery Charging", parentId: null })
      ])
    );
  });

  it("counts and lists nodes by module id", () => {
    const chargingId = legacyModuleIdFromName("Battery Charging");
    expect(countDebugNodesByModuleId(nodes, chargingId)).toBe(1);
    expect(debugNodesInModuleId(nodes, legacyModuleIdFromName("Battery Health")).map((node) => node.id)).toEqual(["node-2"]);
  });

  it("counts legacy name-only nodes against the matching API module id", () => {
    const apiModules = [
      { id: "dm-battery", name: "Battery Charging", parentId: null, path: "dm-battery", depth: 0 }
    ];

    expect(countDebugNodesByModuleId(nodes, "dm-battery", apiModules)).toBe(1);
    expect(debugNodesInModuleId(nodes, "dm-battery", apiModules).map((node) => node.id)).toEqual(["node-1"]);
  });

  it("filters nodes by subtree module ids", () => {
    const moduleNodes = buildDebugModuleTree(nodes);
    const chargingId = legacyModuleIdFromName("Battery Charging");
    expect(filterDebugNodesByModuleTree(nodes, moduleNodes, [chargingId]).map((node) => node.id)).toEqual(["node-1"]);
  });

  it("builds a runtime tree from API module ids and breadcrumb paths", () => {
    const runtimeNodes = [
      { id: "node-1", module: "Charging", moduleId: "debug-charging", modulePath: ["Power", "Charging"] },
      { id: "node-2", module: "Thermal", moduleId: "debug-thermal", modulePath: ["Power", "Thermal"] }
    ];
    const moduleNodes = buildRuntimeDebugModuleTree(runtimeNodes);

    expect(moduleNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "runtime:Power", name: "Power", parentId: null }),
        expect.objectContaining({ id: "debug-charging", name: "Charging", parentId: "runtime:Power" })
      ])
    );
    expect(filterDebugNodesByModuleTree(runtimeNodes, moduleNodes, ["runtime:Power"]).map((node) => node.id)).toEqual([
      "node-1",
      "node-2"
    ]);
  });

  it("reuses an explicit parent id when a parent also owns a direct node", () => {
    const runtimeNodes = [
      { id: "node-parent", module: "Power", moduleId: "debug-power", modulePath: ["Power"] },
      { id: "node-child", module: "Charging", moduleId: "debug-charging", modulePath: ["Power", "Charging"] }
    ];
    const moduleNodes = buildRuntimeDebugModuleTree(runtimeNodes);
    const powerNodes = moduleNodes.filter((node) => node.name === "Power");

    expect(powerNodes).toHaveLength(1);
    expect(powerNodes[0]).toMatchObject({ id: "debug-power", parentId: null });
    expect(filterDebugNodesByModuleTree(runtimeNodes, moduleNodes, ["debug-power"]).map((node) => node.id)).toEqual([
      "node-parent",
      "node-child"
    ]);
  });

  it("resolves debug node module id from legacy name", () => {
    expect(debugNodeModuleId(nodes[0])).toBe(legacyModuleIdFromName("Battery Charging"));
  });

  it("builds module select options and keeps the current module when missing from registry", () => {
    expect(buildModuleSelectOptions(["Battery Charging", "Battery Health"], "Legacy Module")).toEqual([
      "Battery Charging",
      "Battery Health",
      "Legacy Module"
    ]);
  });
});
