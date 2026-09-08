import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { captureComparisonLegacySource } from "./parameterCatalogComparisonSource.fixture";
import {
  createDisposableParameterCatalogDatabase,
  loadParameterCatalogFixture,
  type ParameterCatalogDatabase,
} from "../../testing/parameterCatalog";
import {
  provideCghParameterCatalogComparisonContribution,
  type CghComparisonContributionInput,
  type CghComparisonPhase,
  type CghInventoryMode,
} from "./parameterCatalogComparisonContribution";

const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function baseInput(
  database: ReturnType<typeof createPostgresDatabase>,
  pool: NonNullable<ReturnType<typeof getRootPostgresPool>>,
  inventoryMode: CghInventoryMode,
  phase: CghComparisonPhase,
  candidateSha: string,
): CghComparisonContributionInput {
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

describe("provideCghParameterCatalogComparisonContribution", () => {
  let freshPreDb: ParameterCatalogDatabase;
  let freshPostDb: ParameterCatalogDatabase;
  let populatedDb: ParameterCatalogDatabase;

  afterAll(async () => {
    await Promise.all([freshPreDb?.close(), freshPostDb?.close(), populatedDb?.close()]);
  });

  it("fresh pre-activation proves empty old inventory without treating unready Catalog as passed", async () => {
    freshPreDb = await createDisposableParameterCatalogDatabase("cghfp");
    expect((await loadParameterCatalogFixture(freshPreDb.url, "zero")).zeroInventory).toBe(0);
    const database = createPostgresDatabase(freshPreDb.url);
    try {
      const source = await captureComparisonLegacySource(database);
      expect(source.count).toBe(0); expect(source.records).toEqual([]);
      await expect(provideCghParameterCatalogComparisonContribution(
        baseInput(database, getRootPostgresPool(database)!, "fresh", "pre-activation", FRESH_PRE_SHA),
      )).rejects.toMatchObject({ code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE" });
      expect(await captureComparisonLegacySource(database)).toEqual(source);
    } finally { await database.close(); }
  }, 60_000);

  it("fresh post-p13 independently preserves empty old inventory and refuses unavailable canonical queries", async () => {
    freshPostDb = await createDisposableParameterCatalogDatabase("cghfs");
    expect((await loadParameterCatalogFixture(freshPostDb.url, "zero")).zeroInventory).toBe(0);
    const database = createPostgresDatabase(freshPostDb.url);
    try {
      const source = await captureComparisonLegacySource(database);
      expect(source.count).toBe(0); expect(source.records).toEqual([]);
      await expect(provideCghParameterCatalogComparisonContribution(
        baseInput(database, getRootPostgresPool(database)!, "fresh", "post-p13", FRESH_POST_SHA),
      )).rejects.toMatchObject({ code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE" });
      expect(await captureComparisonLegacySource(database)).toEqual(source);
    } finally { await database.close(); }
  }, 60_000);

  it("populated phases preserve the full old-source inventory while canonical collection fails closed", async () => {
    populatedDb = await createDisposableParameterCatalogDatabase("cghpop");
    const fixture = await loadParameterCatalogFixture(populatedDb.url, "populated");
    expect(fixture.fixtureCases).toBe(10); expect(fixture.legacyTwinRows).toBe(2);
    expect(fixture.zeroInventory).toBeGreaterThan(0);
    const preDatabase = createPostgresDatabase(populatedDb.url);
    const postDatabase = createPostgresDatabase(populatedDb.url);
    try {
      const pre = await captureComparisonLegacySource(preDatabase);
      const post = await captureComparisonLegacySource(postDatabase);
      expect(pre.count).toBeGreaterThan(0);
      expect(post.count).toBe(pre.count); expect(post.records).toEqual(pre.records);
      expect(post.checksum).toBe(pre.checksum);
      expect(new Set(pre.records.map(item => item.kind + ":" + item.id)).size).toBe(pre.count);
      for (const [db, phase, candidate] of [[preDatabase, "pre-activation", POP_PRE_SHA], [postDatabase, "post-p13", POP_POST_SHA]] as const) {
        await expect(provideCghParameterCatalogComparisonContribution(
          baseInput(db, getRootPostgresPool(db)!, "populated", phase, candidate),
        )).rejects.toMatchObject({
          code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
          observation: { status: "query-failure", code: "503", detail: "catalog-read-list-definitions" },
        });
        expect(await captureComparisonLegacySource(db)).toEqual(pre);
      }
      // No canonical contribution/checksum/report exists for these failed
      // captures; equality/classification/checksum success oracles remain in
      // the dedicated queryable transport test, not fabricated in this fixture.
    } finally { await Promise.all([preDatabase.close(), postDatabase.close()]); }
  }, 120_000);
});
