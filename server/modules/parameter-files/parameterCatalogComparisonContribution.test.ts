import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import {
  FIL_COMPARISON_CONTRACT_VERSION,
  FIL_COMPARISON_FAMILY,
  FIL_COMPARISON_IDS,
  checksumFilComparisonBytes,
  provideFilParameterCatalogComparisonContribution,
  serializeFilComparisonContribution,
  type FilComparisonContribution,
  type FilComparisonContributionInput,
  type FilComparisonPhase,
  type FilInventoryMode,
} from "./parameterCatalogComparisonContribution";
import { findBindingBySource, interceptExactPropertyPinSql } from "./syncIdentity";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: FilInventoryMode,
  phase: FilComparisonPhase,
  candidateSha: string,
): FilComparisonContributionInput {
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
  };
}

function assertCanonicalChecksum(contribution: FilComparisonContribution) {
  expect(contribution.contractVersion).toBe(FIL_COMPARISON_CONTRACT_VERSION);
  expect(contribution.family).toBe(FIL_COMPARISON_FAMILY);
  const bytes = serializeFilComparisonContribution(contribution);
  expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
  expect(bytes.toString("utf8")).not.toContain("\r");
  expect(contribution.checksum).toBe(checksumFilComparisonBytes(bytes));
}

describe("interceptExactPropertyPinSql", () => {
  it("replaces property-key fallback with an exact property pin", () => {
    const sql = [
      "and oe.property_name = coalesce(dps.property_key, split_part(ps.specification_key, '/', 2))",
      "and trim(both '/' from coalesce(dps.property_key, split_part(ps.specification_key, '/', 2), '')) = $4",
    ].join("\n");
    const exact = interceptExactPropertyPinSql(sql);
    expect(exact).not.toContain("split_part");
    expect(exact).not.toContain("coalesce(dps.property_key");
    expect(exact).toContain("oe.property_name = dps.property_key");
    expect(exact).toContain("trim(both '/' from dps.property_key) = $4");
  });

  it("findBindingBySource executes the exact property pin rather than specification_key fallback", async () => {
    const statements: string[] = [];
    const wrapped = {
      query: async (sql: string, values?: unknown[]) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
    };
    const matched = await findBindingBySource(wrapped, {
      organizationId: "org-fil",
      projectId: "project-fil",
      sourceFileName: "board.dts",
      sourceNodePath: "/battery/temp_max",
      fileVersionId: "version-fil",
    });
    expect(matched).toBeNull();
    expect(statements.length).toBeGreaterThan(0);
    const haystack = statements.join("\n");
    expect(haystack).not.toContain("split_part");
    expect(haystack).toContain("oe.property_name = dps.property_key");
  });
});

describe("provideFilParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("fresh pre-activation queries real PostgreSQL and proves zero inventory", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("filfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideFilParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "pre-activation", FRESH_PRE_SHA),
      );
      assertCanonicalChecksum(contribution);
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
    freshPostDb = await createDisposableParameterCatalogDatabase("filfs");
    const database = createPostgresDatabase(freshPostDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideFilParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "post-p13", FRESH_POST_SHA),
      );
      assertCanonicalChecksum(contribution);
      expect(contribution.phase).toBe("post-p13");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_POST_SHA);
      expect(contribution.checksum).not.toBe(
        checksumFilComparisonBytes(
          serializeFilComparisonContribution({
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
    populatedDb = await createDisposableParameterCatalogDatabase("filpop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const pre = await provideFilParameterCatalogComparisonContribution(
        baseInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA),
      );
      const post = await provideFilParameterCatalogComparisonContribution(
        baseInput(postDatabase, postPool!, "populated", "post-p13", POP_POST_SHA),
      );
      assertCanonicalChecksum(pre);
      assertCanonicalChecksum(post);
      expect(pre.sourceInventoryCount).toBeGreaterThan(0);
      expect(post.sourceInventoryCount).toBe(pre.sourceInventoryCount);
      expect(pre.cases.length).toBeGreaterThan(0);
      expect(post.cases.length).toBe(pre.cases.length);
      expect(pre.checksum).not.toBe(post.checksum);
      expect(pre.sourceInventoryChecksum).toBe(post.sourceInventoryChecksum);
      expect(pre.candidateSha).not.toBe(post.candidateSha);
      expect(pre.phase).toBe("pre-activation");
      expect(post.phase).toBe("post-p13");

      for (const item of [...pre.cases, ...post.cases]) {
        expect(FIL_COMPARISON_IDS.includes(item.comparisonId)).toBe(true);
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
            item.expectedDifference?.typedTarget !== undefined || item.expectedDifference?.Archive !== undefined,
          ).toBe(true);
        } else {
          expect(item.expectedDifference).toBeNull();
        }
      }
      const caseIds = pre.cases.map((item) => item.caseId);
      expect(new Set(caseIds).size).toBe(caseIds.length);
      expect(pre.cases.length).toBe(pre.sourceInventoryCount * FIL_COMPARISON_IDS.length);
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 120_000);
});
