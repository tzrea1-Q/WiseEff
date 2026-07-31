import { describe, expect, it } from "vitest";

import { isReleasableDriver, isReleasableProperty } from "./schemaLoader";
import type { DriverSchema, PropertySpec } from "./types";

describe("schemaLoader soft-retirement releasability (ADR-0011 / ADR-0014)", () => {
  it("treats a deprecated property as releasable so parse coverage is preserved", () => {
    const property: PropertySpec = {
      id: "propspec:manual:volt:v1",
      parameterSpecId: "pspec:manual:volt",
      driverSchemaId: "driver:manual:sc8562",
      propertyKey: "volt",
      schemaNamespace: "manual",
      source: "manual",
      scope: "organization",
      lifecycle: "deprecated",
      valueShape: { kind: "u32" },
      constraints: {},
    };
    expect(isReleasableProperty(property)).toBe(true);
  });

  it("excludes draft properties from releasability", () => {
    const property: PropertySpec = {
      id: "propspec:manual:draft:v1",
      parameterSpecId: "pspec:manual:draft",
      driverSchemaId: "driver:manual:sc8562",
      propertyKey: "draft_prop",
      schemaNamespace: "manual",
      source: "manual",
      scope: "organization",
      lifecycle: "draft",
      valueShape: { kind: "u32" },
      constraints: {},
    };
    expect(isReleasableProperty(property)).toBe(false);
  });

  it("treats a deprecated driver as releasable", () => {
    const driver: DriverSchema = {
      id: "driver:manual:sc8562",
      compatible: "sc8562",
      compatiblePatterns: ["sc8562"],
      nodenamePatterns: [],
      source: "manual",
      scope: "organization",
      schemaNamespace: "manual",
      version: 1,
      lifecycle: "deprecated",
      propertyIds: [],
      commonRefs: [],
    };
    expect(isReleasableDriver(driver)).toBe(true);
  });
});
