import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogKernel } from "../../catalog-kernel/interface";
import { installPublishedRelease } from "../../catalog-kernel/install/installer";
import {
  connect,
  provisionOnlineActivation,
} from "../../catalog-kernel/install/publicationTestHarness";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import {
  captureCurrentCatalogPin,
  createPinCapturingCatalogRuntime,
  DigestKeyedCatalogRuntimeCache,
} from "./pinCache";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-06 cache tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
  );
}

const pgVectorInstalled = await (async () => {
  const probe = await createInMemoryTestDatabase();
  try {
    const result = await probe.query<{ installed: boolean }>(
      `select exists (select 1 from pg_catalog.pg_extension where extname = 'vector') as installed`,
    );
    return result.rows[0]?.installed === true;
  } finally {
    await probe.rollback();
  }
})();

if (!pgVectorInstalled) {
  throw new Error(
    "CP-06 cache tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("digest-keyed catalog cache concurrency", () => {
  let database: EphemeralTestDatabase;
  let poolA: pg.Pool;
  let poolB: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp06cch");
    poolA = new pg.Pool({ connectionString: database.url, max: 2 });
    poolB = new pg.Pool({ connectionString: database.url, max: 2 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await poolA?.end().catch(() => undefined);
    await poolB?.end().catch(() => undefined);
    await database?.drop();
  });

  it("re-reads the current pointer so a process that missed invalidation still sees the new head", async () => {
    const prepared = await provisionOnlineActivation(poolA, observer, "iin_cch");
    const cacheA = new DigestKeyedCatalogRuntimeCache();
    const cacheB = new DigestKeyedCatalogRuntimeCache();
    const runtimeA = createPinCapturingCatalogRuntime(
      poolA,
      createCatalogKernel(poolA),
      cacheA,
    );
    const runtimeB = createPinCapturingCatalogRuntime(
      poolB,
      createCatalogKernel(poolB),
      cacheB,
    );
    const pinR1 = await captureCurrentCatalogPin(poolA);
    expect(pinR1).not.toBeNull();
    if (!pinR1) return;
    const first = await runtimeA.loadCurrentCatalog(pinR1);
    expect(first.ok).toBe(true);

    const activated = await installPublishedRelease(poolB, prepared.command);
    expect(activated.ok).toBe(true);
    if (!activated.ok || activated.value.status !== "installed") return;
    const pinR2 = {
      id: activated.value.current.id,
      digest: activated.value.current.digest,
    };

    const stale = await runtimeA.loadCurrentCatalog(pinR1);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.kind).toBe("release-mismatch");

    const captured = await captureCurrentCatalogPin(poolA);
    expect(captured).toEqual(pinR2);
    const next = await runtimeA.loadCurrentCatalog(pinR2);
    expect(next.ok).toBe(true);
    const fromB = await runtimeB.loadCurrentCatalog(pinR2);
    expect(fromB.ok).toBe(true);
  });
});
