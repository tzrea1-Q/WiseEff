import { createHash, randomUUID } from "node:crypto";

import {
  CatalogCandidateId,
  PublicationJobId,
  serializeContract,
  type ContractJsonValue,
} from "../parameter-catalog-contract/index";
import type { TrustedInvocationContext } from "../auth/trustedInvocation";
import type { Database } from "../../shared/database/client";
import { authorizePublish } from "./authorization/authorize";
import { getPolicy } from "./persistence/store";
import { classifyImpact } from "./authorization/classify";
import type { ImpactFacts } from "./authorization/types";
import { withPublicationCoordinator } from "./coordinator";
import { PUBLICATION_REQUEST_SCOPE } from "./preview";
import { impactFactsFromAllocation } from "./jobs/execute";
import {
  createJob,
  getCandidate,
  getJobByIdempotency,
  sha256DigestOfBytes,
} from "./persistence/store";
import type { PublicationCandidateRecord, PublicationJobRecord } from "./persistence/types";

export function publicationRequestDigest(candidateId: string, requestScope: string): string {
  return sha256DigestOfBytes(
    serializeContract({
      candidateId,
      requestScope,
    } as unknown as ContractJsonValue),
  );
}

const advisoryKey = (scope: string, key: string): number => {
  const digest = createHash("sha256").update(`${scope}\0${key}`).digest();
  return digest.readInt32BE(0);
};

export type EnqueuePublicationError =
  | { readonly kind: "not-found" }
  | { readonly kind: "idempotency-key-conflict" }
  | { readonly kind: "authorization"; readonly reason: string }
  | { readonly kind: "invalid-input"; readonly reason: string };

export type EnqueuePublicationValue = {
  readonly job: PublicationJobRecord;
  readonly replayed: boolean;
  readonly candidate: PublicationCandidateRecord;
};

export async function enqueuePublicationJob(input: {
  readonly db: Database;
  readonly candidateId: string;
  readonly idempotencyKey: string;
  readonly trustedActor: TrustedInvocationContext;
  readonly requestScope?: string;
}): Promise<{ ok: true; value: EnqueuePublicationValue } | { ok: false; error: EnqueuePublicationError }> {
  const requestScope = input.requestScope ?? PUBLICATION_REQUEST_SCOPE;
  const requestDigest = publicationRequestDigest(input.candidateId, requestScope);

  return withPublicationCoordinator(input.db, async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1, $2)", [
      688007007,
      advisoryKey(requestScope, input.idempotencyKey),
    ]);

    const existing = await getJobByIdempotency(tx, requestScope, input.idempotencyKey);
    if (existing.ok) {
      if (existing.value.requestDigest !== requestDigest) {
        return { ok: false as const, error: { kind: "idempotency-key-conflict" as const } };
      }
      const candidate = await getCandidate(tx, existing.value.candidateId);
      if (!candidate.ok) {
        return { ok: false as const, error: { kind: "not-found" as const } };
      }
      return {
        ok: true as const,
        value: { job: existing.value, replayed: true, candidate: candidate.value },
      };
    }

    let candidateId: ReturnType<typeof CatalogCandidateId>;
    try {
      candidateId = CatalogCandidateId(input.candidateId);
    } catch {
      return { ok: false as const, error: { kind: "not-found" as const } };
    }
    const candidate = await getCandidate(tx, candidateId);
    if (!candidate.ok) {
      return { ok: false as const, error: { kind: "not-found" as const } };
    }
    const facts = impactFactsFromAllocation(candidate.value.identityAllocation);
    if (facts === null) {
      return { ok: false as const, error: { kind: "authorization" as const, reason: "candidate-tampered" } };
    }
    const classified = classifyImpact(facts);
    if (!classified.ok) {
      return { ok: false as const, error: { kind: "authorization" as const, reason: classified.error.reason } };
    }
    const policy = await getPolicy(tx);
    if (!policy.ok) {
      return { ok: false as const, error: { kind: "authorization" as const, reason: "publication-policy-disabled" } };
    }
    const capability = await tx.query<{ digest: string }>(
      `select catalog_publication.digest_jsonb(capability_contract) as digest
         from catalog_publication.candidates
        where id = $1`,
      [candidate.value.id],
    );
    const capabilityDigest = capability.rows[0]?.digest;
    if (!capabilityDigest) {
      return { ok: false as const, error: { kind: "authorization" as const, reason: "candidate-tampered" } };
    }

    const authorized = await authorizePublish(tx, {
      trustedActor: input.trustedActor,
      candidate: {
        candidateId: candidate.value.id,
        artifactDigest: candidate.value.artifactDigest,
        expectedBaseReleaseId: candidate.value.expectedBaseReleaseId,
        expectedBaseReleaseDigest: candidate.value.expectedBaseReleaseDigest,
        proposalRevisionId: candidate.value.proposalRevisionId,
        impactReportDigest: candidate.value.impactReportDigest,
        capabilityContractDigest: capabilityDigest,
      },
      impactFacts: facts as ImpactFacts,
      policyRevision: policy.value.revision,
    });
    if (!authorized.ok) {
      return { ok: false as const, error: { kind: "authorization" as const, reason: authorized.error.reason } };
    }

    const job = await createJob(tx, {
      id: PublicationJobId(`cjob_${randomUUID().replace(/-/g, "").slice(0, 16)}`),
      candidateId: candidate.value.id,
      authorizationId: authorized.value.authorization.id,
      requestScope,
      idempotencyKey: input.idempotencyKey,
      requestDigest,
    });
    if (!job.ok) {
      if (job.error.kind === "conflict" && job.error.reason === "idempotency-key-conflict") {
        return { ok: false as const, error: { kind: "idempotency-key-conflict" as const } };
      }
      return { ok: false as const, error: { kind: "invalid-input" as const, reason: job.error.kind } };
    }
    return {
      ok: true as const,
      value: { job: job.value, replayed: false, candidate: candidate.value },
    };
  });
}
