import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import {
  interceptExactReloadPinSql,
  listReloadCandidateRows,
  pinDtsReloadQueryable,
} from "./repository";
import {
  DTS_COMPARISON_CONTRACT_VERSION,
  DTS_COMPARISON_FAMILY,
  DTS_COMPARISON_IDS,
  checksumDtsComparisonBytes,
  provideDtsParameterCatalogComparisonContribution,
  serializeDtsComparisonContribution,
  type DtsComparisonContribution,
  type DtsComparisonContributionInput,
  type DtsComparisonPhase,
  type DtsInventoryMode,
} from "./parameterCatalogComparisonContribution";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: DtsInventoryMode,
  phase: DtsComparisonPhase,
  candidateSha: string,
): DtsComparisonContributionInput {
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

function assertCanonicalChecksum(contribution: DtsComparisonContribution) {
  expect(contribution.contractVersion).toBe(DTS_COMPARISON_CONTRACT_VERSION);
  expect(contribution.family).toBe(DTS_COMPARISON_FAMILY);
  const bytes = serializeDtsComparisonContribution(contribution);
  expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
  expect(bytes.toString("utf8")).not.toContain("\r");
  expect(contribution.checksum).toBe(checksumDtsComparisonBytes(bytes));
}

describe("interceptExactReloadPinSql", () => {
  it("replaces latest-revision locator fallback with an exact config-revision pin", () => {
    const sql = [
      "where logical_node_id = b.logical_node_id",
      "      order by",
      "        case when config_revision_id = br.config_revision_id then 0 else 1 end,",
      "        config_revision_id desc",
      "      limit 1",
    ].join("\n");
    const exact = interceptExactReloadPinSql(sql);
    expect(exact).not.toContain("config_revision_id desc");
    expect(exact).toContain("and config_revision_id = br.config_revision_id");
  });

  it("listReloadCandidateRows executes the exact config-revision pin rather than latest fallback", async () => {
    const statements: string[] = [];
    const wrapped = {
      query: async (sql: string, _values?: unknown[]) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
    };
    pinDtsReloadQueryable(wrapped);
    const rows = await listReloadCandidateRows(wrapped, {
      organizationId: "org-dts",
      projectId: "project-dts",
    });
    expect(rows).toEqual([]);
    expect(statements.length).toBeGreaterThan(0);
    const haystack = statements.join("\n");
    expect(haystack).not.toContain("config_revision_id desc");
    expect(haystack).toContain("and config_revision_id = br.config_revision_id");
    expect(haystack).toContain("dps.property_key");
  });
});

describe("provideDtsParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("fresh pre-activation queries real PostgreSQL and proves zero inventory", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("dtsfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideDtsParameterCatalogComparisonContribution(
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
    freshPostDb = await createDisposableParameterCatalogDatabase("dtsfs");
    const database = createPostgresDatabase(freshPostDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideDtsParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "post-p13", FRESH_POST_SHA),
      );
      assertCanonicalChecksum(contribution);
      expect(contribution.phase).toBe("post-p13");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_POST_SHA);
      expect(contribution.checksum).not.toBe(
        checksumDtsComparisonBytes(
          serializeDtsComparisonContribution({
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
    populatedDb = await createDisposableParameterCatalogDatabase("dtspop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const pre = await provideDtsParameterCatalogComparisonContribution(
        baseInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA),
      );
      const post = await provideDtsParameterCatalogComparisonContribution(
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
        expect(DTS_COMPARISON_IDS.includes(item.comparisonId)).toBe(true);
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
      expect(pre.cases.length).toBe(pre.sourceInventoryCount * DTS_COMPARISON_IDS.length);
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 120_000);
});
