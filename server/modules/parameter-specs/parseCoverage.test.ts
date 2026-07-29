import { describe, expect, it } from "vitest";

import { matchDriver } from "./matcher";
import { lookupParseCoverage } from "./parseCoverage";
import type { DriverSchema, SchemaCatalog, SchemaRegistry, SchemaSource } from "./types";

const emptyCatalog: SchemaCatalog = {
  linuxDtSchemaRevision: "test-stub",
  dtschemaVersion: "2026.6",
  vendorContentHash: "synthetic",
  importedAt: "2026-07-16T00:00:00.000Z",
  schemaPaths: [],
};

function driver(input: {
  id: string;
  compatible: string;
  patterns?: string[];
  source?: SchemaSource;
}): DriverSchema {
  const patterns = input.patterns ?? [input.compatible];
  return {
    id: input.id,
    compatible: input.compatible,
    compatiblePatterns: patterns,
    nodenamePatterns: [],
    source: input.source ?? "vendor",
    schemaNamespace: `synthetic/${input.id}`,
    version: 1,
    lifecycle: "active",
    propertyIds: [],
    commonRefs: [],
  };
}

function registryOf(...drivers: DriverSchema[]): SchemaRegistry {
  return {
    catalog: emptyCatalog,
    drivers,
    properties: [],
    propertiesById: new Map(),
    driversById: new Map(drivers.map((entry) => [entry.id, entry])),
  };
}

describe("lookupParseCoverage", () => {
  it("reports uncovered when no pinned schema claims the compatible", () => {
    const registry = registryOf(driver({ id: "sc8562", compatible: "sc8562" }));

    expect(lookupParseCoverage("vendor,unknown-ic", registry)).toEqual({ covered: false });
  });

  it("names the exact pattern when a schema claims the compatible", () => {
    const registry = registryOf(driver({ id: "sc8562", compatible: "sc8562" }));

    expect(lookupParseCoverage("sc8562", registry)).toEqual({
      covered: true,
      pattern: "sc8562",
      driverId: "sc8562",
      source: "vendor",
    });
  });

  it("names the prefix pattern when that is how the schema covers the compatible", () => {
    const registry = registryOf(
      driver({
        id: "sc85-family",
        compatible: "sc85*",
        patterns: ["sc85*"],
      }),
    );

    expect(lookupParseCoverage("sc8562", registry)).toEqual({
      covered: true,
      pattern: "sc85*",
      driverId: "sc85-family",
      source: "vendor",
    });
  });

  it("agrees with matchDriver on whether a node is covered", () => {
    const registry = registryOf(
      driver({ id: "exact", compatible: "sc8562" }),
      driver({ id: "prefix", compatible: "mt57*", patterns: ["mt57*"] }),
    );

    for (const compatible of ["sc8562", "mt5788", "vendor,orphan"]) {
      const coverage = lookupParseCoverage(compatible, registry);
      const decision = matchDriver({ name: "n", compatible: [compatible], properties: {}, nodeLocator: "/n" }, registry);
      expect(coverage.covered).toBe(decision.kind === "matched");
    }
  });
});
