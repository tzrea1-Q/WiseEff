import { createHash } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { routeManifest } from "../contracts/routeManifest";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import {
  MOD_COMPARISON_CONTRACT_VERSION,
  MOD_COMPARISON_FAMILY,
  MOD_COMPARISON_IDS,
  checksumModComparisonBytes,
  provideModParameterCatalogComparisonContribution,
  serializeModComparisonContribution,
  type ModComparisonContribution,
  type ModComparisonContributionInput,
  type ModComparisonPhase,
  type ModInventoryMode,
} from "./parameterCatalogComparisonContribution";
import { insertDismissedCompatible } from "./repository";
import { listDismissedCompatibleIdentitiesForComparison } from "./comparisonInventoryRepository";
import { installParameterModuleComparisonCatalogFixture } from "../../testing/parameterCatalog/registryProjection";
import type { CatalogReleasePin } from "../parameter-catalog-contract";
import * as comparisonInventoryRepository from "./comparisonInventoryRepository";
import * as moduleRepository from "./repository";
import * as legacyCatalog from "../parameter-catalog-api/legacy";
import * as governanceCatalog from "../parameter-catalog-api/governance";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: ModInventoryMode,
  phase: ModComparisonPhase,
  candidateSha: string,
  expectedCatalogReleasePin: CatalogReleasePin,
): ModComparisonContributionInput {
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
    catalogSnapshotChecksum: createHash("sha256").update(`catalog:${phase}:${inventoryMode}`).digest("hex"),
    expectedCatalogReleasePin,
  };
}

function assertCanonicalChecksum(contribution: ModComparisonContribution) {
  expect(contribution.contractVersion).toBe(MOD_COMPARISON_CONTRACT_VERSION);
  expect(contribution.family).toBe(MOD_COMPARISON_FAMILY);
  const bytes = serializeModComparisonContribution(contribution);
  expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
  expect(bytes.toString("utf8")).not.toContain("\r");
  expect(contribution.checksum).toBe(checksumModComparisonBytes(bytes));
}

function emitProbe(label: string, contribution: ModComparisonContribution): void {
  if (process.env.MOD_COMPARISON_PROBE !== "1") return;
  process.stdout.write(`MOD_COMPARISON_PROBE ${JSON.stringify({
    label,
    phase: contribution.phase,
    inventoryMode: contribution.inventoryMode,
    sourceInventoryCount: contribution.sourceInventoryCount,
    sourceInventoryChecksum: contribution.sourceInventoryChecksum,
    checksum: contribution.checksum,
    cases: contribution.cases.map((item) => ({
      caseId: item.caseId,
      protectedReference: item.protectedReference,
      result: item.result,
      legacyFailure: item.legacyObservation.status === "query-failure" ? item.legacyObservation.detail : null,
      canonicalFailure: item.canonicalObservation.status === "query-failure" ? item.canonicalObservation.detail : null,
    })),
  })}\n`);
}

describe("provideModParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;
  let boundaryDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close(), boundaryDb?.close()]);
  });

  it("fresh pre-activation queries real PostgreSQL and proves zero inventory", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("modfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const { pin } = await installParameterModuleComparisonCatalogFixture(pool!);
      const contribution = await provideModParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "pre-activation", FRESH_PRE_SHA, pin),
      );
      assertCanonicalChecksum(contribution);
      emitProbe("fresh-pre", contribution);
      expect(contribution.phase).toBe("pre-activation");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_PRE_SHA);
    } finally {
      await database.close();
    }
  }, 60_000);

  it("fresh post-p13 independently queries a second database with distinct checksums", async () => {
    freshPostDb = await createDisposableParameterCatalogDatabase("modfs");
    const database = createPostgresDatabase(freshPostDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const { pin } = await installParameterModuleComparisonCatalogFixture(pool!);
      const contribution = await provideModParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "post-p13", FRESH_POST_SHA, pin),
      );
      assertCanonicalChecksum(contribution);
      emitProbe("fresh-post", contribution);
      expect(contribution.phase).toBe("post-p13");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_POST_SHA);
      expect(contribution.checksum).not.toBe(
        checksumModComparisonBytes(
          serializeModComparisonContribution({
            ...contribution,
            phase: "pre-activation",
            candidateSha: FRESH_PRE_SHA,
            checksum: contribution.checksum,
          }),
        ),
      );
    } finally {
      await database.close();
    }
  }, 60_000);

  it("populated pre-activation and post-p13 enumerate the full inventory independently", async () => {
    populatedDb = await createDisposableParameterCatalogDatabase("modpop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const { pin } = await installParameterModuleComparisonCatalogFixture(prePool!);
      const pre = await provideModParameterCatalogComparisonContribution(
        baseInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA, pin),
      );
      const post = await provideModParameterCatalogComparisonContribution(
        baseInput(postDatabase, postPool!, "populated", "post-p13", POP_POST_SHA, pin),
      );
      assertCanonicalChecksum(pre);
      assertCanonicalChecksum(post);
      emitProbe("populated-pre", pre);
      emitProbe("populated-post", post);
      expect(pre.sourceInventoryCount).toBeGreaterThan(0);
      expect(post.sourceInventoryCount).toBe(pre.sourceInventoryCount);
      expect(pre.cases.length).toBeGreaterThan(0);
      expect(post.cases.length).toBe(pre.cases.length);
      expect(pre.checksum).not.toBe(post.checksum);
      expect(pre.sourceInventoryChecksum).toBe(post.sourceInventoryChecksum);
      expect(pre.cases.map((item) => item.caseId)).toEqual(post.cases.map((item) => item.caseId));
      expect(pre.cases.map((item) => item.protectedReference)).toEqual(post.cases.map((item) => item.protectedReference));
      expect(pre.candidateSha).not.toBe(post.candidateSha);
      expect(pre.phase).toBe("pre-activation");
      expect(post.phase).toBe("post-p13");

      const comparisonIds = new Set(pre.cases.map((item) => item.comparisonId));
      for (const comparisonId of MOD_COMPARISON_IDS) {
        expect(
          comparisonIds.has(comparisonId) ||
            pre.cases.every((item) => MOD_COMPARISON_IDS.includes(item.comparisonId)),
        ).toBe(true);
      }
      for (const item of [...pre.cases, ...post.cases]) {
        expect(MOD_COMPARISON_IDS.includes(item.comparisonId)).toBe(true);
        expect([
          "exact-equivalent",
          "declared-expected-difference",
          "unexplained-difference",
          "unqueryable/protected-reference-missing",
        ]).toContain(item.result);
        if (item.result === "declared-expected-difference") {
          expect(item.expectedDifference).not.toBeNull();
          expect(item.expectedDifference?.mappingHeadId).toBeTruthy();
          expect(item.expectedDifference?.ruleId).toBe(item.comparisonId);
          expect(item.expectedDifference?.planPin).toBeTruthy();
          expect(
            item.expectedDifference?.typedTarget !== undefined ||
              item.expectedDifference?.Archive !== undefined,
          ).toBe(true);
        } else {
          expect(item.expectedDifference).toBeNull();
        }
      }
      const caseIds = pre.cases.map((item) => item.caseId);
      expect(new Set(caseIds).size).toBe(caseIds.length);
      expect(pre.cases.length).toBe(pre.sourceInventoryCount);
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 120_000);

  it("enumerates every historical dismissed compatible across the hints page boundary", async () => {
    boundaryDb = await createDisposableParameterCatalogDatabase("modbound");
    await loadParameterCatalogFixture(boundaryDb.url, "populated");
    const database = createPostgresDatabase(boundaryDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const { pin } = await installParameterModuleComparisonCatalogFixture(pool!);
      const input = baseInput(database, pool!, "populated", "pre-activation", POP_PRE_SHA, pin);
      await database.query("insert into organizations (id, name) values ($1, $2)", ["c4-org-2", "C4 second organization"]);
      const before = await provideModParameterCatalogComparisonContribution(input);
      for (let index = 0; index < 201; index += 1) {
        const compatible = `c4-vendor,device-${index.toString().padStart(3, "0")}`;
        await insertDismissedCompatible(database, {
          id: `c4-dismissed-${index}`,
          organizationId: "wf671-org",
          compatible,
          reason: "historical dismissal",
          dismissedByUserId: null,
        });
      }
      // One historical dismissal has a legacy Binding; another has none.
      await database.query(
        `insert into dts_logical_node_revisions
          (id, logical_node_id, config_revision_id, node_locator, name, compatible)
         values ($1, $2, $3, $4, $5, $6)`,
        ["c4-node-revision", "wf671-logical-node", "wf671-config-revision", "/c4", "C4 node", "c4-vendor,device-200"],
      );
      await insertDismissedCompatible(database, {
        id: "c4-dismissed-other-org",
        organizationId: "c4-org-2",
        compatible: "c4-vendor,device-200",
        reason: "different organization",
        dismissedByUserId: null,
      });
      const persistedBefore = await listDismissedCompatibleIdentitiesForComparison(database, "wf671-org");
      expect(persistedBefore).toHaveLength(201);
      const oldPage = await moduleRepository.listDismissedCompatiblesForDiscovery(database, { organizationId: "wf671-org" });
      const oldFullPage = await moduleRepository.listDismissedCompatiblesForDiscovery(database, { organizationId: "wf671-org", limit: 500 });
      expect(oldPage).toHaveLength(200);
      expect(oldFullPage.find((row) => row.compatible === "c4-vendor,device-200")?.bindingCount).toBeGreaterThan(0);
      expect(oldFullPage.find((row) => row.compatible === "c4-vendor,device-000")?.bindingCount).toBe(0);
      const otherOrganization = await listDismissedCompatibleIdentitiesForComparison(database, "c4-org-2");
      expect(otherOrganization).toEqual([{ organizationId: "c4-org-2", id: "c4-dismissed-other-org", compatible: "c4-vendor,device-200" }]);

      const observedSpy = vi.spyOn(moduleRepository, "listObservedCompatiblesForDiscovery");
      const dismissedPageSpy = vi.spyOn(moduleRepository, "listDismissedCompatiblesForDiscovery");
      const legacyRequestSpy = vi.spyOn(legacyCatalog, "handleLegacyCatalogRequest");
      const governanceSpy = vi.spyOn(governanceCatalog, "handleCatalogGovernance");
      const querySpy = vi.spyOn(pool!, "query");
      const after = await provideModParameterCatalogComparisonContribution(input);
      const dismissedRoute = routeManifest.find((route) => route.id === "parameterModules.restoreCompatible");
      expect(dismissedRoute).toBeDefined();
      const routePrefix = dismissedRoute!.path.split(":compatible")[0];
      const dismissalRequests = legacyRequestSpy.mock.calls
        .map(([request]) => request)
        .filter((request) => request.path.startsWith(routePrefix));
      const inventoryQueries = querySpy.mock.calls.map(([sql]) => String(sql));
      const canonicalOrganizations = governanceSpy.mock.calls.map(([, request]) => request.params.organizationId);
      querySpy.mockRestore();
      legacyRequestSpy.mockRestore();
      governanceSpy.mockRestore();
      expect(observedSpy).not.toHaveBeenCalled();
      expect(dismissedPageSpy).not.toHaveBeenCalled();
      expect(dismissalRequests).toHaveLength(202);
      expect(dismissalRequests.every((request) => request.method === "DELETE")).toBe(true);
      expect(dismissalRequests.filter((request) => request.path === `${routePrefix}${encodeURIComponent("c4-vendor,device-200")}`)).toHaveLength(2);
      expect(canonicalOrganizations).toEqual([]);
      observedSpy.mockRestore();
      dismissedPageSpy.mockRestore();
      assertCanonicalChecksum(after);
      emitProbe("dismissed-201-plus-1-pre", after);
      expect(after.sourceInventoryCount).toBe(before.sourceInventoryCount + 202);
      expect(after.cases.filter((item) => item.protectedReference.kind !== "parameter-module-dismissed-compatible"))
        .toEqual(before.cases);
      const dismissedCases = after.cases.filter((item) => item.protectedReference.kind === "parameter-module-dismissed-compatible");
      expect(dismissedCases).toHaveLength(202);
      expect(dismissedCases.map((item) => item.protectedReference.id).sort()).toEqual(
        [...persistedBefore, ...otherOrganization].map((row) => row.id).sort(),
      );
      expect(dismissedCases.map((item) => item.protectedReference.id)).toContain("c4-dismissed-0");
      expect(dismissedCases.map((item) => item.protectedReference.id)).toContain("c4-dismissed-other-org");
      expect(dismissedCases.every((item) => item.comparisonId === "PCAT-CMP-D03-REGISTRATION-PLACEMENT")).toBe(true);
      expect(dismissedCases.every((item) => item.legacyObservation.status === "value" && item.legacyObservation.value.httpStatus === 410)).toBe(true);
      expect(new Set(after.cases.map((item) => item.caseId)).size).toBe(after.cases.length);
      expect(inventoryQueries.some((sql) => sql.includes("parameter_catalog.list_retained_dismissed_compatible_identities($1)"))).toBe(true);
      expect(inventoryQueries.filter((sql) => /^\s*(insert|update|delete|truncate)\b/iu.test(sql))).toEqual([]);
      expect(await listDismissedCompatibleIdentitiesForComparison(database, "wf671-org")).toEqual(persistedBefore);
      const afterPost = await provideModParameterCatalogComparisonContribution(
        baseInput(database, pool!, "populated", "post-p13", POP_POST_SHA, pin),
      );
      assertCanonicalChecksum(afterPost);
      emitProbe("dismissed-201-plus-1-post", afterPost);
      expect(afterPost.sourceInventoryCount).toBe(after.sourceInventoryCount);
      expect(afterPost.sourceInventoryChecksum).toBe(after.sourceInventoryChecksum);
      expect(afterPost.cases.map((item) => [item.caseId, item.protectedReference, item.result]))
        .toEqual(after.cases.map((item) => [item.caseId, item.protectedReference, item.result]));

      const actualLegacyRequest = legacyCatalog.handleLegacyCatalogRequest;
      const missingLegacyRoute = vi.spyOn(legacyCatalog, "handleLegacyCatalogRequest")
        .mockImplementation((request, options) => request.path === `${routePrefix}${encodeURIComponent("c4-vendor,device-200")}`
          ? Promise.resolve({ status: 404, headers: {}, body: {} })
          : actualLegacyRequest(request, options));
      const unavailable = await provideModParameterCatalogComparisonContribution(input);
      emitProbe("dismissed-legacy-route-failure", unavailable);
      missingLegacyRoute.mockRestore();
      const unavailableCases = unavailable.cases.filter((item) =>
        item.protectedReference.id === "c4-dismissed-200" || item.protectedReference.id === "c4-dismissed-other-org");
      expect(unavailableCases).toHaveLength(2);
      expect(unavailableCases.every((item) => item.result === "unqueryable/protected-reference-missing")).toBe(true);
      expect(unavailableCases.every((item) => item.legacyObservation.status === "query-failure"
        && item.legacyObservation.detail === "legacy-dismissed-compatible-http-404")).toBe(true);

      const failingQuery = vi.spyOn(comparisonInventoryRepository, "listDismissedCompatibleIdentitiesForComparison")
        .mockRejectedValueOnce(new Error("c4-identity-query-unavailable"));
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("c4-identity-query-unavailable");
      failingQuery.mockRestore();
    } finally {
      await database.close();
    }
  }, 120_000);
});
