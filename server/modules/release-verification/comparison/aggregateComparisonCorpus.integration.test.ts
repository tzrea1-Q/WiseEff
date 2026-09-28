import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../../testing/parameterCatalog";
import { insertDismissedCompatible } from "../../parameter-modules/repository";
import { compileCatalogRelease } from "../../catalog-kernel/compiler";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import { subjectMatcherRevision } from "../../catalog-kernel/runtime/subjectMatch";
import { createEvidenceIngest } from "../../parameter-governance/evidence";
import { createReviewQueueReader } from "../../parameter-governance/review";
import { resolveReviewItem } from "../../parameter-governance/resolveReviewItem";
import {
  COMPARISON_FAMILIES,
  COMPARISON_IDS,
} from "./corpusContributionSchema";
import { preferPopulatedRehearsalOrganization } from "./corpusTestSupport";
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
    const preDatabase = preferPopulatedRehearsalOrganization(createPostgresDatabase(populatedDb.url));
    const postDatabase = preferPopulatedRehearsalOrganization(createPostgresDatabase(populatedDb.url));
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
      const blockingCases = preCorpus.cases.filter(
        (item) =>
          item.result === "unexplained-difference" ||
          item.result === "unqueryable/protected-reference-missing",
      );
      expect(
        blockingCases,
        blockingCases.map((item) => item.caseId).join(","),
      ).toEqual([]);
      const preReport = generateComparisonReport(preCorpus);
      const postReport = generateComparisonReport(postCorpus);
      expect(preReport.gateCoverage.map((gate) => gate.comparisonId)).toEqual([...COMPARISON_IDS]);
      assertIndependentPhaseReports(preReport, postReport);
      expect(preReport.unexplainedDifferenceCount).toBe(0);
      expect(preReport.unqueryableProtectedReferenceCount).toBe(0);
      expect(postReport.unexplainedDifferenceCount).toBe(0);
      expect(postReport.unqueryableProtectedReferenceCount).toBe(0);

      // The historical dismissal is a separate protected identity from an ignored Review Item.
      await insertDismissedCompatible(preDatabase, {
        id: "mod-comparison-historical-dismissal",
        organizationId: "wf671-org",
        compatible: "vendor,review-only",
        reason: "historical dismissal",
        dismissedByUserId: null,
      });
      const fullBundle = validCatalogReleaseBundle();
      const firstRelease = structuredClone(fullBundle.releases[0]!);
      const bundle = { schemaVersion: fullBundle.schemaVersion, targetReleaseId: firstRelease.manifest.release.id, releases: [firstRelease] };
      const compiled = compileCatalogRelease(bundle);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
      const installed = await installPublishedRelease(prePool!, {
        mode: "bootstrap", source: jsonCatalogReleaseSource(bundle), expectedTargetDigest: compiled.value.aggregateDigest,
      });
      if (!installed.ok) throw new Error(JSON.stringify(installed.error));
      const pin = compiled.value.release;
      const mod = providers.find((provider) => provider.family === "MOD")!;
      const modInput = providerInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA);
      const modBeforeIgnore = await mod.provide(modInput);
      expect(modBeforeIgnore.cases.some((item) => item.protectedReference.id === "mod-comparison-historical-dismissal")).toBe(true);

      await preDatabase.query(
        "insert into users (id, organization_id, name, title, is_active) values ($1, $2, $3, $4, true)",
        ["mod-comparison-reviewer", "wf671-org", "MOD reviewer", "Admin"],
      );
      const ingested = await createEvidenceIngest(prePool!).ingest({
        organizationId: "wf671-org", sourceIdentity: "mod-comparison-review-source",
        catalogReleaseId: pin.id, matcherRevision: subjectMatcherRevision,
        matcherOutput: { status: "unknown" },
        evidence: { propertyKey: "mod-comparison-review", compatible: "vendor,review-only" },
        provenance: null,
      });
      expect(ingested.ok).toBe(true);
      const reader = createReviewQueueReader(prePool!);
      const context = { actorKind: "org-admin" as const, principalId: "mod-comparison-reviewer", organizationId: "wf671-org" };
      const queue = await reader.list({ organizationId: "wf671-org", capturedRelease: pin, context });
      expect(queue.ok).toBe(true);
      if (!queue.ok) throw new Error(JSON.stringify(queue.error));
      const item = queue.value.items.find((entry) => entry.identityKey === "property:mod-comparison-review");
      expect(item).toBeDefined();
      const resolved = await resolveReviewItem(prePool!, {
        resolution: "mark-out-of-scope", organizationId: "wf671-org", reviewItemId: item!.id,
        expectedRelease: pin, etag: item!.etag, idempotencyKey: "mod-comparison-ignore",
        context, reason: item!.reason, outOfScopeReason: "Review closure only",
      });
      expect(resolved.ok).toBe(true);
      const databaseState = async () => (await prePool!.query(
        `select
           (select count(*)::integer from parameter_module_dismissed_compatibles) as dismissed,
           (select count(*)::integer from parameter_catalog.parameter_review_items) as review_items,
           (select count(*)::integer from parameter_catalog.parameter_review_evidence) as review_evidence,
           (select count(*)::integer from public.audit_events) as audits,
           (select count(*)::integer from project_parameter_bindings) as bindings`,
      )).rows[0];
      const stateBeforeRead = await databaseState();
      const modAfterIgnore = await mod.provide(modInput);
      expect(await databaseState()).toEqual(stateBeforeRead);
      expect(modAfterIgnore.sourceInventoryCount).toBe(modBeforeIgnore.sourceInventoryCount);
      expect(modAfterIgnore.sourceInventoryChecksum).toBe(modBeforeIgnore.sourceInventoryChecksum);
      expect(modAfterIgnore.cases).toEqual(modBeforeIgnore.cases);
      const closedQueue = await reader.list({ organizationId: "wf671-org", capturedRelease: pin, context });
      expect(closedQueue.ok && closedQueue.value.ignoredReviewItemCount).toBe(1);
      expect(closedQueue.ok && closedQueue.value.items.some((entry) => entry.id === item!.id)).toBe(false);
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 300_000);
});
