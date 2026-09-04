import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import { createDbLogAnalysisToolBackends, interceptExactRelatedParameterSql } from "./analyzer/tools/dbToolBackends";
import {
  LOG_COMPARISON_CONTRACT_VERSION,
  LOG_COMPARISON_FAMILY,
  LOG_COMPARISON_IDS,
  checksumLogComparisonBytes,
  provideLogParameterCatalogComparisonContribution,
  serializeLogComparisonContribution,
  type LogComparisonContribution,
  type LogComparisonContributionInput,
  type LogComparisonPhase,
  type LogInventoryMode,
} from "./parameterCatalogComparisonContribution";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: LogInventoryMode,
  phase: LogComparisonPhase,
  candidateSha: string,
): LogComparisonContributionInput {
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

function assertCanonicalChecksum(contribution: LogComparisonContribution) {
  expect(contribution.contractVersion).toBe(LOG_COMPARISON_CONTRACT_VERSION);
  expect(contribution.family).toBe(LOG_COMPARISON_FAMILY);
  const bytes = serializeLogComparisonContribution(contribution);
  expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
  expect(bytes.toString("utf8")).not.toContain("\r");
  expect(contribution.checksum).toBe(checksumLogComparisonBytes(bytes));
}

async function seedLogProtectedReferences(url: string): Promise<number> {
  const database = createPostgresDatabase(url);
  try {
    const organizations = await database.query<{ id: string }>("select id from organizations order by id");
    let organizationId = organizations.rows[0]?.id;
    if (!organizationId) {
      organizationId = "org-log-cmp";
      await database.query("insert into organizations (id, name) values ($1, $1)", [organizationId]);
    }
    const relatedIds = ["binding-log-unmapped-a", "binding-log-unmapped-b"];
    for (const [index, relatedParameterId] of relatedIds.entries()) {
      const fileObjectId = `lfo-log-cmp-${index}`;
      const logId = `log-cmp-${index}`;
      await database.query(
        `insert into log_file_objects (
           id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256
         ) values ($1, $2, $3, $4, 'text/plain', 64, $5)`,
        [fileObjectId, organizationId, `logs/${fileObjectId}`, `charging-${index}.log`, `checksum-${index}`],
      );
      await database.query(
        `insert into log_records (
           id, organization_id, file_object_id, file_name, source, status, related_parameter_id
         ) values ($1, $2, $3, $4, 'api', 'complete', $5)`,
        [logId, organizationId, fileObjectId, `charging-${index}.log`, relatedParameterId],
      );
    }
    return relatedIds.length;
  } finally {
    await database.close();
  }
}

describe("interceptExactRelatedParameterSql", () => {
  it("replaces specification_key fallback with an exact name pin", () => {
    const sql = "select coalesce(psv.display_name, dps.property_key, ps.specification_key) as name";
    const exact = interceptExactRelatedParameterSql(sql);
    expect(exact).not.toContain("ps.specification_key");
    expect(exact).toContain("coalesce(psv.display_name, dps.property_key)");
  });

  it("loadRelatedParameter executes the exact name pin rather than specification_key fallback", async () => {
    const statements: string[] = [];
    const wrapped = {
      query: async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
      },
    };
    const backends = createDbLogAnalysisToolBackends({
      db: wrapped,
      organizationId: "org-log",
      relatedParameterId: "binding-log",
    });
    await backends.loadRelatedParameterContext?.();
    expect(statements.length).toBeGreaterThan(0);
    const haystack = statements.join("\n");
    expect(haystack).not.toContain("ps.specification_key");
    expect(haystack).toContain("coalesce(psv.display_name, dps.property_key)");
  });
});

describe("provideLogParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("fresh pre-activation queries real PostgreSQL and proves zero inventory", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("logfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideLogParameterCatalogComparisonContribution(
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
    freshPostDb = await createDisposableParameterCatalogDatabase("logfs");
    const database = createPostgresDatabase(freshPostDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideLogParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "post-p13", FRESH_POST_SHA),
      );
      assertCanonicalChecksum(contribution);
      expect(contribution.phase).toBe("post-p13");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_POST_SHA);
      expect(contribution.checksum).not.toBe(
        checksumLogComparisonBytes(
          serializeLogComparisonContribution({
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
    populatedDb = await createDisposableParameterCatalogDatabase("logpop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const seeded = await seedLogProtectedReferences(populatedDb.url);
    expect(seeded).toBeGreaterThan(0);
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const pre = await provideLogParameterCatalogComparisonContribution(
        baseInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA),
      );
      const post = await provideLogParameterCatalogComparisonContribution(
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
        expect(LOG_COMPARISON_IDS.includes(item.comparisonId)).toBe(true);
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
      expect(pre.cases.length).toBe(pre.sourceInventoryCount * LOG_COMPARISON_IDS.length);
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 120_000);
});
