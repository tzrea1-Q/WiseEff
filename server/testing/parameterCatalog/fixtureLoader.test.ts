import { Buffer } from "node:buffer";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  cleanupLeftoverParameterCatalogDatabases,
  createDisposableParameterCatalogDatabase,
  type ParameterCatalogDatabase,
} from "./database";
import {
  REHEARSAL_SQL_CHECKSUMS,
  assertLockedChecksum,
  loadParameterCatalogFixture,
  verifyRehearsalFixtureChecksums,
} from "./fixtureLoader";

describe("checksum-locked parameter catalog fixture loader", () => {
  it("accepts the S0-FIX rehearsal SQL bytes and rejects mutated copies", async () => {
    await verifyRehearsalFixtureChecksums();
    expect(() =>
      assertLockedChecksum(
        Buffer.from("mutated-rehearsal-bytes\n"),
        REHEARSAL_SQL_CHECKSUMS["synthetic-fixture.sql"],
        "scripts/wayfinder/sql/synthetic-fixture.sql",
      ),
    ).toThrow(/Checksum-locked rehearsal fixture drifted/);
  });
});

describe("checked-empty rehearsal fixture loading", () => {
  const databases: ParameterCatalogDatabase[] = [];

  afterAll(async () => {
    await Promise.all(databases.map((database) => database.close().catch(() => undefined)));
    await cleanupLeftoverParameterCatalogDatabases();
  });

  it("refuses to load onto a dirty catalog", async () => {
    const database = await createDisposableParameterCatalogDatabase("dirty");
    databases.push(database);
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query(`
        insert into parameter_catalog.catalog_releases (
          id, release_sequence, release_version, release_digest,
          compiled_model_digest, toolchain_digest, published_at
        ) values (
          'crel-dirty', 84001, 'dirty', 'sha256:dirty',
          'sha256:dirty-model', 'sha256:dirty-tool', '2026-09-03T00:00:00Z'
        )
      `);
    } finally {
      await client.end();
    }

    await expect(loadParameterCatalogFixture(database.url, "populated")).rejects.toThrow(
      /not checked-empty/,
    );
  });

  it("loads the populated checksum-locked graph onto a checked-empty catalog", async () => {
    const database = await createDisposableParameterCatalogDatabase("popfix");
    databases.push(database);
    const loaded = await loadParameterCatalogFixture(database.url, "populated");
    expect(loaded).toEqual({
      mode: "populated",
      fixtureCases: 10,
      legacyTwinRows: 2,
      zeroInventory: expect.any(Number),
    });
    expect(loaded.zeroInventory).toBeGreaterThan(0);

    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      const org = await client.query<{ n: string }>(
        `select count(*)::bigint as n from organizations where id = 'wf671-org'`,
      );
      expect(Number(org.rows[0]?.n)).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("loads the zero-mode fixture without injecting the populated graph", async () => {
    const database = await createDisposableParameterCatalogDatabase("zerofix");
    databases.push(database);
    const loaded = await loadParameterCatalogFixture(database.url, "zero");
    expect(loaded).toEqual({
      mode: "zero",
      fixtureCases: 0,
      legacyTwinRows: 0,
      zeroInventory: 0,
    });
  });
});
