import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogKernel } from "../../catalog-kernel/interface";
import {
  installPublishedRelease,
  installPublishedReleaseForTests,
} from "../../catalog-kernel/install/installer";
import {
  bootstrapFirstAcme,
  buildAuthorizedJob,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  provisionOnlineActivation,
  PUBLISHER,
} from "../../catalog-kernel/install/publicationTestHarness";
import { asCoordinator } from "../authorization/testHarness";
import { asQueryable } from "../persistence/integrationHarness";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { runInspectCatalogPublicationBaseline } from "../../../../scripts/inspect-catalog-publication-baseline";
import { adoptPreexistingCatalog } from "./adoption";
import { setPublicationFreeze } from "./freeze";
import { evaluateDualFactReadiness } from "./readiness";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-06 readiness tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-06 readiness tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("catalog publication dual-fact readiness", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp06rdy");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("treats populated dual-fact without an application pin as not ready and does not invent P13", async () => {
    await bootstrapFirstAcme(pool);
    const dual = await evaluateDualFactReadiness(pool, { dataMode: "populated" });
    expect(dual.status).toBe("not-ready");
    if (dual.status !== "not-ready") return;
    expect(dual.onlinePublicationReady).toBe(false);
    expect(dual.reasons).toContain("application-pin-absent");
    expect(dual.application).not.toEqual({
      kind: "new-empty-without-p13",
      claimsP13Retired: false,
    });
    expect(JSON.stringify(dual)).not.toContain("claimsP13Retired\":true");
  });

  it("treats new-empty canonical-installed without a Receipt as not online-publication-ready and does not claim P13", async () => {
    await bootstrapFirstAcme(pool);
    const dual = await evaluateDualFactReadiness(pool, { dataMode: "new-empty" });
    expect(dual.status).toBe("not-ready");
    if (dual.status !== "not-ready") return;
    expect(dual.onlinePublicationReady).toBe(false);
    expect(dual.reasons).toContain("legacy-d1-without-receipt");
    expect(dual.application).toEqual({
      kind: "new-empty-without-p13",
      claimsP13Retired: false,
    });
  });

  it("becomes dual-fact ready after labeled synthetic adoption without rewriting P13 reports", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    const fingerprint = await observer.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1`,
      [predecessor.compiled.release.id],
    );
    const adopted = await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      actorPrincipalId: PUBLISHER,
      sourceBytes: predecessor.bytes,
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
    expect(adopted.ok).toBe(true);
    const dual = await evaluateDualFactReadiness(pool, { dataMode: "new-empty" });
    expect(dual.status).toBe("ready");
    if (dual.status !== "ready") return;
    expect(dual.application.kind).toBe("new-empty-without-p13");
    expect(dual.catalog.receiptKind).toBe("adopted-preexisting");
    expect(dual.catalog.pin.digest).toBe(predecessor.digest);
  });

  it("freezes online activation without writing a Receipt and keeps the job row", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_frz");
    const before = await domainSnapshot(observer);
    await asCoordinator(observer, async () =>
      setPublicationFreeze(asQueryable(observer), {
        frozen: true,
        actorPrincipalId: PUBLISHER,
      }),
    );
    const frozen = await installPublishedRelease(pool, prepared.command);
    expect(frozen.ok).toBe(false);
    if (frozen.ok) return;
    expect(frozen.error).toMatchObject({
      kind: "publication-not-authorized",
      reason: "publication-frozen",
    });
    const during = await domainSnapshot(observer);
    expect(during.receipts).toBe(before.receipts);
    expect(during.current).toBe(before.current);
    expect(during.jobStatuses).toEqual(before.jobStatuses);
    expect(during.jobStatuses).toContain("queued");

    await asCoordinator(observer, async () =>
      setPublicationFreeze(asQueryable(observer), {
        frozen: false,
        actorPrincipalId: PUBLISHER,
      }),
    );
    const unfrozen = await installPublishedRelease(pool, prepared.command);
    expect(unfrozen.ok).toBe(true);
    if (!unfrozen.ok) return;
    expect(unfrozen.value).toMatchObject({
      commandKind: "online-publication",
      currentness: "active",
    });
    const after = await domainSnapshot(observer);
    expect(after.receipts).toBe("1");
    expect(after.receiptKinds).toEqual(["online-publication"]);
    expect(after.jobStatuses).toEqual(["active"]);
  });

  it("loads current catalog through the kernel after dual-fact catalog proof exists", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(observer, predecessor);
    const fingerprint = await observer.query<{ compiled_fingerprint: string }>(
      `select compiled_fingerprint from parameter_catalog.catalog_materializations where release_id = $1`,
      [predecessor.compiled.release.id],
    );
    await adoptPreexistingCatalog(pool, {
      expectedCurrent: {
        id: predecessor.compiled.release.id,
        digest: predecessor.digest,
      },
      actorPrincipalId: PUBLISHER,
      sourceBytes: predecessor.bytes,
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
    const kernel = createCatalogKernel(pool);
    const loaded = await kernel.loadCurrentCatalog({
      id: predecessor.compiled.release.id,
      digest: predecessor.digest,
    });
    expect(loaded.ok).toBe(true);
  });

  it("collector refuses a writable DSN and does not emit the connection string", async () => {
    const result = await runInspectCatalogPublicationBaseline({
      CATALOG_BASELINE_READONLY_DATABASE_URL: database.url,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("privilege");
    expect(JSON.stringify(result)).not.toMatch(/postgres:\/\//);
    expect(JSON.stringify(result)).not.toContain(database.url);
  });
});

describe("catalog publication freeze vs in-flight activation T22", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp06t22");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  });

  it("linearizes freeze behind an in-flight activation that already holds the guard", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_t22a");
    const second = await buildAuthorizedJob(observer, {
      predecessorDigest: prepared.predecessor.digest,
      propertyKey: "iin_t22b",
    });
    const freezer = await connect(database.url);
    let releaseActivation: (() => void) | undefined;
    try {
      const held = new Promise<void>((resolve) => {
        releaseActivation = resolve;
      });
      let guardHeld = false;
      const activating = installPublishedReleaseForTests(pool, prepared.command, {
        afterGuard: async () => {
          guardHeld = true;
          await held;
        },
      });

      const deadline = Date.now() + 5_000;
      while (!guardHeld && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(guardHeld).toBe(true);

      const freezing = asCoordinator(freezer, async () =>
        setPublicationFreeze(asQueryable(freezer), {
          frozen: true,
          actorPrincipalId: PUBLISHER,
        }),
      );

      const waitingDeadline = Date.now() + 1_500;
      let sawWait = false;
      while (Date.now() < waitingDeadline) {
        const waiting = await observer.query<{ waiting: boolean }>(
          `select exists (
             select 1 from pg_catalog.pg_stat_activity
             where datname = current_database()
               and wait_event_type = 'Lock'
               and pid <> pg_backend_pid()
           ) as waiting`,
        );
        if (waiting.rows[0]?.waiting) {
          sawWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(sawWait).toBe(true);
      releaseActivation?.();

      const activated = await activating;
      const frozen = await freezing;
      expect(frozen.ok).toBe(true);
      if (!frozen.ok) return;
      expect(frozen.value.frozen).toBe(true);

      const freezeRow = await observer.query<{ frozen: boolean; updated_at: Date }>(
        `select frozen, updated_at from catalog_publication.publication_freeze where singleton`,
      );
      expect(freezeRow.rows[0]?.frozen).toBe(true);

      const receipts = await observer.query<{ created_at: Date }>(
        `select created_at from parameter_catalog.catalog_activation_receipts order by created_at, id`,
      );
      if (receipts.rows.length > 0) {
        expect(activated.ok).toBe(true);
        expect(receipts.rows[0]!.created_at.getTime()).toBeLessThanOrEqual(
          freezeRow.rows[0]!.updated_at.getTime(),
        );
      }

      const afterFreeze = await installPublishedRelease(pool, second.command);
      expect(afterFreeze.ok).toBe(false);
      if (afterFreeze.ok) return;
      expect(afterFreeze.error).toMatchObject({
        kind: "publication-not-authorized",
        reason: "publication-frozen",
      });
      const jobs = await observer.query<{ status: string }>(
        `select status from catalog_publication.publication_jobs order by created_at, id`,
      );
      expect(jobs.rows.length).toBe(2);
      expect(jobs.rows.every((row) => row.status !== "")).toBe(true);

      await asCoordinator(observer, async () =>
        setPublicationFreeze(asQueryable(observer), {
          frozen: false,
          actorPrincipalId: PUBLISHER,
        }),
      );
    } finally {
      releaseActivation?.();
      await freezer.end().catch(() => undefined);
    }
  });
});
