import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compileCatalogRelease } from "../compiler/index";
import {
  validCatalogReleaseBundle,
  type CatalogReleaseBundle,
} from "../compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../interface";
import { installPublishedRelease } from "../install/installer";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import {
  CatalogSnapshotCache,
  createCatalogSnapshotCache,
  rebuildCatalogCache,
} from "./rebuildCatalogCache";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "S3-VFY cache tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "S3-VFY cache tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
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

describe("deterministic catalog snapshot cache rebuild", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("s3vfycch");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
  }, 60_000);

  afterEach(async () => {
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("rebuilds identical current cache bytes from verified database state only", async () => {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    const installed = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest,
    });
    expect(installed.ok).toBe(true);

    const cache = createCatalogSnapshotCache();
    const command = {
      snapshotKind: "current" as const,
      pin: { id: compiled.release.id, digest: compiled.release.digest },
      source: jsonCatalogReleaseSource(bundle),
    };
    const first = await rebuildCatalogCache(pool, command, cache);
    const second = await rebuildCatalogCache(pool, command, cache);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.status).toBe("rebuilt");
    expect(first.value.payload).toBe(second.value.payload);
    expect(first.value.payloadDigest).toBe(second.value.payloadDigest);
    expect(first.value.key.snapshotKind).toBe("current");
    expect(first.value.key.releaseId).toBe(compiled.release.id);
    expect(first.value.key.digest).toBe(compiled.release.digest);
    expect(first.value.key.materializationFingerprint).toBe(
      compiled.materializationFingerprint,
    );
    expect(first.value.payload.includes("yaml")).toBe(false);
    expect(first.value.payload.includes("http://")).toBe(false);
    expect(first.value.payload.includes("https://")).toBe(false);
  });

  it("rejects poisoned cache bytes and rebuilds the verified database projection", async () => {
    const bundle = firstReleaseBundle();
    const compiled = compileOrThrow(bundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(bundle),
      expectedTargetDigest: compiled.aggregateDigest,
    });
    const cache = createCatalogSnapshotCache();
    const command = {
      snapshotKind: "current" as const,
      pin: { id: compiled.release.id, digest: compiled.release.digest },
      source: jsonCatalogReleaseSource(bundle),
    };
    const original = await rebuildCatalogCache(pool, command, cache);
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    cache.put({
      ...original.value,
      payload: `${original.value.payload}\npoison`,
    });
    const poisoned = cache.get(original.value.key);
    expect(poisoned.ok).toBe(false);
    if (poisoned.ok) return;
    expect(poisoned.error.kind).toBe("drift");

    const rebuilt = await rebuildCatalogCache(pool, command, cache);
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.value.payload).toBe(original.value.payload);
    expect(cache.get(original.value.key)).toEqual({
      ok: true,
      value: rebuilt.value,
    });
  });

  it("keeps current and pinned cache namespaces physically isolated", async () => {
    const firstBundle = firstReleaseBundle();
    const first = compileOrThrow(firstBundle);
    const successorBundle = validCatalogReleaseBundle();
    const successor = compileOrThrow(successorBundle);
    await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(firstBundle),
      expectedTargetDigest: first.aggregateDigest,
    });
    await installPublishedRelease(pool, {
      mode: "advance",
      source: jsonCatalogReleaseSource(successorBundle),
      expectedCurrent: { id: first.release.id, digest: first.release.digest },
      expectedTargetDigest: successor.aggregateDigest,
    });

    const cache = createCatalogSnapshotCache();
    const current = await rebuildCatalogCache(
      pool,
      {
        snapshotKind: "current",
        pin: { id: successor.release.id, digest: successor.release.digest },
        source: jsonCatalogReleaseSource(successorBundle),
      },
      cache,
    );
    const pinned = await rebuildCatalogCache(
      pool,
      {
        snapshotKind: "pinned",
        pin: { id: first.release.id, digest: first.release.digest },
      },
      cache,
    );
    expect(current.ok).toBe(true);
    expect(pinned.ok).toBe(true);
    if (!current.ok || !pinned.ok) return;
    expect(current.value.key.snapshotKind).toBe("current");
    expect(pinned.value.key.snapshotKind).toBe("pinned");
    expect(current.value.payload).not.toBe(pinned.value.payload);

    const currentKeyAsPinned = {
      ...current.value.key,
      snapshotKind: "pinned" as const,
    };
    const pinnedLookupOfCurrent = cache.get(currentKeyAsPinned);
    expect(pinnedLookupOfCurrent.ok).toBe(false);

    const pinnedKeyAsCurrent = {
      ...pinned.value.key,
      snapshotKind: "current" as const,
    };
    const currentLookupOfPinned = cache.get(pinnedKeyAsCurrent);
    expect(currentLookupOfPinned.ok).toBe(false);
    expect(cache.get(current.value.key).ok).toBe(true);
    expect(cache.get(pinned.value.key).ok).toBe(true);
  });

  it("does not parse YAML or fetch network artifacts while rebuilding cache", () => {
    const sourcePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "rebuildCatalogCache.ts",
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).not.toMatch(/\byaml\b/i);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\bnet(?:work)?\b/i);
    void CatalogSnapshotCache;
  });
});
