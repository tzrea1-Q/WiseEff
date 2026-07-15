import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { resolveDts, resolveDtsConfigSet } from "../dts";
import {
  bindGoldenOverlayProperties,
  matchDriver,
  matchProperty,
  reviewTasksForDecision,
} from "./matcher";
import { loadSchemaRegistry } from "./schemaLoader";
import type { DriverSchema, MatchableNode, SchemaRegistry } from "./types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const seedDir = join(root, "src/config/dts-seed");
const schemasRoot = join(root, "schemas/dts");

function registry(): SchemaRegistry {
  return loadSchemaRegistry(schemasRoot);
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
