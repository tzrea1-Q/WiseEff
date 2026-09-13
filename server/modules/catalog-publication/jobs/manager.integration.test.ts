import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import {
  connect,
  domainSnapshot,
  provisionOnlineActivation,
  publisherPermissions,
  userActor,
} from "../../catalog-kernel/install/publicationTestHarness";
import { getJob, getReceiptByJobId } from "../persistence/store";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { withPublicationCoordinator } from "../coordinator";
import {
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
    expect(() => assertPublicationManagerProcessFence({})).not.toThrow();
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
    const claimed = await runPublicationManagerOnce({
      db,
      pool,
      installer: createCatalogInstaller(pool),
      resolvePublisherActor: async () => userActor("user-catalog-publisher", publisherPermissions),
      ownerId: "manager-once",
    });
    expect(claimed).toBe("claimed");
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
        activationTimeoutMs: 200,
        log: (fields) => {
          if (typeof fields.event === "string") events.push(fields.event);
        },
      });
      expect(claimed).toBe("claimed");
      expect(events).toContain("activated");
      expect(events).not.toContain("activation-timeout");
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onReject);
    }
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
