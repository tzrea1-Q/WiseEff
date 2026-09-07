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
  checksumComparisonContribution,
  compareComparisonCases,
  serializeCanonical,
} from "./corpusContributionSchema";
import { preferPopulatedRehearsalOrganization } from "./corpusTestSupport";
import {
  aggregateLiveComparisonCorpus,
  aggregateComparisonCorpus,
  collectComparisonContributions,
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

  it("populated phases retain complete inventories but refuse the unready canonical observation", async () => {
    populatedDb = await createDisposableParameterCatalogDatabase("dcppop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = preferPopulatedRehearsalOrganization(createPostgresDatabase(populatedDb.url));
    const postDatabase = preferPopulatedRehearsalOrganization(createPostgresDatabase(populatedDb.url));
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const preInput = providerInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA);
      const postInput = providerInput(postDatabase, postPool!, "populated", "post-p13", POP_POST_SHA);
      const preContributions = await collectComparisonContributions(
        preInput,
        providers,
      );
      const postContributions = await collectComparisonContributions(
        postInput,
        providers,
      );
      // Collection is inspectable even when its observations cannot become a
      // valid corpus. Do not manufacture a corpus or normalize failure codes.
      expect(preContributions.map((item) => item.family)).toEqual([...COMPARISON_FAMILIES]);
      expect(postContributions.map((item) => item.family)).toEqual([...COMPARISON_FAMILIES]);
      const preCases = preContributions.flatMap((item) => item.cases);
      const postCases = postContributions.flatMap((item) => item.cases);
      const inventoryCount = (items: typeof preContributions) =>
        items.reduce((total, item) => total + item.sourceInventoryCount, 0);
      expect(inventoryCount(preContributions)).toBeGreaterThan(0);
      expect(inventoryCount(postContributions)).toBe(inventoryCount(preContributions));
      expect(preCases.length).toBeGreaterThan(0);
      expect(postCases.length).toBe(preCases.length);
      expect(createHash("sha256").update(serializeCanonical(preContributions)).digest("hex"))
        .not.toBe(createHash("sha256").update(serializeCanonical(postContributions)).digest("hex"));

      for (const [index, pre] of preContributions.entries()) {
        const post = postContributions[index];
        expect(post.sourceInventoryCount).toBe(pre.sourceInventoryCount);
        expect(post.sourceInventoryChecksum).toBe(pre.sourceInventoryChecksum);
        expect(post.cases.map((item) => item.caseId)).toEqual(pre.cases.map((item) => item.caseId));
        for (const contribution of [pre, post]) {
          const { checksum, ...unsigned } = contribution;
          expect(checksum).toBe(checksumComparisonContribution(unsigned));
          expect(contribution.cases).toEqual([...contribution.cases].sort((left, right) =>
            compareComparisonCases({ ...left, family: contribution.family }, { ...right, family: contribution.family })));
          const uniqueRefs = new Set(contribution.cases.map((item) =>
            `${item.protectedReference.kind}\0${item.protectedReference.id}`));
          expect(uniqueRefs.size).toBeGreaterThanOrEqual(contribution.sourceInventoryCount);
        }
      }

      expect(preContributions.map((item) => item.checksum))
        .not.toEqual(postContributions.map((item) => item.checksum));
      expect([...new Set(preCases.map((item) => item.comparisonId))].sort()).toEqual([...COMPARISON_IDS].sort());
      for (const [contributions, input] of [[preContributions, preInput], [postContributions, postInput]] as const) {
        // The CGH production readiness port executes SELECT 1 then returns
        // not-ready. The real HTTP handler returns 503 before Kernel loading;
        // this is not a SQL failure, absent business data, or declared R class.
        const cgh = contributions.find((item) => item.family === "CGH")!;
        const definition = cgh.cases.find((item) => item.comparisonId === "PCAT-CMP-D01-DEFINITION-SEMANTICS")!;
        expect(definition.canonicalObservation).toEqual({
          status: "query-failure", code: "503", detail: "catalog-read-list-definitions",
        });
        expect(definition.result).toBe("unqueryable/protected-reference-missing");
        expect(definition.expectedDifference).toBeNull();
        expect(contributions.flatMap((item) => item.cases)
          .some((item) => item.result === "declared-expected-difference")).toBe(false);
        expect(() => aggregateComparisonCorpus(contributions, input)).toThrow(
          "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        );
        await expect(aggregateLiveComparisonCorpus(input, providers)).rejects.toMatchObject({
          code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        });
      }
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 300_000);
});
