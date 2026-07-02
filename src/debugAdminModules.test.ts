import { describe, expect, it } from "vitest";
import { buildDebugModulesFromNodes, buildModuleSelectOptions, countDebugNodesByModule, debugNodesInModule } from "./debugAdminModules";
import { createEmptyParameterModule } from "./powerManagementConfig";

const nodes = [
  {
    id: "node-1",
    name: "Fast charge current",
    description: "Brief",
    detailedDescription: "Detailed",
    module: "Battery Charging",
    enabled: true,
    bindings: []
  },
  {
    id: "node-2",
    name: "Cycle count",
    description: "",
    detailedDescription: "",
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
        { name: "Battery Health", description: "Health metrics", owner: "Lab", scope: "Battery" }
      ])
    ).toEqual([
      expect.objectContaining({ name: "Battery Charging" }),
      expect.objectContaining({ name: "Battery Health", description: "Health metrics", owner: "Lab", scope: "Battery" })
    ]);
  });

  it("counts and lists nodes by module", () => {
    expect(countDebugNodesByModule(nodes, "Battery Charging")).toBe(1);
    expect(debugNodesInModule(nodes, "Battery Health").map((node) => node.id)).toEqual(["node-2"]);
  });

  it("builds module select options and keeps the current module when missing from registry", () => {
    expect(buildModuleSelectOptions(["Battery Charging", "Battery Health"], "Legacy Module")).toEqual([
      "Battery Charging",
      "Battery Health",
      "Legacy Module"
    ]);
  });
});
