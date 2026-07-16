import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { resolveDts, resolveDtsConfigSet } from "../dts";
import {
  bindGoldenOverlayProperties,
  collectOpenReviewTasks,
  matchDriver,
  matchProperty,
  reviewTasksForDecision,
} from "./matcher";
import { persistOpenReviewTaskDrafts } from "./repository";
import { loadSchemaRegistry } from "./schemaLoader";
import type {
  DriverSchema,
  MatchableNode,
  PropertySpec,
  SchemaCatalog,
  SchemaRegistry,
  SchemaSource,
  SpecLifecycle,
} from "./types";
import type { Queryable } from "../../shared/database/client";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const schemasRoot = join(root, "schemas/dts");

function registry(): SchemaRegistry {
  return loadSchemaRegistry(schemasRoot);
}

const emptyCatalog: SchemaCatalog = {
  linuxDtSchemaRevision: "test-stub",
  dtschemaVersion: "2026.6",
  vendorContentHash: "synthetic",
  importedAt: "2026-07-16T00:00:00.000Z",
  schemaPaths: [],
};

function prop(input: {
  id: string;
  driverSchemaId: string | null;
  propertyKey: string;
  source: SchemaSource;
  lifecycle?: SpecLifecycle;
}): PropertySpec {
  return {
    id: input.id,
    parameterSpecId: `param:${input.id}`,
    driverSchemaId: input.driverSchemaId,
    propertyKey: input.propertyKey,
    schemaNamespace: `synthetic/${input.source}`,
    source: input.source,
    lifecycle: input.lifecycle ?? "active",
    valueShape: { kind: "u32-array" },
    constraints: {},
  };
}

function driver(input: {
  id: string;
  compatible: string;
  source: SchemaSource;
  propertyIds: string[];
  lifecycle?: SpecLifecycle;
}): DriverSchema {
  return {
    id: input.id,
    compatible: input.compatible,
    compatiblePatterns: [input.compatible],
    nodenamePatterns: [],
    source: input.source,
    schemaNamespace: `synthetic/${input.source}`,
    version: 1,
    lifecycle: input.lifecycle ?? "active",
    propertyIds: input.propertyIds,
    commonRefs: [],
  };
}

/** In-memory multi-tier registry — no on-disk linux YAML required. */
function syntheticRegistry(drivers: DriverSchema[], properties: PropertySpec[]): SchemaRegistry {
  return {
    catalog: emptyCatalog,
    drivers,
    properties,
    propertiesById: new Map(properties.map((property) => [property.id, property])),
    driversById: new Map(drivers.map((entry) => [entry.id, entry])),
  };
}

function crossTierNode(properties: MatchableNode["properties"] = {}): MatchableNode {
  return {
    nodeLocator: "/test/cross-tier",
    name: "cross-tier",
    compatible: ["wiseeff,cross-tier"],
    properties,
  };
}

function nodeFromResolved(pathSuffix: string): MatchableNode {
  const overlay = readFileSync(join(seedDir, "base-power-overlay.dts"), "utf8");
  const resolved = resolveDts(overlay);
  const found = resolved.nodes.find((node) => node.nodePath === pathSuffix);
  if (!found) throw new Error(`missing node ${pathSuffix}`);
  return {
    nodeLocator: found.nodePath.startsWith("/") ? found.nodePath : `/${found.nodePath}`,
    name: found.name,
    unitAddress: found.unitAddress,
    compatible: found.compatible ? [found.compatible] : [],
    properties: Object.fromEntries(
      found.properties.map((property) => [property.name, { rawText: property.rawText }]),
    ),
  };
}

function effectiveOverlayNodes(): MatchableNode[] {
  const base = readFileSync(join(seedDir, "wiseeff-power-base.dts"), "utf8");
  const overlay = readFileSync(join(seedDir, "base-power-overlay.dts"), "utf8");
  const result = resolveDtsConfigSet({
    entryFile: "base.dts",
    includeSearchPaths: [],
    overlayOrder: ["power.dtso"],
    files: new Map([
      ["base.dts", { fileName: "base.dts", content: base }],
      ["power.dtso", { fileName: "power.dtso", content: overlay }],
    ]),
  });

  const nodes: MatchableNode[] = [];
  for (const node of result.effective.nodesByLocator.values()) {
    const compatibleProp = node.properties.get("compatible");
    const compatible =
      compatibleProp && !compatibleProp.deleted
        ? [...compatibleProp.rawText.matchAll(/"([^"]+)"/g)].map((match) => match[1])
        : [];
    const properties: MatchableNode["properties"] = {};
    for (const [key, property] of node.properties) {
      if (property.deleted) continue;
      const fromOverlay = property.sourceChain.some(
        (entry) => entry.fileName === "power.dtso" && entry.effect !== "delete",
      );
      if (!fromOverlay) continue;
      properties[key] = { rawText: property.rawText };
    }
    if (Object.keys(properties).length === 0) continue;
    nodes.push({
      nodeLocator: node.nodeLocator,
      name: node.name,
      unitAddress: node.unitAddress,
      compatible,
      properties,
    });
  }
  return nodes;
}

describe("schema registry matcher", () => {
  it("matches sc8562 via vendor schema with evidence", () => {
    const sc8562Node = nodeFromResolved("amba/i2c@FDF5E000/sc8562@6E");
    expect(matchDriver(sc8562Node, registry())).toEqual({
      kind: "matched",
      value: expect.objectContaining({ compatible: "sc8562", source: "vendor" }),
      evidence: expect.arrayContaining(["compatible=sc8562"]),
    });
  });

  it("returns ambiguous when multiple releasable drivers match", () => {
    const reg = registry();
    const ambiguousNode: MatchableNode = {
      nodeLocator: "/test/ambiguous",
      name: "ambiguous",
      compatible: ["wiseeff,test-ambiguous"],
      properties: {},
    };
    expect(matchDriver(ambiguousNode, reg).kind).toBe("ambiguous");
  });

  it("returns unmatched for unknown compatible values", () => {
    const unknownNode: MatchableNode = {
      nodeLocator: "/test/unknown",
      name: "unknown",
      compatible: ["wiseeff,does-not-exist"],
      properties: {},
    };
    expect(matchDriver(unknownNode, registry()).kind).toBe("unmatched");
  });

  it("never treats inferred drafts as releasable driver matches", () => {
    const inferredOnly: DriverSchema = {
      id: "driver:inferred:ghost",
      compatible: "wiseeff,ghost",
      compatiblePatterns: ["wiseeff,ghost"],
      source: "inferred",
      schemaNamespace: "wiseeff",
      version: 1,
      lifecycle: "draft",
      propertyIds: [],
    };
    const reg = registry();
    const withInferred: SchemaRegistry = {
      ...reg,
      drivers: [...reg.drivers, inferredOnly],
    };
    const node: MatchableNode = {
      nodeLocator: "/ghost",
      name: "ghost",
      compatible: ["wiseeff,ghost"],
      properties: { mystery: { rawText: "<1>" } },
    };
    expect(matchDriver(node, withInferred).kind).toBe("unmatched");
    const propertyDecision = matchProperty(node, "mystery", withInferred);
    expect(propertyDecision.kind).toBe("unmatched");
    expect(reviewTasksForDecision(propertyDecision, node, "mystery")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "open",
          sourceEvidence: expect.objectContaining({ propertyKey: "mystery" }),
        }),
      ]),
    );
  });

  it("creates a blocking review task instead of highest-score auto-pick on ambiguity", () => {
    const reg = registry();
    const node: MatchableNode = {
      nodeLocator: "/test/ambiguous",
      name: "ambiguous",
      compatible: ["wiseeff,test-ambiguous"],
      properties: { shared_prop: { rawText: "<1>" } },
    };
    const decision = matchProperty(node, "shared_prop", reg);
    expect(decision.kind).toBe("ambiguous");
    const tasks = reviewTasksForDecision(decision, node, "shared_prop");
    expect(tasks).toEqual([
      expect.objectContaining({
        status: "open",
        candidateSchemas: expect.any(Array),
        projectCount: expect.any(Number),
      }),
    ]);
    expect(tasks[0]?.candidateSchemas.length).toBeGreaterThan(1);
  });

  it("binds all 170 golden overlay properties to distinct reviewed gpio_int specs", () => {
    const reg = registry();
    const nodes = effectiveOverlayNodes();
    const coverage = bindGoldenOverlayProperties(nodes, reg);

    expect(coverage.totalProperties).toBe(170);
    expect(coverage.matchedProperties).toBe(170);
    expect(coverage.unmatched).toEqual([]);
    expect(coverage.ambiguous).toEqual([]);

    const gpioSpecs = coverage.bindings
      .filter((binding) => binding.propertyKey === "gpio_int")
      .map((binding) => binding.propertySpecId)
      .sort();
    expect(gpioSpecs).toHaveLength(2);
    expect(new Set(gpioSpecs).size).toBe(2);

    const sc8562 = matchProperty(nodeFromResolved("amba/i2c@FDF5E000/sc8562@6E"), "gpio_int", reg);
    const mt5788 = matchProperty(nodeFromResolved("amba/i2c@FF24E000/mt5788@2B"), "gpio_int", reg);
    expect(sc8562.kind).toBe("matched");
    expect(mt5788.kind).toBe("matched");
    if (sc8562.kind === "matched" && mt5788.kind === "matched") {
      expect(sc8562.value.id).not.toBe(mt5788.value.id);
      expect(sc8562.value.schemaNamespace).toContain("sc8562");
      expect(mt5788.value.schemaNamespace).toContain("mt5788");
    }
  });
});

describe("cross-tier schema precedence (synthetic registry)", () => {
  const compatible = "wiseeff,cross-tier";

  it("matchProperty prefers vendor over linux when both define the property (narrowing)", () => {
    const linuxProp = prop({
      id: "prop:linux:shared",
      driverSchemaId: "driver:linux:cross",
      propertyKey: "shared",
      source: "linux",
    });
    const vendorProp = prop({
      id: "prop:vendor:shared",
      driverSchemaId: "driver:vendor:cross",
      propertyKey: "shared",
      source: "vendor",
    });
    const reg = syntheticRegistry(
      [
        driver({
          id: "driver:linux:cross",
          compatible,
          source: "linux",
          propertyIds: [linuxProp.id],
        }),
        driver({
          id: "driver:vendor:cross",
          compatible,
          source: "vendor",
          propertyIds: [vendorProp.id],
        }),
      ],
      [linuxProp, vendorProp],
    );
    const decision = matchProperty(crossTierNode({ shared: { rawText: "<1>" } }), "shared", reg);
    expect(decision).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ id: vendorProp.id, source: "vendor" }),
    });
  });

  it("matchProperty keeps linux when linux+manual both define; manual only gap-fills missing keys", () => {
    const linuxShared = prop({
      id: "prop:linux:shared",
      driverSchemaId: "driver:linux:cross",
      propertyKey: "shared",
      source: "linux",
    });
    const manualShared = prop({
      id: "prop:manual:shared",
      driverSchemaId: "driver:manual:cross",
      propertyKey: "shared",
      source: "manual",
    });
    const manualGap = prop({
      id: "prop:manual:gap",
      driverSchemaId: "driver:manual:cross",
      propertyKey: "gap_only",
      source: "manual",
    });
    const reg = syntheticRegistry(
      [
        driver({
          id: "driver:linux:cross",
          compatible,
          source: "linux",
          propertyIds: [linuxShared.id],
        }),
        driver({
          id: "driver:manual:cross",
          compatible,
          source: "manual",
          propertyIds: [manualShared.id, manualGap.id],
        }),
      ],
      [linuxShared, manualShared, manualGap],
    );
    const node = crossTierNode({
      shared: { rawText: "<1>" },
      gap_only: { rawText: "<2>" },
    });
    // Actual matcher: vendor > linux > manual — linux wins over manual for the same key.
    const shared = matchProperty(node, "shared", reg);
    expect(shared).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ id: linuxShared.id, source: "linux" }),
    });
    // Manual fills the gap when linux/vendor do not define the key.
    const gap = matchProperty(node, "gap_only", reg);
    expect(gap).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ id: manualGap.id, source: "manual" }),
    });
  });

  it("matchDriver prefers vendor over linux for the same compatible (higher specialization tier)", () => {
    const reg = syntheticRegistry(
      [
        driver({
          id: "driver:linux:cross",
          compatible,
          source: "linux",
          propertyIds: [],
        }),
        driver({
          id: "driver:vendor:cross",
          compatible,
          source: "vendor",
          propertyIds: [],
        }),
      ],
      [],
    );
    expect(matchDriver(crossTierNode(), reg)).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ id: "driver:vendor:cross", source: "vendor" }),
    });
  });

  it("inferred never wins a releasable match over vendor/linux/manual", () => {
    const vendorProp = prop({
      id: "prop:vendor:shared",
      driverSchemaId: "driver:vendor:cross",
      propertyKey: "shared",
      source: "vendor",
    });
    const inferredProp = prop({
      id: "prop:inferred:shared",
      driverSchemaId: "driver:inferred:cross",
      propertyKey: "shared",
      source: "inferred",
      lifecycle: "draft",
    });
    const reg = syntheticRegistry(
      [
        driver({
          id: "driver:vendor:cross",
          compatible,
          source: "vendor",
          propertyIds: [vendorProp.id],
        }),
        driver({
          id: "driver:inferred:cross",
          compatible,
          source: "inferred",
          propertyIds: [inferredProp.id],
          lifecycle: "draft",
        }),
        driver({
          id: "driver:linux:other",
          compatible: "wiseeff,other",
          source: "linux",
          propertyIds: [],
        }),
      ],
      [vendorProp, inferredProp],
    );
    const node = crossTierNode({ shared: { rawText: "<1>" } });
    expect(matchDriver(node, reg)).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ id: "driver:vendor:cross", source: "vendor" }),
    });
    expect(matchProperty(node, "shared", reg)).toMatchObject({
      kind: "matched",
      value: expect.objectContaining({ id: vendorProp.id, source: "vendor" }),
    });
  });

  it("collectOpenReviewTasks drafts unmatched/ambiguous; persistOpenReviewTaskDrafts inserts rows", async () => {
    const linuxA = prop({
      id: "prop:linux:a",
      driverSchemaId: "driver:linux:a",
      propertyKey: "shared_prop",
      source: "linux",
    });
    const linuxB = prop({
      id: "prop:linux:b",
      driverSchemaId: "driver:linux:b",
      propertyKey: "shared_prop",
      source: "linux",
    });
    const reg = syntheticRegistry(
      [
        driver({
          id: "driver:linux:a",
          compatible: "wiseeff,test-ambiguous",
          source: "linux",
          propertyIds: [linuxA.id],
        }),
        driver({
          id: "driver:linux:b",
          compatible: "wiseeff,test-ambiguous",
          source: "linux",
          propertyIds: [linuxB.id],
        }),
      ],
      [linuxA, linuxB],
    );
    const ambiguousNode: MatchableNode = {
      nodeLocator: "/test/ambiguous",
      name: "ambiguous",
      compatible: ["wiseeff,test-ambiguous"],
      properties: { shared_prop: { rawText: "<1>" }, mystery: { rawText: "<0>" } },
    };
    const unmatchedOnly: MatchableNode = {
      nodeLocator: "/test/unknown",
      name: "unknown",
      compatible: ["wiseeff,does-not-exist"],
      properties: { orphan: { rawText: "<9>" } },
    };

    const drafts = collectOpenReviewTasks([ambiguousNode, unmatchedOnly], reg);
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts.every((draft) => draft.status === "open")).toBe(true);
    expect(drafts.some((draft) => draft.candidateSchemas.length > 1)).toBe(true);
    expect(
      drafts.some((draft) => draft.candidateSchemas.length === 0 && draft.sourceEvidence.inferred),
    ).toBe(true);

    const inserted: unknown[] = [];
    const db: Queryable = {
      query: vi.fn(async (_text, values) => {
        const row = {
          id: values?.[0],
          organization_id: values?.[1],
          parameter_spec_id: values?.[2],
          source_evidence: JSON.parse(String(values?.[3])),
          candidate_schemas: JSON.parse(String(values?.[4])),
          project_count: values?.[5],
          status: values?.[6],
          reviewer_user_id: null,
          reason: null,
          created_at: "2026-07-16T00:00:00.000Z",
          resolved_at: null,
        };
        inserted.push(row);
        return { rows: [row], rowCount: 1 };
      }),
    };
    const persisted = await persistOpenReviewTaskDrafts(db, "org-test", drafts);
    expect(persisted).toHaveLength(drafts.length);
    expect(inserted).toHaveLength(drafts.length);
    expect(db.query).toHaveBeenCalled();
  });
});
