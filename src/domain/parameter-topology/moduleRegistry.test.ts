import { describe, expect, it } from "vitest";

import {
  describeModuleAssignment,
  type ParameterModuleRegistry
} from "./moduleRegistry";

const registry: ParameterModuleRegistry = {
  modules: [
    { id: "charge", name: "充电策略", description: "", scope: "", parentId: null, sortOrder: 0, importance: "high", kind: "business", origin: "curated", sourceKey: null, effectiveImportance: "high", parameterCount: 0, definitionCount: 0 },
    { id: "safety", name: "电池安全", description: "", scope: "", parentId: null, sortOrder: 1, importance: "medium", kind: "business", origin: "curated", sourceKey: null, effectiveImportance: "medium", parameterCount: 0, definitionCount: 0 }
  ],
  mappings: [
    { id: "map-compat-sc8562", moduleId: "charge", matchKind: "compatible", matchValue: "vendor,sc8562", priority: 0 },
    { id: "map-node-type-sc8562", moduleId: "safety", matchKind: "node-type", matchValue: "sc8562", priority: 0 }
  ]
};

describe("describeModuleAssignment (phase 2 browse source of truth)", () => {
  it("uses effective importance consistently with the governance editor", () => {
    expect(describeModuleAssignment("safety", { driverModule: null, compatible: null, nodeType: null }, {
      ...registry, modules: [{ ...registry.modules[1]!, effectiveImportance: "high" }]
    }).importance).toBe("high");
  });
  it("keeps cleared attribution unset even when a driver mapping matches", () => {
    expect(describeModuleAssignment("", { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "sc8562" }, registry))
      .toMatchObject({ moduleId: "", moduleName: "unset", mapped: false });
  });
  it("looks up the persisted moduleId directly and reports mapped when a mapping targets it", () => {
    const assignment = describeModuleAssignment(
      "charge",
      { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "other_chip" },
      registry
    );
    expect(assignment).toMatchObject({
      moduleId: "charge",
      moduleName: "充电策略",
      importance: "high",
      sortOrder: 0,
      mapped: true
    });
  });

  it("never substitutes a different module even when a higher-priority mapping matches another module", () => {
    const assignment = describeModuleAssignment(
      "charge",
      { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "sc8562" },
      registry
    );
    expect(assignment.moduleId).toBe("charge");
    expect(assignment.moduleName).toBe("充电策略");
  });

  it("reports mapped:false when no mapping targets the persisted module (deterministic unclassified)", () => {
    const assignment = describeModuleAssignment(
      "charge",
      { driverModule: "unrelated-driver", compatible: null, nodeType: null },
      registry
    );
    expect(assignment.mapped).toBe(false);
  });

  it("falls back to an unclassified display name when the moduleId is absent from the registry", () => {
    const assignment = describeModuleAssignment(
      "pmod-org-unclassified",
      { driverModule: "mt5788", compatible: null, nodeType: null },
      registry
    );
    expect(assignment).toMatchObject({
      moduleId: "pmod-org-unclassified",
      mapped: false,
      importance: "medium"
    });
    expect(assignment.moduleName).toContain("mt5788");
  });
});
