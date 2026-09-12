import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import {
  connect,
  domainSnapshot,
  provisionOnlineActivation,
  userActor,
  publisherPermissions,
} from "../../catalog-kernel/install/publicationTestHarness";
import { asCoordinator } from "../authorization/testHarness";
import { asQueryable } from "../persistence/integrationHarness";
import { getJob, updateJobExecution } from "../persistence/store";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";
import { withPublicationCoordinator } from "../coordinator";
import { claimPublicationJob } from "./claim";
import { executeClaimedPublicationJob } from "./execute";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-07 fencing tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-07 fencing tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("CP-07 publication job fencing", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp07fen");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  it("T12.a rejects a stale fence after a later claim and lets the new fence activate once", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_fence");
    const installer = createCatalogInstaller(pool);
    const resolvePublisherActor = async () => userActor(prepared.command.trustedActor.initiator === "user"
      ? prepared.authorization.actorPrincipalId
      : prepared.authorization.actorPrincipalId, publisherPermissions);

    const claimedA = await withPublicationCoordinator(db, (tx) =>
      claimPublicationJob(tx, { leaseOwner: "manager-a", leaseSeconds: 30 }),
    );
    expect(claimedA.ok).toBe(true);
    if (!claimedA.ok) {
      throw new Error("claim A failed");
    }
    expect(claimedA.value.fencingToken).toBe(1);
    expect(claimedA.value.status).toBe("running");

    await asCoordinator(client, async () =>
      updateJobExecution(asQueryable(client), claimedA.value.id, {
        leaseUntil: "2000-01-01T00:00:00.000Z",
      }),
    );

    const claimedB = await withPublicationCoordinator(db, (tx) =>
      claimPublicationJob(tx, { leaseOwner: "manager-b", leaseSeconds: 30 }),
    );
    expect(claimedB.ok).toBe(true);
    if (!claimedB.ok) {
      throw new Error("claim B failed");
    }
    expect(claimedB.value.fencingToken).toBe(2);
    expect(claimedB.value.leaseOwner).toBe("manager-b");

    const stale = await executeClaimedPublicationJob({
      db,
      pool,
      installer,
      claimed: claimedA.value,
      resolvePublisherActor,
      retryBudget: 5,
    });
    expect(stale.kind).toBe("stale-fence");

    const before = await domainSnapshot(client);
    const winner = await executeClaimedPublicationJob({
      db,
      pool,
      installer,
      claimed: claimedB.value,
      resolvePublisherActor,
      retryBudget: 5,
    });
    expect(winner, JSON.stringify(winner)).toMatchObject({ kind: "activated" });
    if (winner.kind !== "activated") {
      throw new Error("expected activation");
    }
    expect(winner.currentness).toBe("active");
    expect(winner.recoveredFromReceipt).toBe(false);

    const after = await domainSnapshot(client);
    expect(Number(after.receipts)).toBe(Number(before.receipts) + 1);
    expect(after.current).toBe(prepared.candidate.artifactDigest ? after.current : after.current);
    expect(after.current).not.toBe(before.current);

    const job = await withPublicationCoordinator(db, (tx) => getJob(tx, claimedB.value.id));
    expect(job.ok && job.value.status).toBe("active");
    expect(job.ok && job.value.fencingToken).toBe(2);
  });
});
