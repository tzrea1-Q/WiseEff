import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../compiler/index";
import { validCatalogReleaseBundle } from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../compiler/types";
import { jsonCatalogReleaseSource } from "../interface";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { installPublishedRelease } from "./installer";
import {
  acquireCurrentPointerLockExclusive,
  CURRENT_POINTER_LOCK_KEY,
  isSynchronizationBusyError,
} from "./lockProtocol";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-INS lock tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-INS lock tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
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

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function waitForAdvisoryLockWait(
  observer: pg.Client,
  processId: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(
      `
      select coalesce(
        (
          select wait_event_type = 'Lock' and wait_event = 'advisory'
          from pg_catalog.pg_stat_activity
          where pid = $1
        ),
        false
      ) as waiting
    `,
      [processId],
    );
    if (result.rows[0]?.waiting) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Session ${processId} did not wait for the Catalog advisory lock`);
}

describe("catalog current-pointer lock protocol", () => {
  let database: EphemeralTestDatabase;
  let primary: pg.Client;
  let pool: pg.Pool;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3inslck");
    primary = await connect(database.url);
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
  }, 60_000);

  afterEach(async () => {
    await pool?.end().catch(() => undefined);
    await primary?.end().catch(() => undefined);
    await database?.drop();
  });

  it("uses the frozen S2-SCH exclusive lock key", () => {
    expect(CURRENT_POINTER_LOCK_KEY).toBe(688004000041);
  });

  it("serializes two sessions on the exclusive current-pointer lock", async () => {
    const contender = await connect(database.url);
    try {
      await primary.query("begin");
      await acquireCurrentPointerLockExclusive(primary);

      await contender.query("begin");
      const waiting = contender
        .query("select parameter_catalog.acquire_current_pointer_lock_exclusive()")
        .then(
          (result) => ({ result, error: null }),
          (error: pg.DatabaseError) => ({ result: null, error }),
        );
      await waitForAdvisoryLockWait(primary, contender.processID);
      await primary.query("rollback");
      await expect(waiting).resolves.toMatchObject({ result: { rowCount: 1 }, error: null });
      await contender.query("rollback");
    } finally {
      await primary.query("rollback").catch(() => undefined);
      await contender.query("rollback").catch(() => undefined);
      await contender.end();
    }
  });

  it("blocks exclusive install behind a shared governance lock until the holder ends", async () => {
    const compiled = compileCatalogRelease(firstReleaseBundle());
    if (!compiled.ok) throw new Error("fixture failed");
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    try {
      await primary.query("begin");
      await primary.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        [
          compiled.value.release.id,
          compiled.value.release.digest,
          "csub_acme_power",
          "active",
        ],
      );

      const waitingInstall = installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(firstReleaseBundle()),
        expectedTargetDigest: compiled.value.aggregateDigest,
      });
      const deadline = Date.now() + 2_000;
      let sawWait = false;
      while (Date.now() < deadline) {
        const waiting = await primary.query<{ waiting: boolean }>(
          `select exists (
             select 1
             from pg_catalog.pg_stat_activity
             where datname = current_database()
               and pid <> pg_backend_pid()
               and wait_event_type = 'Lock'
               and wait_event = 'advisory'
           ) as waiting`,
        );
        if (waiting.rows[0]?.waiting) {
          sawWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      await primary.query("commit");
      await expect(waitingInstall).resolves.toMatchObject({
        ok: true,
        value: { status: "already-current" },
      });
    } finally {
      await primary.query("rollback").catch(() => undefined);
    }
  });

  it("maps exclusive lock timeout to synchronization-busy without residue", async () => {
    const compiled = compileCatalogRelease(firstReleaseBundle());
    if (!compiled.ok) throw new Error("fixture failed");
    await primary.query("begin");
    await acquireCurrentPointerLockExclusive(primary);

    const startedAt = Date.now();
    const result = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: compiled.value.aggregateDigest,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "synchronization-busy", retryable: true },
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_500);
    expect(Date.now() - startedAt).toBeLessThan(3_500);

    await primary.query("rollback");
    const residue = await primary.query<{ count: string }>(
      `select count(*)::text as count from parameter_catalog.catalog_state`,
    );
    expect(residue.rows[0]?.count).toBe("0");
  });

  it("classifies PCA05 as a synchronization-busy error", () => {
    const error = Object.assign(new Error("catalog current-pointer serialization timed out"), {
      code: "PCA05",
    });
    Object.setPrototypeOf(error, pg.DatabaseError.prototype);
    expect(isSynchronizationBusyError(error)).toBe(true);
    expect(isSynchronizationBusyError(new Error("other"))).toBe(false);
  });
});
