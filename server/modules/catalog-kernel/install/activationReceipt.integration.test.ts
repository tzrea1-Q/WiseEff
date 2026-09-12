import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CatalogReleaseDigest, CatalogReleaseId } from "../../parameter-catalog-contract/index";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { jsonCatalogReleaseSource } from "../interface";
import { installPublishedRelease } from "./installer";
import {
  bootstrapFirstAcme,
  buildAuthorizedJob,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  provisionOnlineActivation,
  PUBLISHER,
} from "./publicationTestHarness";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-05 activation receipt tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-05 activation receipt tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("activation receipt recovery", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp05rct");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("treats a lost success response as already-recorded without a second revision", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_lost");
    const first = await installPublishedRelease(pool, prepared.command);
    expect(first.ok).toBe(true);
    const afterFirst = await domainSnapshot(observer);
    const replay = await installPublishedRelease(pool, prepared.command);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value).toMatchObject({
      status: "already-recorded",
      currentness: "active",
      target: { id: prepared.compiled.release.id, digest: prepared.compiled.release.digest },
    });
    expect(await domainSnapshot(observer)).toEqual(afterFirst);
  });

  it("returns active-superseded for an earlier job after a later successor is current", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    const r2 = await buildAuthorizedJob(observer, {
      predecessorDigest: predecessor.digest,
      propertyKey: "iin_min",
    });
    const first = await installPublishedRelease(pool, r2.command);
    expect(first.ok).toBe(true);

    const r3 = await buildAuthorizedJob(observer, {
      predecessorDigest: r2.compiled.aggregateDigest,
      propertyKey: "iin_nom",
      enablePolicy: false,
      releaseVersion: "1.2.0",
    });
    const second = await installPublishedRelease(pool, r3.command);
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.status !== "installed") return;

    const recover = await installPublishedRelease(pool, r2.command);
    expect(recover.ok).toBe(true);
    if (!recover.ok) return;
    expect(recover.value).toMatchObject({
      status: "already-recorded",
      currentness: "active-superseded",
      current: { id: r3.compiled.release.id, digest: r3.compiled.release.digest },
      target: { id: r2.compiled.release.id, digest: r2.compiled.release.digest },
    });
    const snapshot = await domainSnapshot(observer);
    expect(snapshot.current).toBe(r3.compiled.release.id);
    expect(snapshot.receipts).toBe("2");
  });

  it("adopts the current pin without moving heads and replays the same proof", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    const before = await domainSnapshot(observer);
    const evidence = {
      source_bundle_digest: predecessor.digest,
      verification_digest: predecessor.digest,
      data_mode: "populated" as const,
      collected_at: "2026-09-12T00:00:00.000Z",
      approved_by: PUBLISHER,
    };
    const command = {
      mode: "adopted-preexisting" as const,
      expectedCurrent: {
        id: CatalogReleaseId(predecessor.compiled.release.id),
        digest: CatalogReleaseDigest(predecessor.digest),
      },
      actorPrincipalId: PUBLISHER,
      adoptionEvidence: evidence,
    };
    const adopted = await installPublishedRelease(pool, command);
    expect(adopted.ok).toBe(true);
    if (!adopted.ok || adopted.value.status !== "installed") return;
    expect(adopted.value.commandKind).toBe("adopted-preexisting");
    expect(adopted.value.current.id).toBe(predecessor.compiled.release.id);
    const after = await domainSnapshot(observer);
    expect(after.current).toBe(before.current);
    expect(after.revisions).toBe(before.revisions);
    expect(after.heads).toBe(before.heads);
    expect(after.receipts).toBe("1");

    const replay = await installPublishedRelease(pool, command);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.status).toBe("already-recorded");
    expect(await domainSnapshot(observer)).toEqual(after);
  });

  it("rejects adoption of the wrong pin or a catalog without history", async () => {
    const empty = await installPublishedRelease(pool, {
      mode: "adopted-preexisting",
      expectedCurrent: {
        id: CatalogReleaseId("crel_missing_cp05"),
        digest: CatalogReleaseDigest(`sha256:${"a".repeat(64)}`),
      },
      actorPrincipalId: PUBLISHER,
      adoptionEvidence: {
        source_bundle_digest: `sha256:${"a".repeat(64)}`,
        verification_digest: `sha256:${"a".repeat(64)}`,
        data_mode: "populated",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.kind).toBe("adoption-evidence-invalid");

    const predecessor = await bootstrapFirstAcme(pool);
    const wrong = await installPublishedRelease(pool, {
      mode: "adopted-preexisting",
      expectedCurrent: {
        id: CatalogReleaseId("crel_wrong_cp05"),
        digest: CatalogReleaseDigest(`sha256:${"b".repeat(64)}`),
      },
      actorPrincipalId: PUBLISHER,
      adoptionEvidence: {
        source_bundle_digest: `sha256:${"b".repeat(64)}`,
        verification_digest: `sha256:${"b".repeat(64)}`,
        data_mode: "populated",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.kind).toBe("adoption-evidence-invalid");
    const snapshot = await domainSnapshot(observer);
    expect(snapshot.current).toBe(predecessor.compiled.release.id);
    expect(snapshot.receipts).toBe("0");
  });

  it("closes legacy bootstrap and advance after any receipt exists", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await installPublishedRelease(pool, {
      mode: "adopted-preexisting",
      expectedCurrent: {
        id: CatalogReleaseId(predecessor.compiled.release.id),
        digest: CatalogReleaseDigest(predecessor.digest),
      },
      actorPrincipalId: PUBLISHER,
      adoptionEvidence: {
        source_bundle_digest: predecessor.digest,
        verification_digest: predecessor.digest,
        data_mode: "populated",
        collected_at: "2026-09-12T00:00:00.000Z",
        approved_by: PUBLISHER,
      },
    });
    const before = await domainSnapshot(observer);
    const bootstrap = await installPublishedRelease(pool, {
      mode: "bootstrap",
      source: jsonCatalogReleaseSource(predecessor.bundle),
      expectedTargetDigest: predecessor.compiled.aggregateDigest,
    });
    expect(bootstrap).toMatchObject({
      ok: false,
      error: { kind: "publication-regime-required", receiptsPresent: true },
    });
    expect(await domainSnapshot(observer)).toEqual(before);
  });
});
