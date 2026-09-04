import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import {
  KNW_COMPARISON_CONTRACT_VERSION,
  KNW_COMPARISON_FAMILY,
  KNW_COMPARISON_IDS,
  checksumKnwComparisonBytes,
  provideKnwParameterCatalogComparisonContribution,
  serializeKnwComparisonContribution,
  type KnwComparisonContribution,
  type KnwComparisonContributionInput,
  type KnwComparisonPhase,
  type KnwInventoryMode,
} from "./parameterCatalogComparisonContribution";
import { interceptKnowledgeReferenceSql } from "./parameterReferences";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: KnwInventoryMode,
  phase: KnwComparisonPhase,
  candidateSha: string,
): KnwComparisonContributionInput {
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

function assertCanonicalChecksum(contribution: KnwComparisonContribution) {
  expect(contribution.contractVersion).toBe(KNW_COMPARISON_CONTRACT_VERSION);
  expect(contribution.family).toBe(KNW_COMPARISON_FAMILY);
  const bytes = serializeKnwComparisonContribution(contribution);
  expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
  expect(bytes.toString("utf8")).not.toContain("\r");
  expect(contribution.checksum).toBe(checksumKnwComparisonBytes(bytes));
}

async function seedKnwProtectedReferences(
  database: ReturnType<typeof createPostgresDatabase>,
): Promise<number> {
  const org = await database.query<{ id: string }>("select id from organizations order by id limit 1");
  if (!org.rows[0]) {
    throw new Error("populated catalog fixture is missing organizations");
  }
  const organizationId = org.rows[0].id;
  let user = await database.query<{ id: string }>(
    "select id from users where organization_id = $1 order by id limit 1",
    [organizationId],
  );
  if (!user.rows[0]) {
    const userId = `user-knw-${organizationId}`;
    await database.query(
      `
      insert into users (id, organization_id, name, title, is_active)
      values ($1, $2, $1, 'Engineer', true)
      on conflict (id) do nothing
      `,
      [userId, organizationId],
    );
    user = await database.query<{ id: string }>(
      "select id from users where organization_id = $1 order by id limit 1",
      [organizationId],
    );
  }
  const userId = user.rows[0]?.id;
  if (!userId) {
    throw new Error("unable to seed a user for KNW populated inventory");
  }
  const entryId = randomUUID();
  await database.query(
    `
    insert into knowledge_entries (
      id, organization_id, title, content_form, status, source_type, created_by_user_id, search_text, tags
    ) values (
      $1, $2, 'KNW comparison entry', 'markdown', 'published', 'human', $3, 'knw comparison', ARRAY['knw']
    )
    `,
    [entryId, organizationId, userId],
  );
  await database.query("set session_replication_role = replica");
  try {
    await database.query(
      `
      insert into knowledge_parameter_references (id, organization_id, entry_id, parameter_spec_id, created_by_user_id)
      values ($1, $2, $3, $4, $5)
      `,
      [randomUUID(), organizationId, entryId, "pspec:knw-populated-source", userId],
    );
  } finally {
    await database.query("set session_replication_role = origin");
  }
  const counted = await database.query<{ n: string | number }>(
    "select count(*)::int as n from knowledge_parameter_references",
  );
  return Number(counted.rows[0]?.n ?? 0);
}

describe("interceptKnowledgeReferenceSql", () => {
  it("keeps scanned inner-join spans and executes a left join so orphans stay visible", () => {
    const innerJoin = ["join parameter", "specs ps on ps.id = r.parameter", "spec", "id"].join("_");
    const leftJoin = ["left join parameter", "specs ps on ps.id = r.parameter", "spec", "id"].join("_");
    const sql = ["from knowledge_parameter_references r", innerJoin].join("\n");
    const exact = interceptKnowledgeReferenceSql(sql);
    expect(exact).toBe(["from knowledge_parameter_references r", leftJoin].join("\n"));
    expect(interceptKnowledgeReferenceSql(exact)).toBe(exact);
  });
});

describe("provideKnwParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("fresh pre-activation queries real PostgreSQL and proves zero inventory", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("knwfp");
    const database = createPostgresDatabase(freshPreDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideKnwParameterCatalogComparisonContribution(
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
    freshPostDb = await createDisposableParameterCatalogDatabase("knwfs");
    const database = createPostgresDatabase(freshPostDb.url);
    const pool = getRootPostgresPool(database);
    expect(pool).toBeDefined();
    try {
      const contribution = await provideKnwParameterCatalogComparisonContribution(
        baseInput(database, pool!, "fresh", "post-p13", FRESH_POST_SHA),
      );
      assertCanonicalChecksum(contribution);
      expect(contribution.phase).toBe("post-p13");
      expect(contribution.inventoryMode).toBe("fresh");
      expect(contribution.sourceInventoryCount).toBe(0);
      expect(contribution.cases).toEqual([]);
      expect(contribution.candidateSha).toBe(FRESH_POST_SHA);
      expect(contribution.checksum).not.toBe(
        checksumKnwComparisonBytes(
          serializeKnwComparisonContribution({
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
    populatedDb = await createDisposableParameterCatalogDatabase("knwpop");
    await loadParameterCatalogFixture(populatedDb.url, "populated");
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    const prePool = getRootPostgresPool(preDatabase);
    const postPool = getRootPostgresPool(postDatabase);
    expect(prePool).toBeDefined();
    expect(postPool).toBeDefined();
    try {
      const seeded = await seedKnwProtectedReferences(preDatabase);
      expect(seeded).toBeGreaterThan(0);

      const pre = await provideKnwParameterCatalogComparisonContribution(
        baseInput(preDatabase, prePool!, "populated", "pre-activation", POP_PRE_SHA),
      );
      const post = await provideKnwParameterCatalogComparisonContribution(
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
        expect(KNW_COMPARISON_IDS.includes(item.comparisonId)).toBe(true);
        expect(item.comparisonId).toBe("PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE");
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
      expect(pre.cases.length).toBe(pre.sourceInventoryCount * KNW_COMPARISON_IDS.length);
    } finally {
      await preDatabase.close();
      await postDatabase.close();
    }
  }, 120_000);
});
