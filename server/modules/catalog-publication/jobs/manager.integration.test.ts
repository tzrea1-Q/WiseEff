import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import {
  connect,
  domainSnapshot,
  provisionOnlineActivation,
  publisherPermissions,
  userActor,
} from "../../catalog-kernel/install/publicationTestHarness";
import { getJob, getReceiptByJobId, updateJobExecution } from "../persistence/store";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { withPublicationCoordinator } from "../coordinator";
import {
  assertPublicationManagerEntry,
  assertPublicationManagerProcessFence,
  readPublicationManagerHealth,
  resolvePublicationManagerOptions,
  runPublicationManagerOnce,
} from "./manager";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-07 manager tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-07 manager tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("CP-07 publication manager production seam", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp07mgr");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  it("fails closed when the API process identity is combined with synchronizer credentials", () => {
    expect(() =>
      assertPublicationManagerProcessFence({
        WISEEFF_API_PROCESS: "1",
        WISEEFF_CATALOG_SYNCHRONIZER_DATABASE_URL: "postgres://synchronizer@127.0.0.1/db",
      }),
    ).toThrow(/must not share the API process identity/);
    expect(() =>
      assertPublicationManagerProcessFence({
        LOG_WORKER_ENABLED: "true",
      }),
    ).toThrow(/must not share the log worker identity/);
    expect(() => assertPublicationManagerProcessFence({})).not.toThrow();
    expect(() => assertPublicationManagerEntry({})).toThrow(/WISEEFF_PUBLICATION_MANAGER=1/);
    expect(() =>
      assertPublicationManagerEntry({ WISEEFF_PUBLICATION_MANAGER: "1" }),
    ).not.toThrow();
    const resolved = resolvePublicationManagerOptions({
      WISEEFF_PUBLICATION_MANAGER_LEASE_MS: "15000",
      WISEEFF_PUBLICATION_MANAGER_RETRY_BUDGET: "3",
      WISEEFF_PUBLICATION_MANAGER_POLL_INTERVAL_MS: "250",
      WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS: "12000",
    });
    expect(resolved).toEqual({
      leaseMs: 15000,
      retryBudget: 3,
      pollIntervalMs: 250,
      activationTimeoutMs: 12000,
    });
  });

  it("returns idle on an empty queue and exposes a health snapshot", async () => {
    const idle = await runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
      ownerId: "manager-idle",
    });
    expect(idle).toBe("idle");
    const health = await readPublicationManagerHealth(db);
    expect(health.live).toBe(true);
    expect(health.queuedCount).toBe(0);
    expect(health.runningCount).toBe(0);
  });

  it("claims and executes one queued job through to a Receipt", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_mgr");
    const healthQueued = await readPublicationManagerHealth(db);
    expect(healthQueued.queuedCount).toBeGreaterThanOrEqual(1);
    const events: Record<string, string | number | boolean | null>[] = [];
    const claimed = await runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
      ownerId: "manager-once",
      log: fields => { events.push(fields); },
    });
    expect(claimed).toBe("claimed");
    for (const stage of [
      "artifact-read", "lineage-verify-decode", "compile", "pointer-lock", "publication-lock",
      "materialize", "verify-projection", "restore-heads", "verify-constraints", "commit", "activation",
    ]) {
      expect(events).toContainEqual(expect.objectContaining({
        event: "catalog-stage", stage, state: "finished", elapsedMs: expect.any(Number),
        jobId: prepared.job.id, attempt: 1, fence: 1,
      }));
    }
    const read = events.find(entry => entry.stage === "artifact-read" && entry.state === "finished");
    expect(read?.artifactCount).toBeGreaterThan(0);
    expect(read?.byteCount).toBeGreaterThan(0);
    const job = await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id));
    expect(job.ok && job.value.status).toBe("active");
    const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, prepared.job.id));
    expect(receipt.ok).toBe(true);
    const snapshot = await domainSnapshot(client);
    expect(snapshot.receiptKinds).toContain("online-publication");
    const idle = await runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
      ownerId: "manager-once-2",
    });
    expect(idle).toBe("idle");
  });

  it("T25 keeps the published catalog and queued jobs readable when the manager is not running", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_t25m");
    const pointer = await readCurrentCatalogPointer(pool);
    expect(pointer.kind).toBe("installed");
    const job = await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id));
    expect(job.ok && job.value.status).toBe("queued");
    const health = await readPublicationManagerHealth(db);
    expect(health.queuedCount).toBeGreaterThanOrEqual(1);
    expect(health.runningCount).toBe(0);
    const snapshot = await domainSnapshot(client);
    expect(snapshot.current).toBe(prepared.candidate.expectedBaseReleaseId);
    expect(snapshot.receiptKinds).not.toContain("online-publication");
  });

  it("clears the activation timer when execute wins and does not unhandled-reject later", async () => {
    await provisionOnlineActivation(pool, client, "iin_tmr1");
    // Advance only the watchdog timer. The real activation has its own deadline.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    const rejections: unknown[] = [];
    const onReject = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onReject);
    const events: string[] = [];
    try {
      const claimed = await runPublicationManagerOnce({
        db,
        pool,
        installer: createCatalogInstaller(pool),
        resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
        ownerId: "manager-timer-cleared",
        activationTimeoutMs: 30_000,
        log: (fields) => {
          if (typeof fields.event === "string") events.push(fields.event);
        },
      });
      expect(claimed).toBe("claimed");
      expect(events).toContain("activated");
      expect(events).not.toContain("activation-timeout");
      const timerIndex = setTimer.mock.calls.findIndex(([, ms]) => ms === 30_000);
      expect(timerIndex).toBeGreaterThanOrEqual(0);
      expect(clearTimer).toHaveBeenCalledWith(setTimer.mock.results[timerIndex]?.value);
      await vi.advanceTimersByTimeAsync(30_350);
      expect(rejections).toEqual([]);
    } finally {
      setTimer.mockRestore();
      clearTimer.mockRestore();
      vi.useRealTimers();
      process.off("unhandledRejection", onReject);
    }
  });

  it("keeps the same claim after the watchdog while activation finishes without a Receipt yet", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_slow");
    const inner = createCatalogInstaller(pool);
    const started = deferred();
    const finish = deferred();
    const watchdog = deferred();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const options = {
      db, pool, leaseMs: 1_000, activationTimeoutMs: 30_000,
      installer: { ...inner, installPublishedRelease: async (command: Parameters<typeof inner.installPublishedRelease>[0]) => {
        started.resolve();
        await finish.promise;
        return inner.installPublishedRelease(command);
      } },
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
      log: (fields: Record<string, string | number | boolean | null>) => {
        if (fields.event === "activation-timeout") watchdog.resolve();
      },
    };
    let completed = false;
    const tick = runPublicationManagerOnce(options).then((result) => {
      completed = true;
      return result;
    });
    try {
      await started.promise;
      await vi.advanceTimersByTimeAsync(30_000);
      await watchdog.promise;
      expect(await runPublicationManagerOnce(options)).toBe("idle");
      const job = await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id));
      expect(job).toMatchObject({ ok: true, value: { status: "running", attemptCount: 1, fencingToken: 1 } });
      if (!job.ok || !job.value.leaseUntil) throw new Error("expected an in-flight lease");
      expect(Date.parse(job.value.leaseUntil) - Date.parse(job.value.updatedAt)).toBe(65_000);
      expect(completed).toBe(false);
      finish.resolve();
      expect(await tick).toBe("claimed");
      expect(await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id)))
        .toMatchObject({ ok: true, value: { status: "active", attemptCount: 1, fencingToken: 1 } });
      expect(await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, prepared.job.id)))
        .toMatchObject({ ok: true });
    } finally {
      finish.resolve();
      vi.useRealTimers();
      await tick.catch(() => undefined);
    }
  });

  it("settles rolled-back deadline failures and stops after the retry budget", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_budget");
    const before = await domainSnapshot(client);
    const inner = createCatalogInstaller(pool);
    const options = {
      db, pool, retryBudget: 2,
      installer: { ...inner, installPublishedRelease: async () => ({ ok: false, error: { kind: "activation-timeout" } }) } satisfies typeof inner,
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
    };
    expect(await runPublicationManagerOnce(options)).toBe("claimed");
    expect(await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id)))
      .toMatchObject({ ok: true, value: { status: "failed-retryable", attemptCount: 1, lastErrorReason: "activation-timeout" } });
    expect(await withPublicationCoordinator(db, (tx) => updateJobExecution(tx, prepared.job.id, {
      leaseUntil: "2000-01-01T00:00:00.000Z", expectedFencingToken: 1,
    }))).toMatchObject({ ok: true });
    expect(await runPublicationManagerOnce(options)).toBe("claimed");
    expect(await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id)))
      .toMatchObject({ ok: true, value: { status: "failed-terminal", attemptCount: 2, lastErrorReason: "activation-timeout" } });
    expect(await runPublicationManagerOnce(options)).toBe("idle");
    expect(await domainSnapshot(client)).toEqual({ ...before, jobStatuses: ["failed-terminal"] });
  });

  it("keeps a committed activation when the installer returns a deadline error after COMMIT", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_commit_result");
    const inner = createCatalogInstaller(pool);
    const installer = { ...inner, installPublishedRelease: async (command) => {
      const installed = await inner.installPublishedRelease(command);
      expect(installed.ok).toBe(true);
      return { ok: false, error: { kind: "activation-timeout" } };
    } } satisfies typeof inner;
    expect(await runPublicationManagerOnce({
      db, pool, retryBudget: 1, installer,
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
    })).toBe("claimed");
    expect(await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id)))
      .toMatchObject({ ok: true, value: { status: "active", attemptCount: 1, lastErrorReason: null } });
    expect((await domainSnapshot(client)).receiptKinds).toEqual(["online-publication"]);
  });

  it("preserves a job cancelled during the attempt even though its fencing token stayed the same", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_cancelled");
    const inner = createCatalogInstaller(pool);
    const installer = { ...inner, installPublishedRelease: async () => {
      const cancelled = await withPublicationCoordinator(db, (tx) => updateJobExecution(tx, prepared.job.id, {
        status: "cancelled", leaseUntil: null, expectedFencingToken: 1,
      }));
      expect(cancelled.ok).toBe(true);
      return { ok: false, error: { kind: "activation-timeout" } };
    } } satisfies typeof inner;
    expect(await runPublicationManagerOnce({
      db, pool, installer,
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
    })).toBe("claimed");
    expect(await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id)))
      .toMatchObject({ ok: true, value: { status: "cancelled", attemptCount: 1, fencingToken: 1, lastErrorReason: null } });
  });

  it("settles an unexpected executor rejection against the retry budget", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_rejected");
    expect(await runPublicationManagerOnce({
      db, pool, retryBudget: 1, installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => { throw new Error("actor lookup interrupted"); },
    })).toBe("claimed");
    expect(await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id)))
      .toMatchObject({ ok: true, value: { status: "failed-terminal", attemptCount: 1, lastErrorReason: "activation-execution-error" } });
  });

  it("reconciles from Receipt when the activation timeout wins and does not crash", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_tmr2");
    const inner = createCatalogInstaller(pool);
    let hangReleased!: () => void;
    const hang = new Promise<void>((resolve) => {
      hangReleased = resolve;
    });
    const hangingInstaller = {
      installPublishedRelease: async (
        command: Parameters<typeof inner.installPublishedRelease>[0],
      ) => {
        const result = await inner.installPublishedRelease(command);
        await hang;
        return result;
      },
      switchBackBeforeTraffic: inner.switchBackBeforeTraffic.bind(inner),
    };
    const rejections: unknown[] = [];
    const onReject = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onReject);
    const events: Array<Record<string, string | number | boolean | null>> = [];
    try {
      const claimed = await runPublicationManagerOnce({
        db,
        pool,
        installer: hangingInstaller,
        resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
        ownerId: "manager-timer-wins",
        activationTimeoutMs: 2_000,
        log: (fields) => {
          events.push(fields);
        },
      });
      expect(claimed).toBe("claimed");
      expect(events.some((entry) => entry.event === "activation-timeout")).toBe(true);
      const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, prepared.job.id));
      expect(receipt.ok).toBe(true);
      const job = await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id));
      expect(job.ok && job.value.status).toBe("active");
      hangReleased();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rejections).toEqual([]);
    } finally {
      hangReleased();
      process.off("unhandledRejection", onReject);
    }
  });

  it("does not label a thrown execute failure as activation-timeout", async () => {
    await provisionOnlineActivation(pool, client, "iin_tmr3");
    const events: string[] = [];
    const claimed = await runPublicationManagerOnce({
      db,
      pool,
      installer: {
        installPublishedRelease: async () => {
          throw new Error("installer-boom");
        },
        switchBackBeforeTraffic: async () => {
          throw new Error("installer-boom");
        },
      },
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
      ownerId: "manager-exec-error",
      activationTimeoutMs: 5_000,
      log: (fields) => {
        if (typeof fields.event === "string") events.push(fields.event);
      },
    });
    expect(claimed).toBe("claimed");
    expect(events).not.toContain("activation-timeout");
  });
});
