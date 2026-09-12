import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCatalogInstaller, createCatalogInstallerForTests } from "../../catalog-kernel/install/installer";
import {
  bootstrapFirstAcme,
  buildAuthorizedJob,
  connect,
  domainSnapshot,
  persistPredecessorArtifact,
  provisionOnlineActivation,
  publisherPermissions,
  userActor,
} from "../../catalog-kernel/install/publicationTestHarness";
import { revokeAuthorization } from "../authorization/authorize";
import { asCoordinator } from "../authorization/testHarness";
import { asQueryable } from "../persistence/integrationHarness";
import { getJob, getReceiptByJobId } from "../persistence/store";
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
    "CP-07 recovery tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-07 recovery tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

const publisherActor = async () => userActor("user-catalog-publisher", publisherPermissions);

describe("CP-07 publication job recovery", () => {
  let database: EphemeralTestDatabase;
  let db: RootDatabase;
  let pool: pg.Pool;
  let client: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp07rec");
    db = createPostgresDatabase(database.url);
    pool = getRootPostgresPool(db)!;
    client = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await client?.end().catch(() => undefined);
    await db?.close().catch(() => undefined);
    await database?.drop();
  });

  const claimAndExecute = async (
    installer: ReturnType<typeof createCatalogInstaller>,
    leaseOwner: string,
  ) => {
    const claimed = await withPublicationCoordinator(db, (tx) =>
      claimPublicationJob(tx, { leaseOwner, leaseSeconds: 30 }),
    );
    if (!claimed.ok) {
      throw new Error(`claim failed: ${JSON.stringify(claimed.error)}`);
    }
    return executeClaimedPublicationJob({
      db,
      pool,
      installer,
      claimed: claimed.value,
      resolvePublisherActor: publisherActor,
      retryBudget: 5,
    });
  };

  it("T10 recovers from Receipt after a lost success response without rematerializing", async () => {
    await provisionOnlineActivation(pool, client, "iin_t10");
    const installer = createCatalogInstaller(pool);
    const first = await claimAndExecute(installer, "manager-t10");
    expect(first, JSON.stringify(first)).toMatchObject({ kind: "activated" });
    const snapshot = await domainSnapshot(client);
    const claimed = await withPublicationCoordinator(db, (tx) => getJob(tx, (first as { job: { id: string } }).job.id));
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      throw new Error("job missing");
    }
    const recovered = await executeClaimedPublicationJob({
      db,
      pool,
      installer,
      claimed: claimed.value,
      resolvePublisherActor: publisherActor,
      retryBudget: 5,
    });
    expect(recovered.kind).toBe("activated");
    if (recovered.kind !== "activated") {
      throw new Error("expected recovery");
    }
    expect(recovered.recoveredFromReceipt).toBe(true);
    expect(recovered.currentness).toBe("active");
    const after = await domainSnapshot(client);
    expect(after.receipts).toBe(snapshot.receipts);
    expect(after.current).toBe(snapshot.current);
    expect(after.revisions).toBe(snapshot.revisions);
  });

  it("T11 reports active-superseded for R2 after R3 is current", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const first = await buildAuthorizedJob(client, {
      predecessorDigest: predecessor.digest,
      propertyKey: "iin_r2",
    });
    const installer = createCatalogInstaller(pool);
    const activatedR2 = await claimAndExecute(installer, "manager-r2");
    expect(activatedR2.kind).toBe("activated");
    const r2JobId = first.job.id;

    const second = await buildAuthorizedJob(client, {
      predecessorDigest: first.candidate.artifactDigest,
      propertyKey: "iin_r3",
      releaseVersion: "1.2.0",
    });
    const activatedR3 = await claimAndExecute(installer, "manager-r3");
    expect(activatedR3.kind).toBe("activated");
    if (activatedR3.kind === "activated") {
      expect(activatedR3.currentness).toBe("active");
    }

    const r2 = await withPublicationCoordinator(db, (tx) => getJob(tx, r2JobId));
    expect(r2.ok).toBe(true);
    if (!r2.ok) {
      throw new Error("r2 missing");
    }
    const recovered = await executeClaimedPublicationJob({
      db,
      pool,
      installer,
      claimed: r2.value,
      resolvePublisherActor: publisherActor,
      retryBudget: 5,
    });
    expect(recovered.kind).toBe("activated");
    if (recovered.kind !== "activated") {
      throw new Error("expected r2 recovery");
    }
    expect(recovered.currentness).toBe("active-superseded");
    expect(recovered.recoveredFromReceipt).toBe(true);
    const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, r2JobId));
    expect(receipt.ok).toBe(true);
    const current = await domainSnapshot(client);
    expect(current.current).toBe(second.compiled.release.id);
    expect(current.current).not.toBe(first.compiled.release.id);
  });

  it("T05 allows exactly one of two same-predecessor jobs to activate", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    await buildAuthorizedJob(client, {
      predecessorDigest: predecessor.digest,
      propertyKey: "iin_t05a",
      requestScope: "instance:t05a",
    });
    await buildAuthorizedJob(client, {
      predecessorDigest: predecessor.digest,
      propertyKey: "iin_t05b",
      requestScope: "instance:t05b",
    });
    const installer = createCatalogInstaller(pool);
    const claimedA = await withPublicationCoordinator(db, (tx) =>
      claimPublicationJob(tx, { leaseOwner: "manager-t05a", leaseSeconds: 30 }),
    );
    const claimedB = await withPublicationCoordinator(db, (tx) =>
      claimPublicationJob(tx, { leaseOwner: "manager-t05b", leaseSeconds: 30 }),
    );
    expect(claimedA.ok && claimedB.ok).toBe(true);
    if (!claimedA.ok || !claimedB.ok) {
      throw new Error("claims failed");
    }
    const [left, right] = await Promise.all([
      executeClaimedPublicationJob({
        db,
        pool,
        installer,
        claimed: claimedA.value,
        resolvePublisherActor: publisherActor,
        retryBudget: 5,
      }),
      executeClaimedPublicationJob({
        db,
        pool,
        installer,
        claimed: claimedB.value,
        resolvePublisherActor: publisherActor,
        retryBudget: 5,
      }),
    ]);
    const kinds = [left.kind, right.kind].sort();
    const statuses = [left.kind === "settled" ? left.job.status : null, right.kind === "settled" ? right.job.status : null];
    expect(kinds).toContain("activated");
    expect(statuses.includes("needs-rebase") || kinds.includes("settled")).toBe(true);
    const snapshot = await domainSnapshot(client);
    expect(snapshot.receiptKinds.filter((kind) => kind === "online-publication")).toHaveLength(1);
  });

  it("T08 blocks activation when authorization is revoked first", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_t08");
    await asCoordinator(client, async () =>
      revokeAuthorization(asQueryable(client), {
        trustedActor: userActor(prepared.authorization.actorPrincipalId, publisherPermissions),
        candidateId: prepared.candidate.id,
        approvedAuthorizationId: prepared.authorization.id,
        lockMode: "publication-guard",
      }),
    );
    const installer = createCatalogInstallerForTests(pool);
    const executed = await claimAndExecute(installer, "manager-t08");
    expect(executed.kind).toBe("settled");
    if (executed.kind !== "settled") {
      throw new Error("expected blocked settle");
    }
    expect(executed.job.status).toBe("blocked");
    expect(executed.job.lastErrorReason).toBe("publication-authorization-revoked");
    const snapshot = await domainSnapshot(client);
    expect(snapshot.receiptKinds).not.toContain("online-publication");
  });
});
