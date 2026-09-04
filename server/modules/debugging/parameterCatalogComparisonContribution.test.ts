import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import {
  DBG_COMPARISON_CONTRACT_VERSION,
  DBG_COMPARISON_FAMILY,
  DBG_COMPARISON_IDS,
  DBG_UNQUERYABLE_FAILURE_CODE,
  checksumDbgComparisonBytes,
  provideDbgParameterCatalogComparisonContribution,
  serializeDbgComparisonContribution,
  type DbgComparisonContribution,
  type DbgComparisonContributionInput,
  type DbgComparisonPhase,
  type DbgInventoryMode,
} from "./parameterCatalogComparisonContribution";
import { exactDebugOperationValues } from "./canonicalProtectedReference";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: DbgInventoryMode,
  phase: DbgComparisonPhase,
  candidateSha: string,
): DbgComparisonContributionInput {
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

function assertCanonicalChecksum(contribution: DbgComparisonContribution) {
  expect(contribution.contractVersion).toBe(DBG_COMPARISON_CONTRACT_VERSION);
  expect(contribution.family).toBe(DBG_COMPARISON_FAMILY);
  const bytes = serializeDbgComparisonContribution(contribution);
  expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
  expect(bytes.toString("utf8")).not.toContain("\r");
  expect(contribution.checksum).toBe(checksumDbgComparisonBytes(bytes));
}

describe("exactDebugOperationValues", () => {
  it("keeps scanned identity placeholders but persists a null spec slot", () => {
    const values = ["id", "org", "guessed-spec", "binding"];
    const exact = exactDebugOperationValues(values);
    expect(values[2]).toBe("guessed-spec");
    expect(exact[2]).toBeNull();
    expect(exact[3]).toBe("binding");
  });
});

describe("provideDbgParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("fails closed on unknown phase, inventory mode, SHA, and missing query rows", async () => {
    const database = {
      query: async () => ({ rows: undefined as unknown as never[], rowCount: null }),
      transaction: async () => {
        throw new Error("unused");
      },
    } as unknown as ReturnType<typeof createPostgresDatabase>;
    const pool = { query: async () => ({ rows: [] }) } as unknown as NonNullable<
      ReturnType<typeof getRootPostgresPool>
    >;

    await expect(
      provideDbgParameterCatalogComparisonContribution(
        baseInput(database, pool, "fresh", "pre-activation", FRESH_PRE_SHA),
      ),
    ).rejects.toThrow(/did not return rows/);

    const validDb = {
      query: async () => ({ rows: [], rowCount: 0 }),
      transaction: async () => {
        throw new Error("unused");
      },
    } as unknown as ReturnType<typeof createPostgresDatabase>;

    await expect(
      provideDbgParameterCatalogComparisonContribution({
        ...baseInput(validDb, pool, "fresh", "pre-activation", FRESH_PRE_SHA),
        phase: "during-cutover" as DbgComparisonPhase,
      }),
    ).rejects.toThrow(/phase must be pre-activation or post-p13/);
    await expect(
      provideDbgParameterCatalogComparisonContribution({
        ...baseInput(validDb, pool, "fresh", "pre-activation", FRESH_PRE_SHA),
        inventoryMode: "sampled" as DbgInventoryMode,
      }),
    ).rejects.toThrow(/inventoryMode must be fresh or populated/);
    await expect(
      provideDbgParameterCatalogComparisonContribution({
        ...baseInput(validDb, pool, "fresh", "pre-activation", FRESH_PRE_SHA),
        candidateSha: "abc",
      }),
    ).rejects.toThrow(/full Git SHA/);
  });

  it("fresh pre-activation queries real PostgreSQL and proves zero inventory", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("dbgfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideDbgParameterCatalogComparisonContribution(
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
    freshPostDb = await createDisposableParameterCatalogDatabase("dbgfs");
    const database = createPostgresDatabase(freshPostDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideDbgParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "post-p13", FRESH_POST_SHA),
      );
      assertCanonicalChecksum(contribution);
      expect(contribution.phase).toBe("post-p13");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_POST_SHA);
      expect(contribution.checksum).not.toBe(
        checksumDbgComparisonBytes(
          serializeDbgComparisonContribution({
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
    populatedDb = await createDisposableParameterCatalogDatabase("dbgpop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const pre = await provideDbgParameterCatalogComparisonContribution(
        baseInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA),
      );
      const post = await provideDbgParameterCatalogComparisonContribution(
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
      expect(pre.cases.length).toBe(pre.sourceInventoryCount * DBG_COMPARISON_IDS.length);

      for (const item of [...pre.cases, ...post.cases]) {
        expect(DBG_COMPARISON_IDS.includes(item.comparisonId)).toBe(true);
        expect(item.comparisonId).toBe("PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE");
        expect([
          "exact-equivalent",
          "declared-expected-difference",
          "unexplained-difference",
          "unqueryable/protected-reference-missing",
        ]).toContain(item.result);
        expect(item.result).not.toBe("unexplained-difference");
        if (item.result === "unqueryable/protected-reference-missing") {
          expect(
            item.legacyObservation.status === "query-failure"
              ? item.legacyObservation.code
              : item.canonicalObservation.status === "query-failure"
                ? item.canonicalObservation.code
                : null,
          ).toBe(DBG_UNQUERYABLE_FAILURE_CODE);
        }
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
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 120_000);
});
