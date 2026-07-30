import { describe, expect, it } from "vitest";

import {
  deriveModuleAssignment,
  describeModuleAssignment,
  driverFallbackModuleId,
  EMPTY_PARAMETER_MODULE_REGISTRY,
  type ParameterModuleRegistry
} from "./moduleRegistry";

const registry: ParameterModuleRegistry = {
  modules: [
    { id: "charge", name: "充电策略", parentId: null, sortOrder: 0, importance: "high", kind: "business", origin: "curated", sourceKey: null, effectiveImportance: "high", parameterCount: 0 },
    { id: "safety", name: "电池安全", parentId: null, sortOrder: 1, importance: "medium", kind: "business", origin: "curated", sourceKey: null, effectiveImportance: "medium", parameterCount: 0 }
  ],
  mappings: [
    { id: "map-compat-sc8562", moduleId: "charge", matchKind: "compatible", matchValue: "vendor,sc8562", priority: 0 },
    { id: "map-node-type-sc8562", moduleId: "safety", matchKind: "node-type", matchValue: "sc8562", priority: 0 }
  ]
};

describe("deriveModuleAssignment", () => {
  it("falls back to a driver module when the registry is empty", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "sc8562" },
      EMPTY_PARAMETER_MODULE_REGISTRY
    );
    expect(assignment.mapped).toBe(false);
    expect(assignment.moduleId).toBe(driverFallbackModuleId("sc8562"));
    expect(assignment.moduleName).toContain("sc8562");
  });

  it("prefers node-type matches over compatible matches", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "sc8562" },
      registry
    );
    expect(assignment.mapped).toBe(true);
    expect(assignment.moduleId).toBe("safety");
    expect(assignment.importance).toBe("medium");
  });

  it("uses the compatible mapping when no higher-priority rule matches", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "other_chip" },
      registry
    );
    expect(assignment.mapped).toBe(true);
    expect(assignment.moduleId).toBe("charge");
  });

  it("matches case-insensitively", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "SC8562", compatible: "Vendor,SC8562", nodeType: null },
      registry
    );
    expect(assignment.moduleId).toBe("charge");
  });

  it("prefers node-type matches over compatible matches even when compatible priority is very high", () => {
    const skewed: ParameterModuleRegistry = {
      ...registry,
      mappings: [
        { id: "map-compat-high", moduleId: "charge", matchKind: "compatible", matchValue: "vendor,sc8562", priority: 999 },
        { id: "map-node-type", moduleId: "safety", matchKind: "node-type", matchValue: "sc8562", priority: 0 }
      ]
    };
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", nodeType: "sc8562" },
      skewed
    );
    expect(assignment.moduleId).toBe("safety");
  });

  it("uses a declared v1 module when no mapping matches", () => {
    const assignment = deriveModuleAssignment(
      {
        driverModule: "unknown",
        compatible: null,
        nodeType: null,
        declaredModuleId: "charge"
      },
      registry
    );
    expect(assignment.moduleId).toBe("charge");
    expect(assignment.mapped).toBe(false);
    expect(assignment.sortOrder).toBe(0);
  });

  it("keeps unmapped drivers in distinct fallback modules", () => {
    const sc = deriveModuleAssignment(
      { driverModule: "mt5788", compatible: null, nodeType: null },
      registry
    );
    const other = deriveModuleAssignment(
      { driverModule: "bq25980", compatible: null, nodeType: null },
      registry
    );
    expect(sc.moduleId).not.toBe(other.moduleId);
  });
});

describe("describeModuleAssignment (phase 2 browse source of truth)", () => {
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
