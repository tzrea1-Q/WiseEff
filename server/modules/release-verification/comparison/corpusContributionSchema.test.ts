import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
  COMPARISON_FAMILIES,
  COMPARISON_IDS,
  COMPARISON_RESULT_CLASSES,
  FAMILY_COMPARISON_IDS,
  checksumCanonicalBytes,
  serializeCanonical,
  sortKeys,
  type ComparisonFamily,
} from "./corpusContributionSchema";
import { productionComparisonProviders, registerComparisonProviders } from "./aggregateComparisonCorpus";
import {
  ComparisonCorpusError,
  UNQUERYABLE_PROTECTED_REFERENCE_FAILURE_CODE,
} from "./errors";
import type { ComparisonProvider } from "./productionProviders";

const PRODUCTION_FILES = [
  "./corpusContributionSchema.ts",
  "./corpusResultSchema.ts",
  "./aggregateComparisonCorpus.ts",
  "./generateComparisonReport.ts",
  "./productionProviders.ts",
  "./errors.ts",
  "./index.ts",
  "./threatMatrix.ts",
] as const;

describe("S10-DCP comparison corpus schema", () => {
  it("owns the nine comparison IDs and eleven family mappings exactly once", () => {
    expect(COMPARISON_CONTRIBUTION_CONTRACT_VERSION).toBe("pcat-comparison-contribution/v1");
    expect([...COMPARISON_FAMILIES]).toEqual([
      "CGH",
      "TOP",
      "PRJ",
      "FIL",
      "AGT",
      "LOG",
      "DBG",
      "DTS",
      "KNW",
      "MOD",
      "OPS",
    ]);
    expect([...COMPARISON_IDS]).toEqual([
      "PCAT-CMP-D01-DEFINITION-SEMANTICS",
      "PCAT-CMP-D02-SUBJECT-IDENTITY",
      "PCAT-CMP-D03-REGISTRATION-PLACEMENT",
      "PCAT-CMP-D04-BINDING-HISTORY",
      "PCAT-CMP-D05-PROJECT-VALUE-PIN",
      "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION",
      "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE",
      "PCAT-CMP-D08-SOURCE-WRITEBACK",
      "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME",
    ]);
    expect([...COMPARISON_RESULT_CLASSES]).toEqual([
      "exact-equivalent",
      "declared-expected-difference",
      "unexplained-difference",
      "unqueryable/protected-reference-missing",
    ]);
    expect(UNQUERYABLE_PROTECTED_REFERENCE_FAILURE_CODE).toBe(
      "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
    );

    const covered = new Set<string>();
    for (const family of COMPARISON_FAMILIES) {
      for (const comparisonId of FAMILY_COMPARISON_IDS[family]) {
        expect(COMPARISON_IDS.includes(comparisonId)).toBe(true);
        covered.add(comparisonId);
      }
    }
    expect(covered).toEqual(new Set(COMPARISON_IDS));
  });

  it("canonical serializer sorts object keys, uses LF, and hashes lowercase sha256", () => {
    const bytes = serializeCanonical({ b: 1, a: { d: 2, c: 3 } });
    expect(bytes.toString("utf8")).toBe('{"a":{"c":3,"d":2},"b":1}\n');
    expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
    expect(bytes.toString("utf8")).not.toContain("\r");
    expect(bytes[0]).not.toBe(0xef);
    expect(checksumCanonicalBytes(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(checksumCanonicalBytes(bytes)).toMatch(/^[a-f0-9]{64}$/);
    const nested = sortKeys([{ z: 1, a: 2 }]);
    expect(nested).toEqual([{ a: 2, z: 1 }]);
  });

  it("production sources never read shards, fixtures, or DEV-only #676 bytes", () => {
    for (const relative of PRODUCTION_FILES) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
      expect(source).not.toContain("parameter-catalog-allowlist");
      expect(source).not.toContain("loadParameterCatalogFixture");
      expect(source).not.toContain("9c803557a55803ccca79c20eadd033f57d4729e0");
    }
  });

  it("production provider registration accepts exactly the eleven families", () => {
    const registered = productionComparisonProviders();
    expect(registered.map((provider) => provider.family)).toEqual([...COMPARISON_FAMILIES]);
    expect(Object.isFrozen(registered)).toBe(true);
  });
});

describe("registerComparisonProviders", () => {
  const fakeProvider = (family: ComparisonFamily): ComparisonProvider => ({
    family,
    comparisonIds: FAMILY_COMPARISON_IDS[family],
    provide: async () => {
      throw new Error("synthetic provider must not be invoked");
    },
  });

  it("rejects a missing family before comparison", () => {
    const providers = COMPARISON_FAMILIES.filter((family) => family !== "OPS").map(fakeProvider);
    try {
      registerComparisonProviders(providers);
      throw new Error("expected missing family refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ComparisonCorpusError);
      expect((error as ComparisonCorpusError).code).toBe("PCAT-CMP-MISSING-FAMILY");
    }
  });

  it("rejects a duplicate family before comparison", () => {
    const providers = [
      ...COMPARISON_FAMILIES.filter((family) => family !== "TOP").map(fakeProvider),
      fakeProvider("CGH"),
    ];
    try {
      registerComparisonProviders(providers);
      throw new Error("expected duplicate family refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ComparisonCorpusError);
      expect((error as ComparisonCorpusError).code).toBe("PCAT-CMP-DUPLICATE-FAMILY");
    }
  });

  it("rejects an unknown family before comparison", () => {
    const providers = [
      ...COMPARISON_FAMILIES.filter((family) => family !== "OPS").map(fakeProvider),
      { ...fakeProvider("OPS"), family: "XYZ" as ComparisonFamily },
    ];
    try {
      registerComparisonProviders(providers);
      throw new Error("expected unknown family refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ComparisonCorpusError);
      expect((error as ComparisonCorpusError).code).toBe("PCAT-CMP-UNKNOWN-FAMILY");
    }
  });
});
