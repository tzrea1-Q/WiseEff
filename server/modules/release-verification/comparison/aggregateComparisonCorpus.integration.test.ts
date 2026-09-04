import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import {
  COMPARISON_FAMILIES,
  COMPARISON_IDS,
} from "./corpusContributionSchema";
import {
  aggregateLiveComparisonCorpus,
  assertIndependentPhaseReports,
  generateComparisonReport,
  productionComparisonProviders,
  type ComparisonProviderInput,
} from "./index";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function providerInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: ComparisonProviderInput["inventoryMode"],
  phase: ComparisonProviderInput["phase"],
  candidateSha: string,
): ComparisonProviderInput {
  return {
    database,
    pool,
    phase,
    inventoryMode,
    candidateSha,
    planPin: `plan-${phase}-${inventoryMode}`,
    mappingHeadId: `map-${phase}-${inventoryMode}`,
    mappingHeadVersion: phase === "pre-activation" ? 1 : 2,
    mappingHeadChecksum: createHash("sha256").update(`${phase}:${inventoryMode}`).digest("hex"),
    catalogSnapshotChecksum: createHash("sha256")
      .update(`catalog:${phase}:${inventoryMode}`)
      .digest("hex"),
  };
}

describe("live eleven-family comparison corpus", () => {
  const providers = productionComparisonProviders();
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("registers exactly eleven production families", () => {
    expect(providers.map((provider) => provider.family)).toEqual([...COMPARISON_FAMILIES]);
  });

  it("fresh/pre-activation queries real PostgreSQL and proves zero inventory for all families", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("dcpfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const corpus = await aggregateLiveComparisonCorpus(
        providerInput(database, pool!, "fresh", "pre-activation", FRESH_PRE_SHA),
        providers,
      );
      expect(corpus.phase).toBe("pre-activation");
      expect(corpus.inventoryMode).toBe("fresh");
      expect(corpus.cases).toEqual([]);
      expect(corpus.sourceInventoryCount).toBe(0);
      expect(corpus.familyBindings).toHaveLength(11);
      for (const binding of corpus.familyBindings) {
        expect(binding.sourceInventoryCount).toBe(0);
      }
      const report = generateComparisonReport(corpus);
      expect(report.unexplainedDifferenceCount).toBe(0);
      expect(report.unqueryableProtectedReferenceCount).toBe(0);
      expect(report.gateCoverage.map((gate) => gate.comparisonId)).toEqual([...COMPARISON_IDS]);
      expect(report.gateCoverage.every((gate) => gate.caseCount === 0)).toBe(true);
    } finally {
      await database.close();
    }
  }, 180_000);

  it("fresh/post-p13 independently queries a second database with distinct checksums", async () => {
    freshPostDb = await createDisposableParameterCatalogDatabase("dcpfs");
    const postDatabase = createPostgresDatabase(freshPostDb.url);
    const postPool = getRootPostgresPool(postDatabase);
    expect(postPool).toBeDefined();
    const independentPreDb = await createDisposableParameterCatalogDatabase("dcpfp2");
    const preDatabase = createPostgresDatabase(independentPreDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    expect(prePool).toBeDefined();
    try {
      const postCorpus = await aggregateLiveComparisonCorpus(
        providerInput(postDatabase, postPool!, "fresh", "post-p13", FRESH_POST_SHA),
        providers,
      );
      const preCorpus = await aggregateLiveComparisonCorpus(
        providerInput(preDatabase, prePool!, "fresh", "pre-activation", FRESH_PRE_SHA),
        providers,
      );
      expect(postCorpus.phase).toBe("post-p13");
      expect(postCorpus.inventoryMode).toBe("fresh");
      expect(postCorpus.sourceInventoryCount).toBe(0);
      expect(postCorpus.cases).toEqual([]);
      expect(preCorpus.sourceInventoryCount).toBe(0);
      const preReport = generateComparisonReport(preCorpus);
      const postReport = generateComparisonReport(postCorpus);
      assertIndependentPhaseReports(preReport, postReport);
      expect(preReport.checksum).not.toBe(postReport.checksum);
    } finally {
      await postDatabase.close();
      await preDatabase.close();
      await independentPreDb.close();
    }
  }, 180_000);

  it("populated pre-activation and post-p13 enumerate complete non-sampled inventories independently", async () => {
    populatedDb = await createDisposableParameterCatalogDatabase("dcppop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const preCorpus = await aggregateLiveComparisonCorpus(
        providerInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA),
        providers,
      );
      const postCorpus = await aggregateLiveComparisonCorpus(
        providerInput(postDatabase, postPool!, "populated", "post-p13", POP_POST_SHA),
        providers,
      );
      expect(preCorpus.sourceInventoryCount).toBeGreaterThan(0);
      expect(postCorpus.sourceInventoryCount).toBe(preCorpus.sourceInventoryCount);
      expect(preCorpus.sourceInventoryChecksum).toBe(postCorpus.sourceInventoryChecksum);
      expect(preCorpus.cases.length).toBeGreaterThan(0);
      expect(postCorpus.cases.length).toBe(preCorpus.cases.length);
      expect(preCorpus.checksum).not.toBe(postCorpus.checksum);

      for (const binding of preCorpus.familyBindings) {
        const uniqueRefs = new Set(
          preCorpus.cases
            .filter((item) => item.family === binding.family)
            .map((item) => `${item.protectedReference.kind}\0${item.protectedReference.id}`),
        );
        expect(uniqueRefs.size).toBeGreaterThanOrEqual(binding.sourceInventoryCount);
      }

      expect(preCorpus.familyChecksums).not.toEqual(postCorpus.familyChecksums);
      const blocking =
        preCorpus.resultCounts["unexplained-difference"] +
        preCorpus.resultCounts["unqueryable/protected-reference-missing"];
      if (blocking === 0) {
        const preReport = generateComparisonReport(preCorpus);
        const postReport = generateComparisonReport(postCorpus);
        expect(preReport.gateCoverage.map((gate) => gate.comparisonId)).toEqual([...COMPARISON_IDS]);
        assertIndependentPhaseReports(preReport, postReport);
        expect(preReport.unexplainedDifferenceCount).toBe(0);
        expect(preReport.unqueryableProtectedReferenceCount).toBe(0);
        expect(postReport.unexplainedDifferenceCount).toBe(0);
        expect(postReport.unqueryableProtectedReferenceCount).toBe(0);
      } else {
        expect(() => generateComparisonReport(preCorpus)).toThrowError(/PCAT-CMP-UNEXPLAINED-DIFFERENCE|PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE/);
        expect(() => generateComparisonReport(postCorpus)).toThrowError(/PCAT-CMP-UNEXPLAINED-DIFFERENCE|PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE/);
      }
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 300_000);
});
