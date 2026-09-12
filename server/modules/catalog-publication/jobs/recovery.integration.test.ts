import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createCatalogInstaller,
  createCatalogInstallerForTests,
  installPublishedReleaseForTests,
} from "../../catalog-kernel/install/installer";
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
import { authorizePublish, revokeAuthorization } from "../authorization/authorize";
import {
  AUTHOR,
  REVIEWER,
  asCoordinator,
  enablePublicationPolicy,
  highFacts,
  persistHandBuiltCandidate,
  reviewerPermissions,
} from "../authorization/testHarness";
import { asQueryable, sha256Digest, uniqueToken } from "../persistence/integrationHarness";
import { createJob, getJob, getReceiptByJobId } from "../persistence/store";
import { PublicationJobId, PublicationPolicyRevision } from "../../parameter-catalog-contract/index";
import { setPublicationFreeze } from "../runtime/freeze";
import { enqueuePublicationJob } from "../enqueue";
import { listenCatalogPublicationHttpServer } from "../../parameter-catalog-api/publication/http";
import { bindCatalogPublicationCommands } from "../../parameter-catalog-api/publication/ports";
import { createUserInvocation } from "../../auth/trustedInvocation";
import { makeTestAuthContext } from "../../../testing/authContext";
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

    const http = await listenCatalogPublicationHttpServer({
      authenticate: async () => ({
        ok: true,
        scope: {
          principalId: "user-catalog-publisher",
          organizationId: "org-test",
          actorKind: "org-admin",
          permissions: [...publisherPermissions],
          trustedActor: createUserInvocation(
            makeTestAuthContext({
              userId: "user-catalog-publisher",
              organizationId: "org-test",
              permissions: [...publisherPermissions],
            }),
          ),
        },
      }),
      currentRelease: async () => ({
        id: second.compiled.release.id,
        digest: second.compiled.release.digest,
      }),
      ...bindCatalogPublicationCommands({ db, pool }),
    });
    try {
      const response = await fetch(`${http.baseUrl}/api/v2/catalog/publications/${r2JobId}`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        item: {
          status: string;
          effective: boolean;
          isCurrent: boolean;
          currentness: string | null;
          failure: unknown;
        };
      };
      expect(body.item.status).toBe("active");
      expect(body.item.currentness).toBe("active-superseded");
      expect(body.item.isCurrent).toBe(false);
      expect(body.item.effective).toBe(true);
      expect(body.item.failure).toBeNull();
    } finally {
      await http.close();
    }
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
      enablePolicy: false,
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
    const outcomes = [left, right];
    const activated = outcomes.filter((item) => item.kind === "activated");
    const losers = outcomes.filter((item) => item.kind === "settled");
    expect(activated).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.kind === "settled" && losers[0].job.status).toBe("needs-rebase");
    const snapshot = await domainSnapshot(client);
    expect(snapshot.receiptKinds.filter((kind) => kind === "online-publication")).toHaveLength(1);
    if (activated[0]?.kind !== "activated") {
      throw new Error("expected one activation");
    }
    const winnerReceipt = await withPublicationCoordinator(db, (tx) =>
      getReceiptByJobId(tx, activated[0]!.kind === "activated" ? activated[0].job.id : losers[0]!.job.id),
    );
    expect(winnerReceipt.ok).toBe(true);
    if (winnerReceipt.ok) {
      expect(snapshot.current).toBe(winnerReceipt.value.releaseId);
    }
    const currentHeads = await client.query<{ release_id: string; n: string }>(
      `select heads.release_id, count(*)::text as n
         from parameter_catalog.catalog_release_definition_heads heads
         join parameter_catalog.catalog_state state
           on state.current_catalog_release_id = heads.release_id
        group by heads.release_id`,
    );
    expect(currentHeads.rows).toHaveLength(1);
    expect(currentHeads.rows[0]?.release_id).toBe(snapshot.current);
    const mixed = await client.query<{ definition_id: string }>(
      `select definition_id
         from parameter_catalog.catalog_release_definition_heads
        where release_id = $1
        group by definition_id
       having count(*) > 1`,
      [snapshot.current],
    );
    expect(mixed.rows).toEqual([]);
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

  it("T08 keeps success history when activation linearizes before revoke", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_t08w");
    const installer = createCatalogInstaller(pool);
    const executed = await claimAndExecute(installer, "manager-t08-win");
    expect(executed.kind).toBe("activated");
    const before = await domainSnapshot(client);
    const revoked = await asCoordinator(client, async () =>
      revokeAuthorization(asQueryable(client), {
        trustedActor: userActor(prepared.authorization.actorPrincipalId, publisherPermissions),
        candidateId: prepared.candidate.id,
        approvedAuthorizationId: prepared.authorization.id,
        lockMode: "publication-guard",
      }),
    );
    expect(revoked.ok).toBe(true);
    const after = await domainSnapshot(client);
    expect(after.current).toBe(before.current);
    expect(after.receipts).toBe(before.receipts);
    const job = await withPublicationCoordinator(db, (tx) => getJob(tx, prepared.job.id));
    expect(job.ok && job.value.status).toBe("active");
    const receipt = await withPublicationCoordinator(db, (tx) => getReceiptByJobId(tx, prepared.job.id));
    expect(receipt.ok).toBe(true);
  });

  it("T08 blocks execute after publication_enabled is closed", async () => {
    await provisionOnlineActivation(pool, client, "iin_t08p");
    await enablePublicationPolicy(client, {
      publicationEnabled: false,
      lowRiskSingleActorPublish: true,
    });
    const installer = createCatalogInstaller(pool);
    const executed = await claimAndExecute(installer, "manager-t08-policy");
    expect(executed.kind).toBe("settled");
    if (executed.kind !== "settled") {
      throw new Error("expected policy block");
    }
    expect(executed.job.status).toBe("blocked");
    expect(["publication-policy-disabled", "candidate-stale"]).toContain(executed.job.lastErrorReason);
    const snapshot = await domainSnapshot(client);
    expect(snapshot.receiptKinds).not.toContain("online-publication");
  });

  it("T08 linearizes freeze behind an in-flight activation that already holds the guard", async () => {
    const prepared = await provisionOnlineActivation(pool, client, "iin_t08f");
    const second = await buildAuthorizedJob(client, {
      predecessorDigest: prepared.predecessor.digest,
      propertyKey: "iin_t08f2",
      enablePolicy: false,
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
          actorPrincipalId: prepared.authorization.actorPrincipalId,
        }),
      );
      releaseActivation?.();
      const activated = await activating;
      const frozen = await freezing;
      expect(frozen, JSON.stringify(frozen)).toMatchObject({ ok: true });
      expect(activated, JSON.stringify(activated)).toMatchObject({ ok: true });
      const snapshot = await domainSnapshot(client);
      expect(snapshot.receiptKinds).toContain("online-publication");

      const later = await claimAndExecute(createCatalogInstaller(pool), "manager-t08-frozen");
      expect(later.kind).toBe("settled");
      if (later.kind !== "settled") {
        throw new Error("expected freeze block");
      }
      expect(later.job.id).toBe(second.job.id);
      expect(later.job.status).toBe("blocked");
      expect(later.job.lastErrorReason).toBe("publication-frozen");
    } finally {
      await freezer.end().catch(() => undefined);
    }
  });

  it("P0 refuses truncated allocation facts instead of synthesizing low-risk", async () => {
    const predecessor = await bootstrapFirstAcme(pool);
    await persistPredecessorArtifact(client, predecessor);
    const truncated = await persistHandBuiltCandidate(client, {
      authorPrincipalId: AUTHOR,
      authorOrganizationId: "org-test",
    });
    expect(truncated.identityAllocation.impactFacts).toBeUndefined();
    const enqueue = await enqueuePublicationJob({
      db,
      candidateId: truncated.id,
      idempotencyKey: "key-p0-truncated",
      trustedActor: userActor(AUTHOR, publisherPermissions),
    });
    expect(enqueue.ok).toBe(false);
    if (enqueue.ok) {
      throw new Error("truncated facts must not enqueue");
    }
    expect(enqueue.error).toMatchObject({ kind: "authorization", reason: "candidate-tampered" });

    const stripped = await persistHandBuiltCandidate(client, {
      token: uniqueToken("strip"),
      authorPrincipalId: AUTHOR,
      authorOrganizationId: "org-test",
      impactFacts: {
        authorPrincipalId: AUTHOR,
        operations: [{ op: "create-definition", supported: true }],
        sourceKind: "typed-changeset",
      },
    });
    const strippedEnqueue = await enqueuePublicationJob({
      db,
      candidateId: stripped.id,
      idempotencyKey: "key-p0-stripped",
      trustedActor: userActor(AUTHOR, publisherPermissions),
    });
    expect(strippedEnqueue.ok).toBe(false);
    if (!strippedEnqueue.ok) {
      expect(strippedEnqueue.error).toMatchObject({ kind: "authorization", reason: "candidate-tampered" });
    }

    await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const capability = await client.query<{ digest: string }>(
      `select catalog_publication.digest_jsonb(capability_contract) as digest
         from catalog_publication.candidates where id = $1`,
      [truncated.id],
    );
    const authorized = await asCoordinator(client, async () =>
      authorizePublish(asQueryable(client), {
        trustedActor: userActor(AUTHOR, publisherPermissions),
        candidate: {
          candidateId: truncated.id,
          artifactDigest: truncated.artifactDigest,
          expectedBaseReleaseId: truncated.expectedBaseReleaseId,
          expectedBaseReleaseDigest: truncated.expectedBaseReleaseDigest,
          proposalRevisionId: truncated.proposalRevisionId,
          impactReportDigest: truncated.impactReportDigest,
          capabilityContractDigest: capability.rows[0]!.digest,
        },
        impactFacts: {
          authorPrincipalId: AUTHOR,
          operations: [{ op: "create-definition", supported: true }],
          introducesNewSubject: false,
          changesSelector: false,
          changesAlias: false,
          changesFallback: false,
          tightensExistingContract: false,
          changesUnitOrSemantic: false,
          retiresIdentity: false,
          unknownImpact: false,
          sourceKind: "typed-changeset",
        },
        policyRevision: PublicationPolicyRevision(
          Number(
            (
              await client.query<{ revision: string }>(
                `select revision::text as revision from catalog_publication.publication_policies where singleton`,
              )
            ).rows[0]!.revision,
          ),
        ),
      }),
    );
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      throw new Error(`authorize truncated candidate: ${JSON.stringify(authorized.error)}`);
    }
    const job = await asCoordinator(client, async () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${uniqueToken("p0")}`),
        candidateId: truncated.id,
        authorizationId: authorized.value.authorization.id,
        requestScope: "instance:p0-truncated",
        idempotencyKey: `key-${uniqueToken("p0j")}`,
        requestDigest: sha256Digest(`req-${uniqueToken("p0d")}`),
      }),
    );
    expect(job.ok).toBe(true);
    if (!job.ok) {
      throw new Error(`create truncated job: ${JSON.stringify(job.error)}`);
    }
    const executed = await claimAndExecute(createCatalogInstaller(pool), "manager-p0-exec");
    expect(executed.kind).toBe("settled");
    if (executed.kind !== "settled") {
      throw new Error("expected tamper settle");
    }
    expect(executed.job.id).toBe(job.value.id);
    expect(executed.job.status).toBe("failed-terminal");
    expect(executed.job.lastErrorReason).toBe("candidate-tampered");
    expect((await domainSnapshot(client)).receiptKinds).not.toContain("online-publication");

    const high = await persistHandBuiltCandidate(client, {
      token: uniqueToken("high"),
      authorPrincipalId: AUTHOR,
      authorOrganizationId: "org-test",
      impactFacts: highFacts(AUTHOR),
    });
    const selfHigh = await enqueuePublicationJob({
      db,
      candidateId: high.id,
      idempotencyKey: "key-p0-high-self",
      trustedActor: userActor(AUTHOR, publisherPermissions),
    });
    expect(selfHigh.ok).toBe(false);
    if (!selfHigh.ok) {
      expect(selfHigh.error).toMatchObject({
        kind: "authorization",
        reason: "publication-self-approval-forbidden",
      });
    }
    const reviewed = await enqueuePublicationJob({
      db,
      candidateId: high.id,
      idempotencyKey: "key-p0-high-reviewer",
      trustedActor: userActor(REVIEWER, reviewerPermissions),
    });
    expect(reviewed.ok).toBe(true);
  });
});
