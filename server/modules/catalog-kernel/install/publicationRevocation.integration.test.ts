import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { revokeAuthorization } from "../../catalog-publication/authorization/authorize";
import {
  PUBLISHER,
  asCoordinator,
  publisherPermissions,
  userActor,
} from "../../catalog-publication/authorization/testHarness";
import { asQueryable } from "../../catalog-publication/persistence/integrationHarness";
import {
  createEphemeralTestDatabase,
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type EphemeralTestDatabase,
} from "../../../testing/testDatabase";
import { installPublishedRelease, installPublishedReleaseForTests } from "./installer";
import {
  connect,
  domainSnapshot,
  provisionOnlineActivation,
} from "./publicationTestHarness";

const databaseAvailable = await isTestDatabaseAvailable();
if (!databaseAvailable) {
  throw new Error(
    "CP-05 publication revocation tests require a reachable real PostgreSQL server with pgvector; skipping is forbidden",
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
    "CP-05 publication revocation tests require pgvector installed in the real PostgreSQL test database; skipping is forbidden",
  );
}

describe("publication revoke versus activate linearization", () => {
  let database: EphemeralTestDatabase;
  let pool: pg.Pool;
  let observer: pg.Client;

  beforeEach(async () => {
    database = await createEphemeralTestDatabase("cp05rev");
    pool = new pg.Pool({ connectionString: database.url, max: 4 });
    observer = await connect(database.url);
  }, 60_000);

  afterEach(async () => {
    await observer?.end().catch(() => undefined);
    await pool?.end().catch(() => undefined);
    await database?.drop();
  }, 60_000);

  it("refuses activation when revoke commits first", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_rvk1");
    const revoked = await asCoordinator(observer, async () =>
      revokeAuthorization(asQueryable(observer), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidateId: prepared.candidate.id,
        approvedAuthorizationId: prepared.authorization.id,
        lockMode: "publication-guard",
      }),
    );
    expect(revoked.ok).toBe(true);
    const before = await domainSnapshot(observer);
    const activated = await installPublishedRelease(pool, prepared.command);
    expect(activated.ok).toBe(false);
    if (!activated.ok) {
      expect(activated.error).toMatchObject({
        kind: "publication-not-authorized",
        reason: "publication-authorization-revoked",
      });
    }
    const after = await domainSnapshot(observer);
    expect(after.current).toBe(before.current);
    expect(after.receipts).toBe("0");
    expect(after.revisions).toBe(before.revisions);
  });

  it("keeps a committed receipt when revoke happens after activation", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_rvk2");
    const activated = await installPublishedRelease(pool, prepared.command);
    expect(activated.ok).toBe(true);
    const afterActivate = await domainSnapshot(observer);
    const revoked = await asCoordinator(observer, async () =>
      revokeAuthorization(asQueryable(observer), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidateId: prepared.candidate.id,
        approvedAuthorizationId: prepared.authorization.id,
        lockMode: "publication-guard",
      }),
    );
    expect(revoked.ok).toBe(true);
    const after = await domainSnapshot(observer);
    expect(after.current).toBe(afterActivate.current);
    expect(after.receipts).toBe("1");
    expect(after.receiptKinds).toEqual(["online-publication"]);
  });

  it("linearizes concurrent revoke behind an in-flight activation that already holds the guard", async () => {
    const prepared = await provisionOnlineActivation(pool, observer, "iin_rvk3");
    const revoker = await connect(database.url);
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

    const revoking = asCoordinator(revoker, async () =>
      revokeAuthorization(asQueryable(revoker), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidateId: prepared.candidate.id,
        approvedAuthorizationId: prepared.authorization.id,
        lockMode: "publication-guard",
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
    const revoked = await revoking;
    expect(activated.ok).toBe(true);
    expect(revoked.ok).toBe(true);
    const after = await domainSnapshot(observer);
    expect(after.receipts).toBe("1");
    expect(after.current).toBe(prepared.compiled.release.id);
    } finally {
      releaseActivation?.();
      await revoker.end().catch(() => undefined);
    }
  });
});
