import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bootstrapFirstAcme,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  PUBLISHER,
} from "../../catalog-kernel/install/publicationTestHarness";
import { CatalogReleaseDigest } from "../../parameter-catalog-contract/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { adoptPreexistingCatalog } from "./adoption";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-06 adoption tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-06 adoption tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("catalog publication adoption adapter (synthetic fixture)", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp06adp");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("writes adopted-preexisting proof for a labeled synthetic fixture without advancing the pointer", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    const before = await domainSnapshot(observer);
    const fingerprint = await observer.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1`,
      [predecessor.compiled.release.id],
    );
    const evidence = {
      source_bundle_digest: predecessor.digest,
      verification_digest: fingerprint.rows[0]!.compiled_fingerprint,
      data_mode: "fresh" as const,
      collected_at: "2026-09-12T00:00:00.000Z",
      approved_by: PUBLISHER,
    };
    const first = await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      actorPrincipalId: PUBLISHER,
      sourceBytes: predecessor.bytes,
      artifactDigest: predecessor.digest,
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: evidence,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({
      commandKind: "adopted-preexisting",
      currentness: "active",
    });
    const after = await domainSnapshot(observer);
    expect(after.current).toBe(before.current);
    expect(after.currentDigest).toBe(before.currentDigest);
    expect(after.receiptKinds).toEqual(["adopted-preexisting"]);
    expect(after.bindings).toBe(before.bindings);
    expect(after.projectValues).toBe(before.projectValues);

    const replay = await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      actorPrincipalId: PUBLISHER,
      sourceBytes: predecessor.bytes,
      artifactDigest: predecessor.digest,
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: evidence,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.status).toBe("already-recorded");
    expect(await domainSnapshot(observer)).toEqual(after);
  });

  it("refuses a wrong digest or missing source bytes without writing a Receipt", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    const before = await domainSnapshot(observer);
    const fingerprint = await observer.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1`,
      [predecessor.compiled.release.id],
    );
    const wrong = await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      actorPrincipalId: PUBLISHER,
      sourceBytes: predecessor.bytes,
      artifactDigest: CatalogReleaseDigest(
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ),
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: fingerprint.rows[0]!.compiled_fingerprint,
        data_mode: "fresh",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    expect(wrong.ok).toBe(false);
    const missing = await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      actorPrincipalId: PUBLISHER,
      sourceBytes: new Uint8Array(),
      artifactDigest: predecessor.digest,
      evidenceKind: "synthetic-fixture",
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: fingerprint.rows[0]!.compiled_fingerprint,
        data_mode: "fresh",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    expect(missing.ok).toBe(false);
    expect(await domainSnapshot(observer)).toEqual(before);
  });
});
