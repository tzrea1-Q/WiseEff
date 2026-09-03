import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { classifyFrozenP0Graph } from "../classifier";
import { FROZEN_P0_GRAPH_FIXTURE } from "../classifier/__fixtures__/p0GraphFixture";
import {
  MAPPING_TARGET_KINDS,
  rewriteMappingVersion,
} from "./index";

const mappingDir = dirname(fileURLToPath(import.meta.url));
const productionFiles = ["index.ts", "map.ts", "lookup.ts", "persist.ts", "types.ts"] as const;

describe("S7-MAP threat matrix (pure)", () => {
  it("consumes frozen S7-CLS ClassificationResult types and treats R0 as blocked", () => {
    const classified = classifyFrozenP0Graph(FROZEN_P0_GRAPH_FIXTURE);
    expect(classified.ok).toBe(true);
    if (!classified.ok) return;
    const r0 = classified.value.assignments.filter((row) => row.rClass === "R0");
    expect(r0.length).toBeGreaterThan(0);
    expect(r0.every((row) => row.disposition === "blocked")).toBe(true);
    expect(classified.value.blockers).toHaveLength(r0.length);
  });

  it("T3 refuses in-place UPDATE of a mapping version", async () => {
    const result = await rewriteMappingVersion({
      versionId: "lmap-existing",
      patch: { targetId: "forged-target" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PCAT-MAP-APPEND-ONLY");
  });

  it("exposes the typed operational target union from the mapping schema", () => {
    expect(MAPPING_TARGET_KINDS).toContain("parameter-definition");
    expect(MAPPING_TARGET_KINDS).toContain("catalog-subject");
    expect(MAPPING_TARGET_KINDS).toContain("review-evidence");
    expect(MAPPING_TARGET_KINDS).toContain("definition-proposal");
  });

  it("keeps the parameter_definitions token out of production mapping source", () => {
    for (const fileName of productionFiles) {
      const source = readFileSync(join(mappingDir, fileName), "utf8");
      expect(source.includes("parameter_definitions"), fileName).toBe(false);
    }
  });
});
