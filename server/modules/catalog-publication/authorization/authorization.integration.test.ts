import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import {
  asQueryable,
  captureRoleStatementError,
  openEphemeralClient,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
} from "../persistence/integrationHarness";
import { getPolicy } from "../persistence/store";
import { authorizePublish, verifyAuthorizationForActivation } from "./authorize";
import { revisePublicationPolicy } from "./policy";
import {
  AUTHOR,
  ORG_ADMIN,
  PUBLISHER,
  REVIEWER,
  agentActor,
  asCoordinator,
  authContext,
  enablePublicationPolicy,
  highFacts,
  lowFacts,
  persistHandBuiltCandidate,
  publisherPermissions,
  reviewerPermissions,
  systemActor,
  tupleOf,
  userActor,
} from "./testHarness";
import { EPHEMERAL_POLICY_REVISION_CONFIRMATION } from "./types";

await requirePgvectorTestDatabase();

describe("catalog publication authorization", () => {
  let client: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openEphemeralClient("cp04ath");
    client = opened.client;
    drop = opened.drop;
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  });

  it("seeds publication disabled and does not grant coordinator EXECUTE on policy revision", async () => {
    const policy = await asCoordinator(client, async () => getPolicy(asQueryable(client)));
    expect(policy.ok).toBe(true);
    if (policy.ok) {
      expect(policy.value.publicationEnabled).toBe(false);
      expect(policy.value.lowRiskSingleActorPublish).toBe(false);
    }

    const denied = await captureRoleStatementError(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      `select catalog_publication.revise_publication_policy(true, true, 'catalog-capability/v1', 'coord')`,
    );
    expect(denied.code).toBe("42501");
  });

  it("org-admin without catalog:publish cannot authorize even if the body claims approval", async () => {
    const token = uniqueToken("orgadm");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const result = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, { token });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(ORG_ADMIN, ["admin:access", "users:manage", "parameter:view"], {
          roleId: "admin",
        }),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(AUTHOR),
        policyRevision,
        untrustedRequest: {
          role: "platform-admin",
          organization: "org-forged",
          riskClass: "low",
          approved: true,
        },
      });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("publication-capability-missing");
    }
    const auths = await client.query(
      `select id from catalog_publication.publication_authorizations where candidate_id = $1`,
      [`ccand_${token}`],
    );
    expect(auths.rowCount).toBe(0);
  });

  it("Agent cannot authorize even with catalog:publish injected on the principal", async () => {
    const token = uniqueToken("agent");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const result = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, { token, authorPrincipalId: AUTHOR });
      return authorizePublish(asQueryable(client), {
        trustedActor: agentActor(["catalog:publish", "catalog:review-high-risk", "parameter:view"]),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(AUTHOR),
        policyRevision,
        untrustedRequest: { approved: true, riskClass: "low" },
      });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("publication-not-authorized");
    }
  });

  it("allows low-risk self-approve only with explicit policy and a real catalog:publish principal", async () => {
    const token = uniqueToken("lowok");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token,
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
    expect(authorized.value.riskClass).toBe("low");
    expect(authorized.value.authorization.eventKind).toBe("approve");
    expect(authorized.value.authorization.actorPrincipalId).toBe(PUBLISHER);
    expect(authorized.value).not.toHaveProperty("approved");
  });

  it("refuses low-risk self-approve when the single-actor policy is off", async () => {
    const token = uniqueToken("lowoff");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: false,
    });
    const result = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token,
        authorPrincipalId: PUBLISHER,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
    });
    expect(result).toEqual({
      ok: false,
      error: { reason: "publication-self-approval-forbidden" },
    });
  });

  it("refuses authorization when publication_enabled is false", async () => {
    const token = uniqueToken("poldis");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: false,
      lowRiskSingleActorPublish: false,
    });
    const result = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, { token, authorPrincipalId: PUBLISHER });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("publication-policy-disabled");
    }
  });

  it("refuses high-risk self-approve and worker reviewers", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });

    const selfHigh = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("highsf"),
        authorPrincipalId: REVIEWER,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: highFacts(REVIEWER),
        policyRevision,
      });
    });
    expect(selfHigh).toEqual({
      ok: false,
      error: { reason: "publication-self-approval-forbidden" },
    });

    const worker = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("highwk"),
        authorPrincipalId: AUTHOR,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: systemActor(),
        candidate: await tupleOf(client, candidate),
        impactFacts: highFacts(AUTHOR),
        policyRevision,
      });
    });
    expect(worker.ok).toBe(false);
    if (!worker.ok) {
      expect(worker.error.reason).toBe("publication-not-authorized");
    }
  });

  it("allows a different real catalog:review-high-risk principal to approve high-risk", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: false,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("highok"),
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
    if (authorized.ok) {
      expect(authorized.value.riskClass).toBe("high");
      expect(authorized.value.authorization.actorPrincipalId).toBe(REVIEWER);
    }
  });

  it("binds the stored candidate author, not caller impactFacts.authorPrincipalId", async () => {
    const token = uniqueToken("authspoof");
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: false,
    });
    const result = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token,
        authorPrincipalId: REVIEWER,
      });
      return authorizePublish(asQueryable(client), {
        trustedActor: userActor(REVIEWER, reviewerPermissions),
        candidate: await tupleOf(client, candidate),
        impactFacts: highFacts(AUTHOR),
        policyRevision,
      });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("candidate-tampered");
    }
    const auths = await client.query(
      `select id from catalog_publication.publication_authorizations where candidate_id = $1`,
      [`ccand_${token}`],
    );
    expect(auths.rowCount).toBe(0);
  });

  it("refuses a stale tuple after candidate impact digest changes and does not copy the old approval", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const firstToken = uniqueToken("old1");
    const secondToken = uniqueToken("new2");
    const authorized = await asCoordinator(client, async () => {
      const first = await persistHandBuiltCandidate(client, {
        token: firstToken,
        authorPrincipalId: PUBLISHER,
      });
      const approval = await authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: await tupleOf(client, first),
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
      const second = await persistHandBuiltCandidate(client, {
        token: secondToken,
        authorPrincipalId: PUBLISHER,
        impactReportDigest: sha256Digest(`impact-changed-${secondToken}`),
      });
      const reused = await authorizePublish(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        candidate: {
          ...(await tupleOf(client, second)),
          impactReportDigest: first.impactReportDigest,
        },
        impactFacts: lowFacts(PUBLISHER),
        policyRevision,
      });
      return { approval, reused, first, second };
    });
    expect(authorized.approval.ok).toBe(true);
    expect(authorized.reused.ok).toBe(false);
    if (!authorized.reused.ok) {
      expect(authorized.reused.error.reason).toBe("candidate-tampered");
    }
    const copied = await client.query(
      `select id from catalog_publication.publication_authorizations where candidate_id = $1`,
      [authorized.second.id],
    );
    expect(copied.rowCount).toBe(0);
  });

  it("refuses verify after the approver snapshot loses catalog:publish", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("lostcap"),
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
    const verified = await asCoordinator(client, async () =>
      verifyAuthorizationForActivation(asQueryable(client), {
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        trustedActor: userActor(PUBLISHER, ["parameter:view"]),
        impactFacts: lowFacts(PUBLISHER),
      }),
    );
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.error.reason).toBe("publication-capability-missing");
    }
  });

  it("treats omitted execute-time impactFacts as high risk instead of inferring low from self-approve", async () => {
    const policyRevision = await enablePublicationPolicy(client, {
      publicationEnabled: true,
      lowRiskSingleActorPublish: true,
    });
    const authorized = await asCoordinator(client, async () => {
      const candidate = await persistHandBuiltCandidate(client, {
        token: uniqueToken("nofacts"),
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
    const verified = await asCoordinator(client, async () =>
      verifyAuthorizationForActivation(asQueryable(client), {
        candidateId: authorized.value.candidate.id,
        authorizationId: authorized.value.authorization.id,
        trustedActor: userActor(PUBLISHER, publisherPermissions),
      }),
    );
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.error.reason).toBe("publication-self-approval-forbidden");
    }
  });

  it("management wrapper records the trusted actor and refuses a missing ephemeral confirmation", async () => {
    await client.query("begin");
    await client.query(
      `set local role ${quoteIdent("catalog_migration_owner")}`,
    );
    try {
      const refused = await revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: true,
        capabilityContractRevision: "catalog-capability/v1",
        isolatedInstanceConfirmation: "ephemeral-test-only",
      });
      expect(refused.ok).toBe(true);
      if (refused.ok) {
        expect(refused.value.updatedByPrincipalId).toBe(PUBLISHER);
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }

    const missing = await asCoordinator(client, async () =>
      revisePublicationPolicy(asQueryable(client), {
        trustedActor: userActor(PUBLISHER, publisherPermissions),
        publicationEnabled: true,
        lowRiskSingleActorPublish: true,
        capabilityContractRevision: "catalog-capability/v1",
        isolatedInstanceConfirmation: EPHEMERAL_POLICY_REVISION_CONFIRMATION,
      }),
    );
    expect(missing.ok).toBe(false);
  });

  it("does not invent { approved: true } from an untrusted request body", () => {
    const principal = authContext({
      userId: PUBLISHER,
      permissions: publisherPermissions,
    });
    expect(principal).not.toHaveProperty("approved");
    expect(userActor(PUBLISHER, publisherPermissions)).not.toMatchObject({ approved: true });
  });
});
