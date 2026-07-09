import { describe, expect, it } from "vitest";
import {
  buildDebugModuleTree,
  buildDebugModulesFromNodes,
  buildModuleSelectOptions,
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

  it("filters nodes by subtree module ids", () => {
    const moduleNodes = buildDebugModuleTree(nodes);
    const chargingId = legacyModuleIdFromName("Battery Charging");
    expect(filterDebugNodesByModuleTree(nodes, moduleNodes, [chargingId]).map((node) => node.id)).toEqual(["node-1"]);
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
