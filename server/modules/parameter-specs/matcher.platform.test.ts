import { describe, expect, it } from "vitest";

import { matchDriver } from "./matcher";
import type { DriverSchema, PropertySpec, SchemaRegistry } from "./types";

function registry(drivers: DriverSchema[], properties: PropertySpec[] = []): SchemaRegistry {
  return {
    catalog: {
      linuxDtSchemaRevision: "test",
      dtschemaVersion: "2026.6",
      vendorContentHash: "hash",
      importedAt: "2026-07-29T00:00:00.000Z",
      schemaPaths: [],
    },
    drivers,
    properties,
    driversById: new Map(drivers.map((driver) => [driver.id, driver])),
    propertiesById: new Map(properties.map((property) => [property.id, property])),
  };
}

describe("matchDriver platform-manual tier", () => {
  it("prefers platform-manual over organization-manual for the same compatible", () => {
    const platformDriver: DriverSchema = {
      id: "driver:platform/vendor,chip:v1",
      compatible: "vendor,chip",
      compatiblePatterns: ["vendor,chip"],
      nodenamePatterns: [],
      source: "manual",
      scope: "platform",
      schemaNamespace: "platform/vendor,chip",
      version: 1,
      lifecycle: "active",
      propertyIds: [],
      commonRefs: [],
    };
    const orgDriver: DriverSchema = {
      id: "driver:org/org-a/vendor,chip:v1",
      compatible: "vendor,chip",
      compatiblePatterns: ["vendor,chip"],
      nodenamePatterns: [],
      source: "manual",
      scope: "organization",
      schemaNamespace: "org/org-a/vendor,chip",
      version: 1,
      lifecycle: "active",
      propertyIds: [],
      commonRefs: [],
    };
    const decision = matchDriver(
      {
        nodeLocator: "/soc/chip",
        name: "chip",
        compatible: ["vendor,chip"],
        properties: {},
      },
      registry([platformDriver, orgDriver]),
    );
    expect(decision.kind).toBe("matched");
    if (decision.kind === "matched") {
      expect(decision.value.id).toBe(platformDriver.id);
    }
  });
});
