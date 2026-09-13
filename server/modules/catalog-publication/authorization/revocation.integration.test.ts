import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import {
  CatalogActivationReceiptId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  PublicationJobId,
} from "../../parameter-catalog-contract/index";
import {
  asQueryable,
  openEphemeralClient,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
} from "../persistence/integrationHarness";
import { createJob, insertReceipt } from "../persistence/store";
import {
  authorizePublish,
  revokeAuthorization,
  verifyAuthorizationForActivation,
} from "./authorize";
import {
  AUTHOR,
  PUBLISHER,
  REVIEWER,
  asCoordinator,
  enablePublicationPolicy,
  highFacts,
  lowFacts,
  persistHandBuiltCandidate,
  publisherPermissions,
  reviewerPermissions,
  tupleOf,
  userActor,
} from "./testHarness";
import { CATALOG_PUBLICATION_LOCK_ORDER } from "./types";

await requirePgvectorTestDatabase();

describe("catalog publication revocation and execute-time verify", () => {
  let client: pg.Client;
  let url: string;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openEphemeralClient("cp04rev");
    client = opened.client;
    url = opened.url;
    drop = opened.drop;
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  });

  it("documents catalog exclusive lock then publication_guard for CP-05", () => {
    expect(CATALOG_PUBLICATION_LOCK_ORDER[0]).toContain("acquire_current_pointer_lock_exclusive");
    expect(CATALOG_PUBLICATION_LOCK_ORDER[1]).toContain("acquire_publication_guard_lock");
  });

  it("refuses revoke that points at another candidate's grant and leaves the original approve", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const seeded = await asCoordinator(client, async () => {
      const first = await persistHandBuiltCandidate(client, {
        token: uniqueToken("rvk1"),
        authorPrincipalId: PUBLISHER,
      });
      const second = await persistHandBuiltCandidate(client, {
        token: uniqueToken("rvk2"),
        authorPrincipalId: PUBLISHER,
      });
      const firstAuth = await authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, first),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
      const secondAuth = await authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, second),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
      return { first, second, firstAuth, secondAuth };
    });
    expect(seeded.firstAuth.ok && seeded.secondAuth.ok).toBe(true);
    if (!seeded.firstAuth.ok || !seeded.secondAuth.ok) {
      throw new Error("setup authorize failed");
    }

    const crossed = await asCoordinator(client, async () =>
      revokeAuthorization(asQueryable(client), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidateId: seeded.second.id,
        approvedAuthorizationId: seeded.firstAuth.value.authorization.id,
      }),
    );
    expect(crossed.ok).toBe(false);

    const remaining = await client.query<{ event_kind: string; candidate_id: string }>(
      `select event_kind, candidate_id
       from catalog_publication.publication_authorizations
       where id = $1 or approved_authorization_id = $1
       order by event_kind`,
      [seeded.firstAuth.value.authorization.id],
    );
    expect(remaining.rows).toEqual([
      { event_kind: "approve", candidate_id: seeded.first.id },
    ]);
  });

  it("fails verifyAuthorizationForActivation after a committed revoke", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("seqrv"),
        authorPrincipalId: PUBLISHER,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      throw new Error(JSON.stringify(authorized.error));
    }

    const firstVerify = await asCoordinator(client, async () =>
      verifyAuthorizationForActivation(asQueryable(client), {
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        impactFacts: lowFacts(PUBLISHER),
        lockMode: "publication-guard",
      }),
    );
    expect(firstVerify.ok).toBe(true);
    if (firstVerify.ok) {
      expect(firstVerify.value).not.toHaveProperty("approved");
    }

    const revoked = await asCoordinator(client, async () =>
      revokeAuthorization(asQueryable(client), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidateId: authorized.value.candidate.id,
        approvedAuthorizationId: authorized.value.authorization.id,
        lockMode: "publication-guard",
      }),
    );
    expect(revoked.ok).toBe(true);

    const secondVerify = await asCoordinator(client, async () =>
      verifyAuthorizationForActivation(asQueryable(client), {
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        impactFacts: lowFacts(PUBLISHER),
        lockMode: "publication-guard",
      }),
    );
    expect(secondVerify).toEqual({
      ok: false,
      error: { reason: "publication-authorization-revoked" },
    });
  });

  it("linearizes revoke-then-verify across two sessions: committed revoke wins", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("twosess"),
        authorPrincipalId: PUBLISHER,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      throw new Error(JSON.stringify(authorized.error));
    }

    const sessionA = new pg.Client({ connectionString: url });
    const sessionB = new pg.Client({ connectionString: url });
    await sessionA.connect();
    await sessionB.connect();
    try {
      await sessionA.query("begin");
      await sessionA.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
      const revoked = await revokeAuthorization(asQueryable(sessionA), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidateId: authorized.value.candidate.id,
        approvedAuthorizationId: authorized.value.authorization.id,
        lockMode: "publication-guard",
      });
      expect(revoked.ok).toBe(true);
      await sessionA.query("commit");
      await sessionA.query("reset role");

      await sessionB.query("begin");
      await sessionB.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
      const verified = await verifyAuthorizationForActivation(asQueryable(sessionB), {
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        impactFacts: lowFacts(PUBLISHER),
        lockMode: "publication-guard",
      });
      expect(verified.ok).toBe(false);
      if (!verified.ok) {
        expect(verified.error.reason).toBe("publication-authorization-revoked");
      }
      await sessionB.query("rollback");
    } finally {
      await sessionA.end().catch(() => undefined);
      await sessionB.end().catch(() => undefined);
    }
  });

  it("does not delete an existing receipt when a later revoke is appended", async () => {
    const token = uniqueToken("rcpt");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: false,
    });
    const releaseId = CatalogReleaseId(`crel_target_${token}`);
    const releaseDigest = CatalogReleaseDigest(sha256Digest(`target-${token}`));
    const baseId = CatalogReleaseId(`crel_base_${token}`);
    const baseDigest = CatalogReleaseDigest(sha256Digest(`base-${token}`));
    const seq = 90400 + (process.pid % 200);
    await client.query(
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values ($1, $2, $3, $4, $5, $6, '2026-09-12T00:00:00Z'),
                ($7, $8, $9, $10, $11, $12, '2026-09-12T00:00:00Z')`,
      [
        baseId,
        seq,
        `${baseId}-v`,
        baseDigest,
        sha256Digest(`${token}-base-model`),
        sha256Digest(`${token}-base-tool`),
        releaseId,
        seq + 1,
        `${releaseId}-v`,
        releaseDigest,
        sha256Digest(`${token}-model`),
        sha256Digest(`${token}-tool`),
      ],
    );

    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token,
        authorPrincipalId: AUTHOR,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: highFacts(AUTHOR),
        policyRevision,
      });
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      throw new Error(JSON.stringify(authorized.error));
    }

    const job = await asCoordinator(client, async () =>
      createJob(asQueryable(client), {
        id: PublicationJobId(`cjob_${token}`),
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        requestScope: "instance:cp-04",
        idempotencyKey: `key-${token}`,
        requestDigest: sha256Digest(`req-${token}`),
      }),
    );
    expect(job.ok).toBe(true);
    if (!job.ok) {
      throw new Error(JSON.stringify(job.error));
    }

    await client.query("begin");
    await client.query(`set local role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
    const receipt = await insertReceipt(asQueryable(client), {
      id: CatalogActivationReceiptId(`crct_${token}`),
      kind: "online-publication",
      releaseId,
      releaseDigest,
      predecessorReleaseId: baseId,
      predecessorReleaseDigest: baseDigest,
      verificationDigest: sha256Digest(`verify-${token}`),
      publicationJobId: job.value.id,
      authorizationId: authorized.value.authorization.id,
      candidateId: authorized.value.candidate.id,
      actorPrincipalId: REVIEWER,
      adoptionEvidence: null,
    });
    await client.query("commit");
    await client.query("reset role");
    expect(receipt.ok).toBe(true);

    const revoked = await asCoordinator(client, async () =>
      revokeAuthorization(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidateId: authorized.value.candidate.id,
        approvedAuthorizationId: authorized.value.authorization.id,
      }),
    );
    expect(revoked.ok).toBe(true);

    const stillThere = await client.query(
      `select id from parameter_catalog.catalog_activation_receipts where id = $1`,
      [`crct_${token}`],
    );
    expect(stillThere.rowCount).toBe(1);
  });

  it("fails execute-time verify after policy revision or publication disable", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("polchg"),
        authorPrincipalId: PUBLISHER,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      throw new Error(JSON.stringify(authorized.error));
    }

    await enablePublicationPolicy(client, {
      publicationEnabled: false,
      lowRiskSingleActorPublish: false,
    });

    const verified = await asCoordinator(client, async () =>
      verifyAuthorizationForActivation(asQueryable(client), {
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        impactFacts: lowFacts(PUBLISHER),
      }),
    );
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(["publication-policy-disabled", "candidate-stale"]).toContain(verified.error.reason);
    }
  });
});
