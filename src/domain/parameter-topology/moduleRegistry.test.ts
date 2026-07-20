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
    { id: "charge", name: "充电策略", parentId: null, sortOrder: 0, importance: "high" },
    { id: "safety", name: "电池安全", parentId: null, sortOrder: 1, importance: "medium" }
  ],
  mappings: [
    { id: "map-driver-sc8562", moduleId: "charge", matchKind: "driver", matchValue: "sc8562", priority: 0 },
    { id: "map-instance-sc8562-6e", moduleId: "safety", matchKind: "instance", matchValue: "sc8562@6E", priority: 0 }
  ]
};

describe("deriveModuleAssignment", () => {
  it("falls back to a driver module when the registry is empty", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", instanceName: "sc8562@6E" },
      EMPTY_PARAMETER_MODULE_REGISTRY
    );
    expect(assignment.mapped).toBe(false);
    expect(assignment.moduleId).toBe(driverFallbackModuleId("sc8562"));
    expect(assignment.moduleName).toContain("sc8562");
  });

  it("prefers instance matches over driver matches", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", instanceName: "sc8562@6E" },
      registry
    );
    expect(assignment.mapped).toBe(true);
    expect(assignment.moduleId).toBe("safety");
    expect(assignment.importance).toBe("medium");
  });

  it("uses the driver mapping when no higher-priority rule matches", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: "vendor,sc8562", instanceName: "sc8562@7F" },
      registry
    );
    expect(assignment.mapped).toBe(true);
    expect(assignment.moduleId).toBe("charge");
  });

  it("matches case-insensitively", () => {
    const assignment = deriveModuleAssignment(
      { driverModule: "SC8562", compatible: null, instanceName: null },
      registry
    );
    expect(assignment.moduleId).toBe("charge");
  });

  it("prefers instance matches over driver matches even when driver priority is very high", () => {
    const skewed: ParameterModuleRegistry = {
      ...registry,
      mappings: [
        { id: "map-driver-high", moduleId: "charge", matchKind: "driver", matchValue: "sc8562", priority: 999 },
        { id: "map-instance", moduleId: "safety", matchKind: "instance", matchValue: "sc8562@6E", priority: 0 }
      ]
    };
    const assignment = deriveModuleAssignment(
      { driverModule: "sc8562", compatible: null, instanceName: "sc8562@6E" },
      skewed
    );
    expect(assignment.moduleId).toBe("safety");
  });

  it("uses a declared v1 module when no mapping matches", () => {
    const assignment = deriveModuleAssignment(
      {
        driverModule: "unknown",
        compatible: null,
        instanceName: null,
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
      { driverModule: "mt5788", compatible: null, instanceName: null },
      registry
    );
    const other = deriveModuleAssignment(
      { driverModule: "bq25980", compatible: null, instanceName: null },
      registry
    );
    expect(sc.moduleId).not.toBe(other.moduleId);
  });
});

describe("describeModuleAssignment (phase 2 browse source of truth)", () => {
  it("looks up the persisted moduleId directly and reports mapped when a mapping targets it", () => {
    const assignment = describeModuleAssignment(
      "charge",
      { driverModule: "sc8562", compatible: "vendor,sc8562", instanceName: "sc8562@7F" },
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
    // A mapping exists that would resolve "sc8562@6E" to "safety" via deriveModuleAssignment,
    // but the binding's persisted moduleId ("charge") must win — no read-time override.
    const assignment = describeModuleAssignment(
      "charge",
      { driverModule: "sc8562", compatible: "vendor,sc8562", instanceName: "sc8562@6E" },
      registry
    );
    expect(assignment.moduleId).toBe("charge");
    expect(assignment.moduleName).toBe("充电策略");
  });

  it("reports mapped:false when no mapping targets the persisted module (deterministic unclassified)", () => {
    const assignment = describeModuleAssignment(
      "charge",
      { driverModule: "unrelated-driver", compatible: null, instanceName: null },
      registry
    );
    expect(assignment.mapped).toBe(false);
  });

  it("falls back to an unclassified display name when the moduleId is absent from the registry", () => {
    const assignment = describeModuleAssignment(
      "pmod-org-unclassified",
      { driverModule: "mt5788", compatible: null, instanceName: null },
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
