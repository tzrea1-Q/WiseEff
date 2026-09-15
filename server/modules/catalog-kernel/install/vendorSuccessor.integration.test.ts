import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FIRST_ACME_RELEASE_DIGEST,
  FIRST_ACME_RELEASE_ID,
  VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
  VENDOR_SUCCESSOR_RELEASE_ID,
  compileVendorCatalogSuccessor,
} from "../../../../scripts/compile-vendor-catalog-release";
import { installCatalogRelease } from "../../../../scripts/install-catalog-release";
import { compileCatalogRelease } from "../compiler/index";
import { validCatalogReleaseBundle } from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../compiler/types";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "vendor successor install tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (
         select 1 from pg_catalog.pg_extension where extname = 'vector'
       ) as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "vendor successor install tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const firstReleaseBundle = (): CatalogReleaseBundle => {
  const full = validCatalogReleaseBundle();
  const first = structuredClone(full.releases[0]!);
  return {
    schemaVersion: full.schemaVersion,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
};

describe("vendor catalog successor advance", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("vendorsc");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = new pg.Client({ connectionString: database.url });
    await observer.connect();
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("bootstraps crel_acme_1 then advances the vendor successor as-of snapshot", async () => {
    const firstCompiled = compileCatalogRelease(firstReleaseBundle());
    expect(firstCompiled.ok).toBe(true);
    if (!firstCompiled.ok) return;

    const bootstrapped = await installCatalogRelease(
      pool,
      {
        mode: "bootstrap",
        filename: "-",
        expectedTargetDigest: firstCompiled.value.aggregateDigest,
      },
      firstReleaseBundle(),
    );
    expect(bootstrapped).toMatchObject({
      status: "installed",
      mode: "bootstrap",
      current: { id: FIRST_ACME_RELEASE_ID, digest: FIRST_ACME_RELEASE_DIGEST },
    });

    const successor = compileVendorCatalogSuccessor();
    await expect(
      installCatalogRelease(
        pool,
        {
          mode: "bootstrap",
          filename: "-",
          expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
        },
        successor.bundle,
      ),
    ).rejects.toThrow("catalog-install-unsupported-lineage");

    const advanced = await installCatalogRelease(
      pool,
      {
        mode: "advance",
        filename: "-",
        expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
        expectedCurrentId: FIRST_ACME_RELEASE_ID,
        expectedCurrentDigest: FIRST_ACME_RELEASE_DIGEST,
      },
      successor.bundle,
    );
    expect(advanced).toMatchObject({
      status: "installed",
      mode: "advance",
      previous: { id: FIRST_ACME_RELEASE_ID, digest: FIRST_ACME_RELEASE_DIGEST },
      current: {
        id: VENDOR_SUCCESSOR_RELEASE_ID,
        digest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
      },
      counts: successor.compiled.counts,
    });

    const pointer = await observer.query<{ current_catalog_release_id: string }>(
      "select current_catalog_release_id from parameter_catalog.catalog_state",
    );
    expect(pointer.rows[0]?.current_catalog_release_id).toBe(VENDOR_SUCCESSOR_RELEASE_ID);

    const keys = await observer.query<{ property_key: string }>(
      "select property_key from parameter_catalog.parameter_definitions order by property_key",
    );
    const propertyKeys = keys.rows.map((row) => row.property_key);
    expect(propertyKeys).toContain("iin_max");
    expect(propertyKeys).toContain("board_id");
    expect(propertyKeys).not.toContain("shared_prop");
    expect(propertyKeys).not.toContain("fast_charge_current_limit_ma");
    expect(propertyKeys).toHaveLength(114);

    const replay = await installCatalogRelease(
      pool,
      {
        mode: "advance",
        filename: "-",
        expectedTargetDigest: VENDOR_SUCCESSOR_AGGREGATE_DIGEST,
        expectedCurrentId: FIRST_ACME_RELEASE_ID,
        expectedCurrentDigest: FIRST_ACME_RELEASE_DIGEST,
      },
      successor.bundle,
    );
    expect(replay).toMatchObject({
      status: "already-current",
      current: { id: VENDOR_SUCCESSOR_RELEASE_ID },
    });
  }, 120_000);
});
