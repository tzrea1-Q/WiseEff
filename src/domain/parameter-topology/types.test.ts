import { describe, expect, it } from "vitest";

import {
  buildInitializationSuggestion,
  type ParameterSpecDetail,
  type ProjectParameterBinding
} from "./types";

describe("parameter-topology domain contracts", () => {
  it("keeps binding identity fields separate from locators", () => {
    const binding = {
      id: "binding-1",
      parameterSpecId: "spec-1",
      parameterSpecVersionId: "spec-ver-1",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      logicalNodeId: "logical-1",
      instanceName: "sc8562@6E",
      locator: "/amba/i2c@FDF5E000/sc8562@6E",
      effectiveValue: { kind: "empty" },
      rawValue: "",
      schemaState: "unreviewed",
      policyState: "not_applicable",
      moduleId: "mod-charging"
    } satisfies ProjectParameterBinding;

    expect(binding.propertyKey).toBe("gpio_int");
    expect(binding.driverModule).toBe("sc8562");
    expect(binding.instanceName).toBe("sc8562@6E");
    expect(binding.locator).toBe("/amba/i2c@FDF5E000/sc8562@6E");
    expect(binding).not.toHaveProperty("recommendedValue");
    expect(binding).not.toHaveProperty("path");
  });

  it("keeps exampleValue, schemaDefault, and policyTarget as distinct fields", () => {
    const spec = {
      id: "spec-1",
      sourceKind: "dts",
      specificationKey: "sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: "v1",
      currentVersion: 1,
      displayName: null,
      description: null,
      valueShape: null,
      schemaDefault: { kind: "empty" },
      exampleValue: { kind: "boolean", present: true },
      schemaNamespace: null,
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: { kind: "strings", values: ["okay"] }
    } satisfies ParameterSpecDetail;

    expect(spec.exampleValue).not.toEqual(spec.schemaDefault);
    expect(spec.schemaDefault).not.toEqual(spec.policyTarget);
    expect(spec).not.toHaveProperty("recommendedValue");
  });

  it("builds initialization suggestions from policyTarget then schemaDefault only", () => {
    expect(
      buildInitializationSuggestion({
        policyTarget: "policy",
        schemaDefault: "default",
        exampleValue: "example"
      })
    ).toEqual({
      suggestion: "policy",
      source: "policyTarget",
      exampleValue: "example",
      exampleEnforced: false
    });

    expect(
      buildInitializationSuggestion({
        schemaDefault: "default",
        exampleValue: "example"
      })
    ).toEqual({
      suggestion: "default",
      source: "schemaDefault",
      exampleValue: "example",
      exampleEnforced: false
    });

    expect(buildInitializationSuggestion({ exampleValue: "example" })).toEqual({
      suggestion: null,
      source: null,
      exampleValue: "example",
      exampleEnforced: false
    });
  });
});
