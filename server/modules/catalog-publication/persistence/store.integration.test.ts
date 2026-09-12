import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CATALOG_PUBLICATION_COORDINATOR_ROLE,
  CATALOG_SYNCHRONIZER_ROLE,
  PARAMETER_GOVERNANCE_WRITER_ROLE,
  quoteIdent,
} from "../../catalog-kernel/security/catalogRoleManifest";
import {
  CatalogActivationReceiptId,
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  PublicationAuthorizationId,
  PublicationJobId,
  PublicationPolicyRevision,
} from "../../parameter-catalog-contract/index";
import {
  adoptionEvidence,
  asQueryable,
  bootstrapEvidence,
  openEphemeralClient,
  requirePgvectorTestDatabase,
  sha256Digest,
  uniqueToken,
  withLocalRole,
} from "./integrationHarness";
import {
  appendAuthorization,
  createJob,
  getArtifactByDigest,
  getCandidate,
  getJob,
  getPolicy,
  getReceiptByJobId,
  insertReceipt,
  persistArtifact,
  persistCandidate,
  sha256DigestOfBytes,
  updateJobExecution,
} from "./store";

await requirePgvectorTestDatabase();

describe("catalog publication store seam", () => {
  let client: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openEphemeralClient("cp02str");
    client = opened.client;
    drop = opened.drop;
  }, 120_000);

  afterAll(async () => {
    await drop?.();
  });

  const coordinatorDb = () => asQueryable(client);

  async function seedChain(token: string) {
    const bytes = new Uint8Array(Buffer.from(`bytes-${token}`));
    const aggregate = sha256Digest(`aggregate-${token}`);
    await client.query("begin");
    await client.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
    const artifact = await persistArtifact(coordinatorDb(), {
      id: CatalogArtifactId(`cart_${token}`),
      artifactDigest: aggregate,
      artifactBytes: bytes,
      sourceKind: "typed-changeset",
      targetReleaseId: CatalogReleaseId(`crel_target_${token}`),
      targetReleaseDigest: CatalogReleaseDigest(sha256Digest(`target-${token}`)),
      predecessorReleaseId: CatalogReleaseId(`crel_pred_${token}`),
      predecessorReleaseDigest: CatalogReleaseDigest(sha256Digest(`pred-${token}`)),
      toolchain: { compiler: "cp-02-test" },
    });
    expect(artifact.ok).toBe(true);
    if (!artifact.ok) {
      throw new Error("persistArtifact failed");
    }
    const candidate = await persistCandidate(coordinatorDb(), {
      id: CatalogCandidateId(`ccand_${token}`),
      artifactId: artifact.value.id,
      expectedBaseReleaseId: CatalogReleaseId(`crel_base_${token}`),
      expectedBaseReleaseDigest: CatalogReleaseDigest(sha256Digest(`base-${token}`)),
      proposalId: null,
      proposalRevisionId: null,
      identityAllocation: { frozen: true },
      impactReportDigest: sha256Digest(`impact-${token}`),
      capabilityContract: { revision: "catalog-capability/v1" },
    });
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) {
      throw new Error("persistCandidate failed");
    }
    const digest = await coordinatorDb().query<{ digest: string }>(
      `select catalog_publication.digest_jsonb(capability_contract) as digest
       from catalog_publication.candidates
       where id = $1`,
      [candidate.value.id],
    );
    const authorization = await appendAuthorization(coordinatorDb(), {
      id: PublicationAuthorizationId(`cauth_${token}`),
      eventKind: "approve",
      candidateId: candidate.value.id,
      artifactDigest: artifact.value.artifactDigest,
      expectedBaseReleaseId: candidate.value.expectedBaseReleaseId,
      expectedBaseReleaseDigest: candidate.value.expectedBaseReleaseDigest,
      proposalRevisionId: null,
      impactReportDigest: candidate.value.impactReportDigest,
      capabilityContractDigest: digest.rows[0]?.digest ?? "",
      policyRevision: PublicationPolicyRevision(1),
      actorPrincipalId: "user-approver",
      approvedAuthorizationId: null,
    });
    expect(authorization.ok).toBe(true);
    if (!authorization.ok) {
      throw new Error("appendAuthorization failed");
    }
    return { artifact: artifact.value, candidate: candidate.value, authorization: authorization.value };
  }

  it("persistArtifact is idempotent for identical digest+bytes and conflicts on digest reuse", async () => {
    const token = uniqueToken("art");
    const bytes = new Uint8Array(Buffer.from(`same-${token}`));
    const aggregate = sha256Digest(`agg-${token}`);
    expect(aggregate).not.toBe(sha256DigestOfBytes(bytes));

    await client.query("begin");
    await client.query(`set local role ${quoteIdent(CATALOG_PUBLICATION_COORDINATOR_ROLE)}`);
    try {
      const first = await persistArtifact(coordinatorDb(), {
        id: CatalogArtifactId(`cart_${token}a`),
        artifactDigest: aggregate,
        artifactBytes: bytes,
        sourceKind: "vendor-yaml",
        targetReleaseId: CatalogReleaseId("crel_missing_target"),
        targetReleaseDigest: CatalogReleaseDigest(sha256Digest("missing-target")),
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        toolchain: {},
      });
      expect(first.ok).toBe(true);
      if (!first.ok) {
        throw new Error("first persistArtifact failed");
      }
      expect(first.value.bytesChecksum).toBe(sha256DigestOfBytes(bytes));
      expect(first.value.artifactDigest).toBe(aggregate);

      const same = await persistArtifact(coordinatorDb(), {
        id: CatalogArtifactId(`cart_${token}b`),
        artifactDigest: aggregate,
        artifactBytes: bytes,
        sourceKind: "vendor-yaml",
        targetReleaseId: CatalogReleaseId("crel_missing_target"),
        targetReleaseDigest: CatalogReleaseDigest(sha256Digest("missing-target")),
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        toolchain: {},
      });
      expect(same).toEqual(first);

      const conflict = await persistArtifact(coordinatorDb(), {
        id: CatalogArtifactId(`cart_${token}c`),
        artifactDigest: aggregate,
        artifactBytes: new Uint8Array(Buffer.from(`other-${token}`)),
        sourceKind: "vendor-yaml",
        targetReleaseId: CatalogReleaseId("crel_missing_target"),
        targetReleaseDigest: CatalogReleaseDigest(sha256Digest("missing-target")),
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        toolchain: {},
      });
      expect(conflict).toEqual({
        ok: false,
        error: { kind: "conflict", reason: "artifact-digest-bytes-mismatch" },
      });

      const loaded = await getArtifactByDigest(coordinatorDb(), aggregate);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.id).toBe(first.value.id);
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }
  });

  it("createJob returns the existing row for the same scope/key/digest and conflicts on digest mismatch", async () => {
    const token = uniqueToken("job");
    try {
      const chain = await seedChain(token);
      const requestDigest = sha256Digest(`req-${token}`);
      const created = await createJob(coordinatorDb(), {
        id: PublicationJobId(`cjob_${token}a`),
        candidateId: chain.candidate.id,
        authorizationId: chain.authorization.id,
        requestScope: "instance:cp-02",
        idempotencyKey: `key-${token}`,
        requestDigest,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) {
        throw new Error("createJob failed");
      }

      const same = await createJob(coordinatorDb(), {
        id: PublicationJobId(`cjob_${token}b`),
        candidateId: chain.candidate.id,
        authorizationId: chain.authorization.id,
        requestScope: "instance:cp-02",
        idempotencyKey: `key-${token}`,
        requestDigest,
      });
      expect(same.ok).toBe(true);
      if (same.ok) {
        expect(same.value.id).toBe(created.value.id);
      }

      const conflict = await createJob(coordinatorDb(), {
        id: PublicationJobId(`cjob_${token}c`),
        candidateId: chain.candidate.id,
        authorizationId: chain.authorization.id,
        requestScope: "instance:cp-02",
        idempotencyKey: `key-${token}`,
        requestDigest: sha256Digest(`other-${token}`),
      });
      expect(conflict).toEqual({
        ok: false,
        error: { kind: "conflict", reason: "idempotency-key-conflict" },
      });

      const execution = await updateJobExecution(coordinatorDb(), created.value.id, {
        status: "running",
        leaseOwner: "worker-1",
        fencingToken: 3,
        expectedFencingToken: 0,
      });
      expect(execution.ok).toBe(true);
      if (execution.ok) {
        expect(execution.value.status).toBe("running");
        expect(execution.value.fencingToken).toBe(3);
        expect(execution.value.candidateId).toBe(created.value.candidateId);
      }

      await client.query("savepoint decrease_fence");
      const decreased = await updateJobExecution(coordinatorDb(), created.value.id, {
        fencingToken: 1,
        expectedFencingToken: 3,
      });
      expect(decreased.ok).toBe(false);
      if (!decreased.ok) {
        expect(decreased.error.kind).toBe("constraint-violation");
      }
      await client.query("rollback to savepoint decrease_fence");

      const stale = await updateJobExecution(coordinatorDb(), created.value.id, {
        fencingToken: 4,
        expectedFencingToken: 2,
      });
      expect(stale).toEqual({
        ok: false,
        error: { kind: "conflict", reason: "fencing-token-mismatch" },
      });

      const loaded = await getJob(coordinatorDb(), created.value.id);
      expect(loaded.ok).toBe(true);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }
  });

  it("getPolicy returns default-disabled flags and insertReceipt enforces kind branches as synchronizer", async () => {
    const token = uniqueToken("rcpt");
    const releaseId = CatalogReleaseId(`crel_${token}`);
    const releaseDigest = CatalogReleaseDigest(sha256Digest(`rel-${token}`));
    await client.query(
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values ($1, $2, $3, $4, $5, $6, '2026-09-12T00:00:00Z')`,
      [
        releaseId,
        89500 + (process.pid % 400),
        `${releaseId}-v`,
        releaseDigest,
        sha256Digest(`${token}-model`),
        sha256Digest(`${token}-tool`),
      ],
    );

    const policy = await withLocalRole(client, CATALOG_PUBLICATION_COORDINATOR_ROLE, async () =>
      getPolicy(coordinatorDb()),
    );
    expect(policy.ok).toBe(true);
    if (policy.ok) {
      expect(policy.value.publicationEnabled).toBe(false);
      expect(policy.value.lowRiskSingleActorPublish).toBe(false);
    }

    const coordinatorReceipt = await withLocalRole(
      client,
      CATALOG_PUBLICATION_COORDINATOR_ROLE,
      async () =>
        insertReceipt(coordinatorDb(), {
          id: CatalogActivationReceiptId(`crct_${token}c`),
          kind: "adopted-preexisting",
          releaseId,
          releaseDigest,
          predecessorReleaseId: null,
          predecessorReleaseDigest: null,
          verificationDigest: sha256Digest(`verify-${token}`),
          publicationJobId: null,
          authorizationId: null,
          candidateId: null,
          actorPrincipalId: "coord",
          adoptionEvidence: adoptionEvidence(),
        }),
    );
    expect(coordinatorReceipt.ok).toBe(false);
    if (!coordinatorReceipt.ok) {
      expect(coordinatorReceipt.error.kind).toBe("permission-denied");
    }

    await client.query("begin");
    await client.query(`set local role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
    try {
      const adoption = await insertReceipt(coordinatorDb(), {
        id: CatalogActivationReceiptId(`crct_${token}a`),
        kind: "adopted-preexisting",
        releaseId,
        releaseDigest,
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        verificationDigest: sha256Digest(`verify-${token}`),
        publicationJobId: null,
        authorizationId: null,
        candidateId: null,
        actorPrincipalId: "operator",
        adoptionEvidence: adoptionEvidence(),
      });
      expect(adoption.ok).toBe(true);

      await client.query("savepoint empty_adoption");
      const emptyAdoption = await insertReceipt(coordinatorDb(), {
        id: CatalogActivationReceiptId(`crct_${token}e`),
        kind: "adopted-preexisting",
        releaseId,
        releaseDigest,
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        verificationDigest: sha256Digest(`verify-empty-${token}`),
        publicationJobId: null,
        authorizationId: null,
        candidateId: null,
        actorPrincipalId: "operator",
        adoptionEvidence: {},
      });
      expect(emptyAdoption.ok).toBe(false);
      await client.query("rollback to savepoint empty_adoption");

      const forgedJob = await insertReceipt(coordinatorDb(), {
        id: CatalogActivationReceiptId(`crct_${token}b`),
        kind: "bootstrap",
        releaseId,
        releaseDigest,
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        verificationDigest: sha256Digest(`verify-boot-${token}`),
        publicationJobId: PublicationJobId(`cjob_${token}`),
        authorizationId: null,
        candidateId: null,
        actorPrincipalId: "operator",
        adoptionEvidence: bootstrapEvidence(),
      });
      expect(forgedJob.ok).toBe(false);
      if (!forgedJob.ok) {
        expect(forgedJob.error.kind).toBe("constraint-violation");
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }
  });

  it("online receipt requires matching job/auth and getReceiptByJobId reads it", async () => {
    const token = uniqueToken("onl");
    const releaseId = CatalogReleaseId(`crel_target_${token}`);
    const releaseDigest = CatalogReleaseDigest(sha256Digest(`target-${token}`));
    const baseId = CatalogReleaseId(`crel_base_${token}`);
    const baseDigest = CatalogReleaseDigest(sha256Digest(`base-${token}`));
    const seq = 89600 + (process.pid % 300);
    await client.query(
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values ($1, $2, $3, $4, $5, $6, '2026-09-12T00:00:00Z')`,
      [
        baseId,
        seq,
        `${baseId}-v`,
        baseDigest,
        sha256Digest(`${token}-base-model`),
        sha256Digest(`${token}-base-tool`),
      ],
    );
    await client.query(
      `insert into parameter_catalog.catalog_releases (
         id, release_sequence, release_version, release_digest,
         compiled_model_digest, toolchain_digest, published_at
       ) values ($1, $2, $3, $4, $5, $6, '2026-09-12T00:00:00Z')`,
      [
        releaseId,
        seq + 1,
        `${releaseId}-v`,
        releaseDigest,
        sha256Digest(`${token}-model`),
        sha256Digest(`${token}-tool`),
      ],
    );

    try {
      const chain = await seedChain(token);
      const job = await createJob(coordinatorDb(), {
        id: PublicationJobId(`cjob_${token}`),
        candidateId: chain.candidate.id,
        authorizationId: chain.authorization.id,
        requestScope: "instance:cp-02",
        idempotencyKey: `online-${token}`,
        requestDigest: sha256Digest(`online-${token}`),
      });
      expect(job.ok).toBe(true);
      if (!job.ok) {
        throw new Error("createJob failed");
      }
      await client.query("commit");
      await client.query("reset role").catch(() => undefined);

      await client.query("begin");
      await client.query(`set local role ${quoteIdent(CATALOG_SYNCHRONIZER_ROLE)}`);
      await client.query("savepoint missing_online");
      const missing = await insertReceipt(coordinatorDb(), {
        id: CatalogActivationReceiptId(`crct_${token}m`),
        kind: "online-publication",
        releaseId,
        releaseDigest,
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        verificationDigest: sha256Digest(`verify-${token}`),
        publicationJobId: null,
        authorizationId: null,
        candidateId: null,
        actorPrincipalId: "sync",
        adoptionEvidence: null,
      });
      expect(missing.ok).toBe(false);
      await client.query("rollback to savepoint missing_online");

      await client.query("savepoint wrong_pin");
      const wrongPin = await insertReceipt(coordinatorDb(), {
        id: CatalogActivationReceiptId(`crct_${token}w`),
        kind: "online-publication",
        releaseId: baseId,
        releaseDigest: baseDigest,
        predecessorReleaseId: baseId,
        predecessorReleaseDigest: baseDigest,
        verificationDigest: sha256Digest(`verify-wrong-${token}`),
        publicationJobId: job.value.id,
        authorizationId: chain.authorization.id,
        candidateId: chain.candidate.id,
        actorPrincipalId: "sync",
        adoptionEvidence: null,
      });
      expect(wrongPin.ok).toBe(false);
      await client.query("rollback to savepoint wrong_pin");

      const online = await insertReceipt(coordinatorDb(), {
        id: CatalogActivationReceiptId(`crct_${token}`),
        kind: "online-publication",
        releaseId,
        releaseDigest,
        predecessorReleaseId: baseId,
        predecessorReleaseDigest: baseDigest,
        verificationDigest: sha256Digest(`verify-${token}`),
        publicationJobId: job.value.id,
        authorizationId: chain.authorization.id,
        candidateId: chain.candidate.id,
        actorPrincipalId: "sync",
        adoptionEvidence: null,
      });
      expect(online.ok).toBe(true);
      await client.query("commit");
      await client.query("reset role").catch(() => undefined);

      const loaded = await withLocalRole(client, CATALOG_PUBLICATION_COORDINATOR_ROLE, async () =>
        getReceiptByJobId(coordinatorDb(), job.value.id),
      );
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(loaded.value.kind).toBe("online-publication");
        expect(loaded.value.candidateId).toBe(chain.candidate.id);
      }

      const candidate = await withLocalRole(client, CATALOG_PUBLICATION_COORDINATOR_ROLE, async () =>
        getCandidate(coordinatorDb(), chain.candidate.id),
      );
      expect(candidate.ok).toBe(true);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }
  });

  it("appendAuthorization rejects a tuple that does not match the candidate", async () => {
    const token = uniqueToken("authstore");
    try {
      const chain = await seedChain(token);
      const mismatch = await appendAuthorization(coordinatorDb(), {
        id: PublicationAuthorizationId(`cauth_${token}x`),
        eventKind: "approve",
        candidateId: chain.candidate.id,
        artifactDigest: sha256Digest("other-digest"),
        expectedBaseReleaseId: chain.candidate.expectedBaseReleaseId,
        expectedBaseReleaseDigest: chain.candidate.expectedBaseReleaseDigest,
        proposalRevisionId: null,
        impactReportDigest: chain.candidate.impactReportDigest,
        capabilityContractDigest: chain.authorization.capabilityContractDigest,
        policyRevision: PublicationPolicyRevision(1),
        actorPrincipalId: "user-approver",
        approvedAuthorizationId: null,
      });
      expect(mismatch.ok).toBe(false);
      if (!mismatch.ok) {
        expect(mismatch.error.kind).toBe("invalid-input");
      }
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query("reset role").catch(() => undefined);
    }
  });

  it("governance writer cannot persist artifacts through the store", async () => {
    const denied = await withLocalRole(client, PARAMETER_GOVERNANCE_WRITER_ROLE, async () =>
      persistArtifact(coordinatorDb(), {
        id: CatalogArtifactId("cart_writer_denied"),
        artifactDigest: sha256Digest("writer"),
        artifactBytes: new Uint8Array(Buffer.from("writer")),
        sourceKind: "typed-changeset",
        targetReleaseId: CatalogReleaseId("crel_writer"),
        targetReleaseDigest: CatalogReleaseDigest(sha256Digest("writer-target")),
        predecessorReleaseId: null,
        predecessorReleaseDigest: null,
        toolchain: {},
      }),
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.kind).toBe("permission-denied");
    }
  });
});
