import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
} from "../../parameter-catalog-contract/index";
import { compileCatalogRelease } from "../compiler/index";
import {
  refreshReleaseAggregateDigest,
  validCatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import type { CatalogReleaseBundle } from "../compiler/types";
import { jsonCatalogReleaseSource } from "../interface";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import {
  createCatalogInstaller,
  installPublishedRelease,
  switchBackBeforeTraffic,
  THREAT_MATRIX,
} from "./installer";
import { acquireCurrentPointerLockExclusive } from "./lockProtocol";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-INS installer tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-INS installer tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
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

const compileOrThrow = (bundle: CatalogReleaseBundle) => {
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`fixture failed to compile: ${compiled.error.kind}`);
  }
  return compiled.value;
};

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

async function residue(client: pg.Client) {
  const result = await client.query<{
    releases: string;
    materializations: string;
    pointer: string;
    current: string | null;
    definitions: string;
    revisions: string;
  }>(`
    select
      (select count(*)::text from parameter_catalog.catalog_releases) as releases,
      (select count(*)::text from parameter_catalog.catalog_materializations) as materializations,
      (select count(*)::text from parameter_catalog.catalog_state) as pointer,
      (select current_catalog_release_id from parameter_catalog.catalog_state) as current,
      (select count(*)::text from parameter_catalog.parameter_definitions) as definitions,
      (select count(*)::text from parameter_catalog.definition_revisions) as revisions
  `);
  return result.rows[0]!;
}

describe("atomic Catalog install and pointer switch", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3insins");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("freezes the threat matrix with leftover assertions for every required row", () => {
    expect(THREAT_MATRIX.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const row of THREAT_MATRIX) {
      expect(row.initialState.length).toBeGreaterThan(0);
      expect(row.action.length).toBeGreaterThan(0);
      expect(row.expected.length).toBeGreaterThan(0);
      expect(row.leftover.length).toBeGreaterThan(0);
    }
  });

  it("bootstraps an empty catalog, then treats lost-response retry as already-current", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const installer = createCatalogInstaller(pool);
    const command = {
      mode: "bootstrap" as const,
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    };
    const installed = await installer.installPublishedRelease(command);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.value).toMatchObject({
      status: "installed",
      mode: "bootstrap",
      previous: null,
      current: { id: first.release.id, digest: first.release.digest },
    });

    const replay = await installer.installPublishedRelease(command);
    expect(replay).toMatchObject({
      ok: true,
      value: {
        status: "already-current",
        current: { id: first.release.id, digest: first.release.digest },
      },
    });
    const counts = await residue(observer);
    expect(counts).toMatchObject({
      releases: "1",
      materializations: "1",
      pointer: "1",
      current: first.release.id,
      definitions: "1",
      revisions: "1",
    });
  });

  it("advances when expectedCurrent matches and keeps the predecessor projection", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    const bootstrap = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(bootstrap.ok).toBe(true);

    const advanced = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(advanced.ok).toBe(true);
    if (!advanced.ok) return;
    expect(advanced.value).toMatchObject({
      status: "installed",
      mode: "advance",
      previous: { id: first.release.id, digest: first.release.digest },
      current: { id: successor.release.id, digest: successor.release.digest },
    });
    const counts = await residue(observer);
    expect(counts.releases).toBe("2");
    expect(counts.materializations).toBe("2");
    expect(counts.current).toBe(successor.release.id);
  });

  it("serializes concurrent bootstrap sessions into one install and one already-current replay", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const command = {
      mode: "bootstrap" as const,
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    };
    const [left, right] = await Promise.all([
      installPublishedRelease(pool, command),
      installPublishedRelease(pool, command),
    ]);
    const statuses = [left, right].map((result) =>
      result.ok ? result.value.status : result.error.kind,
    );
    expect(statuses.sort()).toEqual(["already-current", "installed"]);
    const counts = await residue(observer);
    expect(counts).toMatchObject({
      releases: "1",
      materializations: "1",
      pointer: "1",
      revisions: "1",
    });
  });

  it("waits on a shared governance lock then replays as already-current", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    const holder = await connect(database.url);
    try {
      await holder.query("begin");
      await holder.query(
        "select parameter_catalog.assert_catalog_subject_active($1, $2, $3, $4)",
        [first.release.id, first.release.digest, "csub_acme_power", "active"],
      );
      const waiting = installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(firstReleaseBundle()),
        expectedTargetDigest: first.aggregateDigest,
      });
      const deadline = Date.now() + 2_000;
      let sawWait = false;
      while (Date.now() < deadline) {
        const waitingRow = await observer.query<{ waiting: boolean }>(
          `select exists (
             select 1
             from pg_catalog.pg_stat_activity
             where datname = current_database()
               and pid <> $1
               and pid <> pg_backend_pid()
               and wait_event_type = 'Lock'
               and wait_event = 'advisory'
           ) as waiting`,
          [holder.processID],
        );
        if (waitingRow.rows[0]?.waiting) {
          sawWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(sawWait).toBe(true);
      await holder.query("commit");
      await expect(waiting).resolves.toMatchObject({
        ok: true,
        value: { status: "already-current" },
      });
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
  });

  it.each(["before-write", "revisions", "heads", "pointer", "evidence"] as const)(
    "leaves zero residue when materialization fails after %s",
    async (stage) => {
      const first = compileOrThrow(firstReleaseBundle());
      const result = await installPublishedRelease(
        pool,
        {
          mode: "bootstrap",
          source: jsonCatalogReleaseSource(firstReleaseBundle()),
          expectedTargetDigest: first.aggregateDigest,
        },
        { failAfter: stage },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("storage-failure");
      expect(await residue(observer)).toMatchObject({
        releases: "0",
        materializations: "0",
        pointer: "0",
        current: null,
        definitions: "0",
        revisions: "0",
      });
    },
  );

  it("rejects a stale expectedCurrent without moving the pointer", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    const stale = await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: {
        id: CatalogReleaseId("crel_stale_pin"),
        digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
      },
      expectedTargetDigest: successor.aggregateDigest,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: {
        kind: "unsupported-lineage",
        reason: "stale-expected-current",
        installed: { id: first.release.id },
      },
    });
    expect((await residue(observer)).current).toBe(first.release.id);
  });

  it("rejects same-id different-bytes as digest-conflict", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    const collidingBundle = firstReleaseBundle();
    const target = collidingBundle.releases[0]!;
    target.manifest.release.publishedAt = "2026-09-03T00:00:00Z";
    refreshReleaseAggregateDigest(target);
    const colliding = compileOrThrow(collidingBundle);
    const conflict = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(collidingBundle),
      expectedTargetDigest: colliding.aggregateDigest,
    });
    expect(conflict).toMatchObject({
      ok: false,
      error: {
        kind: "digest-conflict",
        releaseId: first.release.id,
        expected: colliding.release.digest,
        actual: first.release.digest,
      },
    });
    expect((await residue(observer)).current).toBe(first.release.id);
  });

  it("switches back before traffic and refuses after a candidate-write proof", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const successor = compileOrThrow(validCatalogReleaseBundle());
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstReleaseBundle()),
      expectedTargetDigest: first.aggregateDigest,
    });
    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });

    const switched = await switchBackBeforeTraffic(pool, {
      maintenanceAttemptId: "maint_01KCUTOVER",
      expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
      targetPrevious: { id: first.release.id, digest: first.release.digest },
    });
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.value).toMatchObject({
      status: "switched-back",
      maintenanceAttemptId: "maint_01KCUTOVER",
      previousCurrent: { id: successor.release.id },
      current: { id: first.release.id },
    });
    expect((await residue(observer)).current).toBe(first.release.id);

    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(validCatalogReleaseBundle()),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });
    const forbidden = await switchBackBeforeTraffic(
      pool,
      {
        maintenanceAttemptId: "maint_01KCUTOVER",
        expectedCurrent: { id: successor.release.id, digest: successor.release.digest },
        targetPrevious: { id: first.release.id, digest: first.release.digest },
      },
      {
        trafficActivationGuard: {
          async provePreTrafficSwitchBack() {
            return { allowed: false, reason: "candidate-write-observed" };
          },
        },
      },
    );
    expect(forbidden).toMatchObject({
      ok: false,
      error: { kind: "switch-back-forbidden", reason: "candidate-write-observed" },
    });
    expect((await residue(observer)).current).toBe(successor.release.id);
    expect((await residue(observer)).releases).toBe("2");
  });

  it("returns synchronization-busy when the exclusive lock times out", async () => {
    const first = compileOrThrow(firstReleaseBundle());
    const holder = await connect(database.url);
    try {
      await holder.query("begin");
      await acquireCurrentPointerLockExclusive(holder);
      const startedAt = Date.now();
      const busy = await installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(firstReleaseBundle()),
        expectedTargetDigest: first.aggregateDigest,
      });
      expect(busy).toEqual({
        ok: false,
        error: { kind: "synchronization-busy", retryable: true },
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_500);
      await holder.query("rollback");
      expect((await residue(observer)).pointer).toBe("0");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
    }
  });
});
