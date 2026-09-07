import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { getSpecReviewTaskById, insertSpecReviewTask } from "../../parameter-specs/repository";
import { captureComparisonLegacySource } from "../../parameter-specs/parameterCatalogComparisonSource.fixture";
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
  const queryableFamilies = providers.filter(provider => provider.family !== "CGH");
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("registers exactly eleven production families", () => {
    expect(providers.map((provider) => provider.family)).toEqual([...COMPARISON_FAMILIES]);
  });

  it("fresh/pre-activation proves zero old inventory but refuses unavailable canonical collection", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("dcpfp");
    expect((await loadParameterCatalogFixture(freshPreDb.url, "zero")).zeroInventory).toBe(0);
    const database = createPostgresDatabase(freshPreDb.url);
    try {
      const input = providerInput(database, getRootPostgresPool(database)!, "fresh", "pre-activation", FRESH_PRE_SHA);
      const source = await captureComparisonLegacySource(database);
      expect(source.count).toBe(0); expect(source.records).toEqual([]);
      const contributions = await Promise.all(queryableFamilies.map(provider => provider.provide(input)));
      expect(contributions).toHaveLength(10);
      for (const item of contributions) {
        expect(item.phase).toBe("pre-activation");
        expect(item.inventoryMode).toBe("fresh");
        expect(item.sourceInventoryCount).toBe(0); expect(item.cases).toEqual([]);
        const { checksum, ...unsigned } = item;
        expect(checksum).toBe(checksumComparisonContribution(unsigned));
      }
      await expect(aggregateLiveComparisonCorpus(input, providers)).rejects.toMatchObject({
        code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      });
      expect(await captureComparisonLegacySource(database)).toEqual(source);
    } finally { await database.close(); }
  }, 180_000);

  it("fresh/post-p13 independently preserves source and contribution checksums without fabricating a report", async () => {
    freshPostDb = await createDisposableParameterCatalogDatabase("dcpfs");
    const independentPreDb = await createDisposableParameterCatalogDatabase("dcpfp2");
    expect((await loadParameterCatalogFixture(freshPostDb.url, "zero")).zeroInventory).toBe(0);
    expect((await loadParameterCatalogFixture(independentPreDb.url, "zero")).zeroInventory).toBe(0);
    const postDatabase = createPostgresDatabase(freshPostDb.url);
    const preDatabase = createPostgresDatabase(independentPreDb.url);
    try {
      const preInput = providerInput(preDatabase, getRootPostgresPool(preDatabase)!, "fresh", "pre-activation", FRESH_PRE_SHA);
      const postInput = providerInput(postDatabase, getRootPostgresPool(postDatabase)!, "fresh", "post-p13", FRESH_POST_SHA);
      const pre = await Promise.all(queryableFamilies.map(provider => provider.provide(preInput)));
      const post = await Promise.all(queryableFamilies.map(provider => provider.provide(postInput)));
      expect(pre).toHaveLength(10); expect(post).toHaveLength(10);
      for (const [index, item] of post.entries()) {
        expect(item.phase).toBe("post-p13"); expect(pre[index].phase).toBe("pre-activation");
        expect(item.sourceInventoryCount).toBe(0); expect(item.cases).toEqual([]);
        expect(pre[index].sourceInventoryCount).toBe(0); expect(pre[index].cases).toEqual([]);
        expect(item.sourceInventoryChecksum).toBe(pre[index].sourceInventoryChecksum);
        expect(item.checksum).not.toBe(pre[index].checksum);
        for (const contribution of [item, pre[index]]) {
          const { checksum, ...unsigned } = contribution;
          expect(checksum).toBe(checksumComparisonContribution(unsigned));
        }
      }
      for (const input of [preInput, postInput]) {
        const source = await captureComparisonLegacySource(input.database);
        expect(source.count).toBe(0); expect(source.records).toEqual([]);
        await expect(aggregateLiveComparisonCorpus(input, providers)).rejects.toMatchObject({
          code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        });
        expect(await captureComparisonLegacySource(input.database)).toEqual(source);
      }
    } finally {
      await Promise.all([postDatabase.close(), preDatabase.close()]);
      await independentPreDb.close();
    }
  }, 180_000);

  it("populated phases preserve complete old CGH source and ten contributions while canonical CGH collection is unavailable", async () => {
    populatedDb = await createDisposableParameterCatalogDatabase("dcppop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = preferPopulatedRehearsalOrganization(createPostgresDatabase(populatedDb.url));
    const postDatabase = preferPopulatedRehearsalOrganization(createPostgresDatabase(populatedDb.url));
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      // Local supplement only: the checksum-locked shared populated fixture has
      // no Review rows. Keep real old-schema FK links and distinct source states;
      // these rows are inventory inputs, not review actions or release approvals.
      const reviews = [
        { id: "dcp-review-open", status: "open" },
        { id: "dcp-review-dismissed", status: "dismissed" },
      ] as const;
      for (const review of reviews) {
        await insertSpecReviewTask(preDatabase, {
          organizationId: "wf671-org",
          draft: {
            ...review,
            projectId: "wf671-project",
            configRevisionId: "wf671-config-revision",
            blockerScope: "revision",
            sourceEvidence: {
              organizationId: "wf671-org",
              projectId: "wf671-project",
              configRevisionId: "wf671-config-revision",
              propertyKey: "synthetic.review-input",
            },
            candidateSchemas: [],
            projectCount: 1,
          },
        });
      }
      const preInput = providerInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA);
      const postInput = providerInput(postDatabase, postPool!, "populated", "post-p13", POP_POST_SHA);
      const preSource = await captureComparisonLegacySource(preDatabase);
      const postSource = await captureComparisonLegacySource(postDatabase);
      expect(preSource.count).toBeGreaterThan(0);
      expect(postSource.records).toEqual(preSource.records);
      expect(postSource.count).toBe(preSource.count);
      expect(postSource.checksum).toBe(preSource.checksum);
      const preContributions = await Promise.all(queryableFamilies.map(provider => provider.provide(preInput)));
      const postContributions = await Promise.all(queryableFamilies.map(provider => provider.provide(postInput)));
      // Collection is inspectable even when its observations cannot become a
      // valid corpus. Do not manufacture a corpus or normalize failure codes.
      expect(preContributions.map((item) => item.family)).toEqual(COMPARISON_FAMILIES.filter(family => family !== "CGH"));
      expect(postContributions.map((item) => item.family)).toEqual(COMPARISON_FAMILIES.filter(family => family !== "CGH"));
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
      // All nine comparisons stay registered. D06's old source is inventoried
      // below; canonical D06 coverage is unavailable, never marked zero/passed.
      expect([...new Set(providers.flatMap(provider => [...provider.comparisonIds]))].sort()).toEqual([...COMPARISON_IDS].sort());
      for (const [contributions, input] of [[preContributions, preInput], [postContributions, postInput]] as const) {
        const source = await captureComparisonLegacySource(input.database);
        expect(source).toEqual(preSource);
        expect(source.records.filter(item => item.kind === "review").map(item => item.id).sort())
          .toEqual(reviews.map((item) => item.id).sort());
        // The two independent collectors must not resolve, discard or rewrite
        // source Review states just to meet the nine-comparison coverage gate.
        for (const review of reviews) {
          expect(await getSpecReviewTaskById(input.database, {
            organizationId: "wf671-org", taskId: review.id,
          })).toMatchObject({
            id: review.id, status: review.status, projectCount: 1,
            sourceEvidence: {
              organizationId: "wf671-org", projectId: "wf671-project",
              configRevisionId: "wf671-config-revision", propertyKey: "synthetic.review-input",
            },
          });
        }
        expect(contributions.flatMap((item) => item.cases)
          .some((item) => item.result === "declared-expected-difference")).toBe(false);
        expect(() => aggregateComparisonCorpus(contributions, input)).toThrow(
          "PCAT-CMP-MISSING-FAMILY",
        );
        await expect(aggregateLiveComparisonCorpus(input, providers)).rejects.toMatchObject({
          code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
          observation: { status: "query-failure", code: "503", detail: "catalog-read-list-definitions" },
        });
      }
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 300_000);
});
