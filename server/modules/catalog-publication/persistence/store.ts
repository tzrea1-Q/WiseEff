/**
 * Catalog publication persistence seam (CP-02).
 *
 * Ordinary web/API maps to a LOGIN with no catalog or publication write grants
 * (this repository has no application_role). Coordinator DML uses
 * catalog_publication_coordinator_role. Receipt INSERT uses
 * catalog_synchronizer_role. Tests SET ROLE (or a NOINHERIT LOGIN granted only
 * that role) rather than asserting isolation as the table owner.
 *
 * artifact_digest is the compiler aggregate digest. bytes_checksum is SHA-256
 * of artifact_bytes only; the two are stored independently.
 *
 * Predecessor pins on artifacts have no FK to catalog_releases so an Artifact
 * may pin a predecessor before that release row exists.
 *
 * revise_publication_policy stays SECURITY DEFINER for CP-04/12 but EXECUTE is
 * not granted to the coordinator (or any production LOGIN) in this migration.
 *
 * Lock protocol for CP-04/05:
 * - Catalog exclusive lock: parameter_catalog.acquire_current_pointer_lock_exclusive()
 * - Publication linearization: catalog_publication.publication_guard
 *   (SELECT FOR UPDATE or acquire_publication_guard_lock()). Do not GRANT UPDATE
 *   on insert-only authorization/artifact/candidate tables just to lock them.
 * - Job claim: UPDATE publication_jobs execution columns only.
 * - Synchronizer cannot UPDATE job status; CP-05 must keep job execution writes
 *   on the coordinator role (or a later owner-function).
 */

import { createHash } from "node:crypto";
import pg from "pg";

import {
  CatalogActivationReceiptId,
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  PublicationAuthorizationId,
  PublicationJobId,
  PublicationPolicyRevision,
} from "../../parameter-catalog-contract/index";
import type { Queryable } from "../../../shared/database/client";
import type {
  ActivationReceiptKind,
  AppendAuthorizationInput,
  ArtifactSourceKind,
  CatalogActivationReceiptRecord,
  CatalogPublicationStoreError,
  CatalogPublicationStoreResult,
  CreatePublicationJobInput,
  InsertActivationReceiptInput,
  JobExecutionPatch,
  JsonObject,
  PersistArtifactInput,
  PersistCandidateInput,
  PublicationAuthorizationEventKind,
  PublicationAuthorizationRecord,
  PublicationCandidateRecord,
  PublicationJobRecord,
  PublicationJobStatus,
  PublicationPolicyRecord,
  ReleaseArtifactRecord,
} from "./types";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

const SOURCE_KINDS = new Set<ArtifactSourceKind>([
  "typed-changeset",
  "vendor-yaml",
  "repository-bundle",
  "adopted-preexisting",
]);

const JOB_STATUSES = new Set<PublicationJobStatus>([
  "queued",
  "running",
  "active",
  "needs-rebase",
  "blocked",
  "failed-retryable",
  "failed-terminal",
  "cancelled",
]);

const ok = <T>(value: T): CatalogPublicationStoreResult<T> => ({ ok: true, value });

const fail = <T>(error: CatalogPublicationStoreError): CatalogPublicationStoreResult<T> => ({
  ok: false,
  error,
});

const isDatabaseError = (error: unknown): error is pg.DatabaseError =>
  error instanceof pg.DatabaseError;

const mapWriteError = (error: unknown): CatalogPublicationStoreError => {
  if (isDatabaseError(error)) {
    if (error.code === "42501") {
      return { kind: "permission-denied", sqlstate: error.code, message: error.message };
    }
    if (error.code === "23505") {
      if ((error.constraint ?? "").includes("request_scope") || error.message.includes("idempotency")) {
        return { kind: "conflict", reason: "idempotency-key-conflict" };
      }
      if ((error.constraint ?? "").includes("artifact_digest") || error.message.includes("artifact_digest")) {
        return { kind: "conflict", reason: "artifact-digest-bytes-mismatch" };
      }
      return { kind: "constraint-violation", sqlstate: error.code, message: error.message };
    }
    if (error.code === "23503" || error.code === "23514" || error.code === "55000") {
      return {
        kind: "constraint-violation",
        sqlstate: error.code,
        message: error.message,
      };
    }
    return {
      kind: "constraint-violation",
      sqlstate: error.code ?? "unknown",
      message: error.message,
    };
  }
  throw error;
};

export const sha256DigestOfBytes = (bytes: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : value;

const asJsonObject = (value: unknown): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("expected jsonb object");
  }
  return value as JsonObject;
};

const requireSha256 = (value: string, label: string): CatalogPublicationStoreError | null => {
  if (!SHA256_DIGEST.test(value)) {
    return { kind: "invalid-input", reason: `${label} must be sha256:<64 lowercase hex>` };
  }
  return null;
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
};

type ArtifactRow = {
  id: string;
  artifact_digest: string;
  bytes_checksum: string;
  artifact_bytes: Buffer;
  source_kind: ArtifactSourceKind;
  target_release_id: string;
  target_release_digest: string;
  predecessor_release_id: string | null;
  predecessor_release_digest: string | null;
  toolchain: unknown;
  created_at: Date | string;
};

const toArtifact = (row: ArtifactRow): ReleaseArtifactRecord => ({
  id: CatalogArtifactId(row.id),
  artifactDigest: row.artifact_digest,
  bytesChecksum: row.bytes_checksum,
  artifactBytes: new Uint8Array(row.artifact_bytes),
  sourceKind: row.source_kind,
  targetReleaseId: CatalogReleaseId(row.target_release_id),
  targetReleaseDigest: CatalogReleaseDigest(row.target_release_digest),
  predecessorReleaseId: row.predecessor_release_id
    ? CatalogReleaseId(row.predecessor_release_id)
    : null,
  predecessorReleaseDigest: row.predecessor_release_digest
    ? CatalogReleaseDigest(row.predecessor_release_digest)
    : null,
  toolchain: asJsonObject(row.toolchain),
  createdAt: asIso(row.created_at),
});

type CandidateRow = {
  id: string;
  artifact_id: string;
  artifact_digest: string;
  expected_base_release_id: string;
  expected_base_release_digest: string;
  proposal_id: string | null;
  proposal_revision_id: string | null;
  identity_allocation: unknown;
  impact_report_digest: string;
  capability_contract: unknown;
  created_at: Date | string;
};

const toCandidate = (row: CandidateRow): PublicationCandidateRecord => ({
  id: CatalogCandidateId(row.id),
  artifactId: CatalogArtifactId(row.artifact_id),
  artifactDigest: row.artifact_digest,
  expectedBaseReleaseId: CatalogReleaseId(row.expected_base_release_id),
  expectedBaseReleaseDigest: CatalogReleaseDigest(row.expected_base_release_digest),
  proposalId: row.proposal_id ? DefinitionProposalId(row.proposal_id) : null,
  proposalRevisionId: row.proposal_revision_id
    ? DefinitionProposalRevisionId(row.proposal_revision_id)
    : null,
  identityAllocation: asJsonObject(row.identity_allocation),
  impactReportDigest: row.impact_report_digest,
  capabilityContract: asJsonObject(row.capability_contract),
  createdAt: asIso(row.created_at),
});

type AuthorizationRow = {
  id: string;
  event_kind: PublicationAuthorizationEventKind;
  candidate_id: string;
  artifact_digest: string;
  expected_base_release_id: string;
  expected_base_release_digest: string;
  proposal_revision_id: string | null;
  impact_report_digest: string;
  capability_contract_digest: string;
  policy_revision: string | number;
  actor_principal_id: string;
  approved_authorization_id: string | null;
  created_at: Date | string;
};

const toAuthorization = (row: AuthorizationRow): PublicationAuthorizationRecord => ({
  id: PublicationAuthorizationId(row.id),
  eventKind: row.event_kind,
  candidateId: CatalogCandidateId(row.candidate_id),
  artifactDigest: row.artifact_digest,
  expectedBaseReleaseId: CatalogReleaseId(row.expected_base_release_id),
  expectedBaseReleaseDigest: CatalogReleaseDigest(row.expected_base_release_digest),
  proposalRevisionId: row.proposal_revision_id
    ? DefinitionProposalRevisionId(row.proposal_revision_id)
    : null,
  impactReportDigest: row.impact_report_digest,
  capabilityContractDigest: row.capability_contract_digest,
  policyRevision: PublicationPolicyRevision(Number(row.policy_revision)),
  actorPrincipalId: row.actor_principal_id,
  approvedAuthorizationId: row.approved_authorization_id
    ? PublicationAuthorizationId(row.approved_authorization_id)
    : null,
  createdAt: asIso(row.created_at),
});

type JobRow = {
  id: string;
  candidate_id: string;
  authorization_id: string;
  request_scope: string;
  idempotency_key: string;
  request_digest: string;
  status: PublicationJobStatus;
  lease_owner: string | null;
  lease_until: Date | string | null;
  fencing_token: string | number;
  attempt_count: number;
  last_error_class: string | null;
  last_error_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toJob = (row: JobRow): PublicationJobRecord => ({
  id: PublicationJobId(row.id),
  candidateId: CatalogCandidateId(row.candidate_id),
  authorizationId: PublicationAuthorizationId(row.authorization_id),
  requestScope: row.request_scope,
  idempotencyKey: row.idempotency_key,
  requestDigest: row.request_digest,
  status: row.status,
  leaseOwner: row.lease_owner,
  leaseUntil: row.lease_until === null ? null : asIso(row.lease_until),
  fencingToken: Number(row.fencing_token),
  attemptCount: Number(row.attempt_count),
  lastErrorClass: row.last_error_class,
  lastErrorReason: row.last_error_reason,
  createdAt: asIso(row.created_at),
  updatedAt: asIso(row.updated_at),
});

type PolicyRow = {
  revision: string | number;
  publication_enabled: boolean;
  low_risk_single_actor_publish: boolean;
  capability_contract_revision: string;
  updated_at: Date | string;
  updated_by_principal_id: string;
};

const toPolicy = (row: PolicyRow): PublicationPolicyRecord => ({
  revision: PublicationPolicyRevision(Number(row.revision)),
  publicationEnabled: row.publication_enabled,
  lowRiskSingleActorPublish: row.low_risk_single_actor_publish,
  capabilityContractRevision: row.capability_contract_revision,
  updatedAt: asIso(row.updated_at),
  updatedByPrincipalId: row.updated_by_principal_id,
});

type ReceiptRow = {
  id: string;
  kind: ActivationReceiptKind;
  release_id: string;
  release_digest: string;
  predecessor_release_id: string | null;
  predecessor_release_digest: string | null;
  verification_digest: string;
  publication_job_id: string | null;
  authorization_id: string | null;
  candidate_id: string | null;
  actor_principal_id: string;
  adoption_evidence: unknown;
  created_at: Date | string;
};

const toReceipt = (row: ReceiptRow): CatalogActivationReceiptRecord => ({
  id: CatalogActivationReceiptId(row.id),
  kind: row.kind,
  releaseId: CatalogReleaseId(row.release_id),
  releaseDigest: CatalogReleaseDigest(row.release_digest),
  predecessorReleaseId: row.predecessor_release_id
    ? CatalogReleaseId(row.predecessor_release_id)
    : null,
  predecessorReleaseDigest: row.predecessor_release_digest
    ? CatalogReleaseDigest(row.predecessor_release_digest)
    : null,
  verificationDigest: row.verification_digest,
  publicationJobId: row.publication_job_id ? PublicationJobId(row.publication_job_id) : null,
  authorizationId: row.authorization_id
    ? PublicationAuthorizationId(row.authorization_id)
    : null,
  candidateId: row.candidate_id ? CatalogCandidateId(row.candidate_id) : null,
  actorPrincipalId: row.actor_principal_id,
  adoptionEvidence:
    row.adoption_evidence === null ? null : asJsonObject(row.adoption_evidence),
  createdAt: asIso(row.created_at),
});

export async function getArtifactByDigest(
  db: Queryable,
  artifactDigest: string,
): Promise<CatalogPublicationStoreResult<ReleaseArtifactRecord>> {
  const digestError = requireSha256(artifactDigest, "artifactDigest");
  if (digestError) {
    return fail(digestError);
  }
  try {
    const result = await db.query<ArtifactRow>(
      `select
         id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
         target_release_id, target_release_digest, predecessor_release_id,
         predecessor_release_digest, toolchain, created_at
       from catalog_publication.release_artifacts
       where artifact_digest = $1`,
      [artifactDigest],
    );
    const row = result.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "artifact" });
    }
    return ok(toArtifact(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function persistArtifact(
  db: Queryable,
  input: PersistArtifactInput,
): Promise<CatalogPublicationStoreResult<ReleaseArtifactRecord>> {
  if (!SOURCE_KINDS.has(input.sourceKind)) {
    return fail({ kind: "invalid-input", reason: "unsupported sourceKind" });
  }
  const digestError = requireSha256(input.artifactDigest, "artifactDigest");
  if (digestError) {
    return fail(digestError);
  }
  if (input.artifactBytes.byteLength === 0) {
    return fail({ kind: "invalid-input", reason: "artifactBytes must be non-empty" });
  }
  const bytesChecksum = sha256DigestOfBytes(input.artifactBytes);
  const existing = await getArtifactByDigest(db, input.artifactDigest);
  if (existing.ok) {
    if (
      existing.value.bytesChecksum === bytesChecksum &&
      bytesEqual(existing.value.artifactBytes, input.artifactBytes)
    ) {
      return existing;
    }
    return fail({ kind: "conflict", reason: "artifact-digest-bytes-mismatch" });
  }
  if (existing.error.kind !== "not-found") {
    return existing;
  }

  try {
    const inserted = await db.query<ArtifactRow>(
      `insert into catalog_publication.release_artifacts (
         id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
         target_release_id, target_release_digest, predecessor_release_id,
         predecessor_release_digest, toolchain
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
       returning
         id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
         target_release_id, target_release_digest, predecessor_release_id,
         predecessor_release_digest, toolchain, created_at`,
      [
        input.id,
        input.artifactDigest,
        bytesChecksum,
        Buffer.from(input.artifactBytes),
        input.sourceKind,
        input.targetReleaseId,
        input.targetReleaseDigest,
        input.predecessorReleaseId,
        input.predecessorReleaseDigest,
        JSON.stringify(input.toolchain),
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "artifact" });
    }
    return ok(toArtifact(row));
  } catch (error) {
    const mapped = mapWriteError(error);
    if (mapped.kind === "conflict" && mapped.reason === "artifact-digest-bytes-mismatch") {
      const raced = await getArtifactByDigest(db, input.artifactDigest);
      if (raced.ok && bytesEqual(raced.value.artifactBytes, input.artifactBytes)) {
        return raced;
      }
    }
    return fail(mapped);
  }
}

export async function getCandidate(
  db: Queryable,
  candidateId: CatalogCandidateId,
): Promise<CatalogPublicationStoreResult<PublicationCandidateRecord>> {
  try {
  const result = await db.query<CandidateRow>(
    `select
       id, artifact_id, artifact_digest, expected_base_release_id,
       expected_base_release_digest, proposal_id, proposal_revision_id,
       identity_allocation, impact_report_digest, capability_contract, created_at
     from catalog_publication.candidates
     where id = $1`,
    [candidateId],
  );
  const row = result.rows[0];
  if (!row) {
    return fail({ kind: "not-found", entity: "candidate" });
  }
  return ok(toCandidate(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function persistCandidate(
  db: Queryable,
  input: PersistCandidateInput,
): Promise<CatalogPublicationStoreResult<PublicationCandidateRecord>> {
  const proposalMismatch =
    (input.proposalId === null) !== (input.proposalRevisionId === null);
  if (proposalMismatch) {
    return fail({
      kind: "invalid-input",
      reason: "proposalId and proposalRevisionId must both be null or both be set",
    });
  }

  try {
  const artifact = await db.query<{ id: string; artifact_digest: string }>(
    `select id, artifact_digest
     from catalog_publication.release_artifacts
     where id = $1`,
    [input.artifactId],
  );
  const artifactRow = artifact.rows[0];
  if (!artifactRow) {
    return fail({ kind: "not-found", entity: "artifact" });
  }
    const inserted = await db.query<CandidateRow>(
      `insert into catalog_publication.candidates (
         id, artifact_id, artifact_digest, expected_base_release_id,
         expected_base_release_digest, proposal_id, proposal_revision_id,
         identity_allocation, impact_report_digest, capability_contract
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)
       returning
         id, artifact_id, artifact_digest, expected_base_release_id,
         expected_base_release_digest, proposal_id, proposal_revision_id,
         identity_allocation, impact_report_digest, capability_contract, created_at`,
      [
        input.id,
        input.artifactId,
        artifactRow.artifact_digest,
        input.expectedBaseReleaseId,
        input.expectedBaseReleaseDigest,
        input.proposalId,
        input.proposalRevisionId,
        JSON.stringify(input.identityAllocation),
        input.impactReportDigest,
        JSON.stringify(input.capabilityContract),
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "candidate" });
    }
    return ok(toCandidate(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function appendAuthorization(
  db: Queryable,
  input: AppendAuthorizationInput,
): Promise<CatalogPublicationStoreResult<PublicationAuthorizationRecord>> {
  if (input.eventKind === "approve" && input.approvedAuthorizationId !== null) {
    return fail({
      kind: "invalid-input",
      reason: "approve events must not reference an approvedAuthorizationId",
    });
  }
  if (input.eventKind === "revoke" && input.approvedAuthorizationId === null) {
    return fail({
      kind: "invalid-input",
      reason: "revoke events must reference the approve authorization",
    });
  }
  const candidate = await getCandidate(db, input.candidateId);
  if (!candidate.ok) {
    return candidate;
  }
  if (
    candidate.value.artifactDigest !== input.artifactDigest ||
    candidate.value.expectedBaseReleaseId !== input.expectedBaseReleaseId ||
    candidate.value.expectedBaseReleaseDigest !== input.expectedBaseReleaseDigest ||
    (candidate.value.proposalRevisionId ?? null) !== (input.proposalRevisionId ?? null) ||
    candidate.value.impactReportDigest !== input.impactReportDigest
  ) {
    return fail({
      kind: "invalid-input",
      reason: "authorization tuple does not match candidate",
    });
  }
  try {
    const digest = await db.query<{ digest: string }>(
      `select catalog_publication.digest_jsonb(capability_contract) as digest
       from catalog_publication.candidates
       where id = $1`,
      [input.candidateId],
    );
    if (digest.rows[0]?.digest !== input.capabilityContractDigest) {
      return fail({
        kind: "invalid-input",
        reason: "capability_contract_digest does not match candidate",
      });
    }
  } catch (error) {
    return fail(mapWriteError(error));
  }
  try {
    const inserted = await db.query<AuthorizationRow>(
      `insert into catalog_publication.publication_authorizations (
         id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
         expected_base_release_digest, proposal_revision_id, impact_report_digest,
         capability_contract_digest, policy_revision, actor_principal_id,
         approved_authorization_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning
         id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
         expected_base_release_digest, proposal_revision_id, impact_report_digest,
         capability_contract_digest, policy_revision, actor_principal_id,
         approved_authorization_id, created_at`,
      [
        input.id,
        input.eventKind,
        input.candidateId,
        input.artifactDigest,
        input.expectedBaseReleaseId,
        input.expectedBaseReleaseDigest,
        input.proposalRevisionId,
        input.impactReportDigest,
        input.capabilityContractDigest,
        input.policyRevision,
        input.actorPrincipalId,
        input.approvedAuthorizationId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "authorization" });
    }
    return ok(toAuthorization(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function getJob(
  db: Queryable,
  jobId: PublicationJobId,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord>> {
  try {
  const result = await db.query<JobRow>(
    `select
       id, candidate_id, authorization_id, request_scope, idempotency_key,
       request_digest, status, lease_owner, lease_until, fencing_token,
       attempt_count, last_error_class, last_error_reason, created_at, updated_at
     from catalog_publication.publication_jobs
     where id = $1`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) {
    return fail({ kind: "not-found", entity: "job" });
  }
  return ok(toJob(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function createJob(
  db: Queryable,
  input: CreatePublicationJobInput,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord>> {
  const digestError = requireSha256(input.requestDigest, "requestDigest");
  if (digestError) {
    return fail(digestError);
  }
  try {
    const existing = await db.query<JobRow>(
    `select
       id, candidate_id, authorization_id, request_scope, idempotency_key,
       request_digest, status, lease_owner, lease_until, fencing_token,
       attempt_count, last_error_class, last_error_reason, created_at, updated_at
     from catalog_publication.publication_jobs
     where request_scope = $1 and idempotency_key = $2`,
    [input.requestScope, input.idempotencyKey],
    );
    const found = existing.rows[0];
    if (found) {
      if (found.request_digest === input.requestDigest) {
        return ok(toJob(found));
      }
      return fail({ kind: "conflict", reason: "idempotency-key-conflict" });
    }
  } catch (error) {
    return fail(mapWriteError(error));
  }

  try {
    const inserted = await db.query<JobRow>(
      `insert into catalog_publication.publication_jobs (
         id, candidate_id, authorization_id, request_scope, idempotency_key,
         request_digest, status
       ) values ($1, $2, $3, $4, $5, $6, 'queued')
       returning
         id, candidate_id, authorization_id, request_scope, idempotency_key,
         request_digest, status, lease_owner, lease_until, fencing_token,
         attempt_count, last_error_class, last_error_reason, created_at, updated_at`,
      [
        input.id,
        input.candidateId,
        input.authorizationId,
        input.requestScope,
        input.idempotencyKey,
        input.requestDigest,
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "job" });
    }
    return ok(toJob(row));
  } catch (error) {
    const mapped = mapWriteError(error);
    if (mapped.kind === "conflict" && mapped.reason === "idempotency-key-conflict") {
      const raced = await db.query<JobRow>(
        `select
           id, candidate_id, authorization_id, request_scope, idempotency_key,
           request_digest, status, lease_owner, lease_until, fencing_token,
           attempt_count, last_error_class, last_error_reason, created_at, updated_at
         from catalog_publication.publication_jobs
         where request_scope = $1 and idempotency_key = $2`,
        [input.requestScope, input.idempotencyKey],
      );
      const racedRow = raced.rows[0];
      if (racedRow && racedRow.request_digest === input.requestDigest) {
        return ok(toJob(racedRow));
      }
    }
    return fail(mapped);
  }
}

export async function updateJobExecution(
  db: Queryable,
  jobId: PublicationJobId,
  patch: JobExecutionPatch,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord>> {
  const assignments: string[] = ["updated_at = now()"];
  const values: unknown[] = [];
  const push = (sql: string, value: unknown) => {
    values.push(value);
    assignments.push(sql.replace("?", `$${values.length}`));
  };

  if (patch.status !== undefined) {
    if (!JOB_STATUSES.has(patch.status)) {
      return fail({ kind: "invalid-input", reason: "unsupported job status" });
    }
    push("status = ?", patch.status);
  }
  if (patch.leaseOwner !== undefined) {
    push("lease_owner = ?", patch.leaseOwner);
  }
  if (patch.leaseUntil !== undefined) {
    push("lease_until = ?", patch.leaseUntil);
  }
  if (patch.fencingToken !== undefined) {
    if (patch.expectedFencingToken === undefined) {
      return fail({
        kind: "invalid-input",
        reason: "expectedFencingToken is required when fencingToken is set",
      });
    }
    push("fencing_token = ?", patch.fencingToken);
  }
  if (patch.attemptCount !== undefined) {
    push("attempt_count = ?", patch.attemptCount);
  }
  if (patch.lastErrorClass !== undefined) {
    push("last_error_class = ?", patch.lastErrorClass);
  }
  if (patch.lastErrorReason !== undefined) {
    push("last_error_reason = ?", patch.lastErrorReason);
  }
  if (assignments.length === 1) {
    return fail({ kind: "invalid-input", reason: "job execution patch is empty" });
  }

  values.push(jobId);
  let where = `id = $${values.length}`;
  if (patch.expectedFencingToken !== undefined) {
    values.push(patch.expectedFencingToken);
    where += ` and fencing_token = $${values.length}`;
  }
  try {
    const updated = await db.query<JobRow>(
      `update catalog_publication.publication_jobs
       set ${assignments.join(", ")}
       where ${where}
       returning
         id, candidate_id, authorization_id, request_scope, idempotency_key,
         request_digest, status, lease_owner, lease_until, fencing_token,
         attempt_count, last_error_class, last_error_reason, created_at, updated_at`,
      values,
    );
    const row = updated.rows[0];
    if (!row) {
      if (patch.expectedFencingToken !== undefined) {
        const existing = await getJob(db, jobId);
        if (existing.ok) {
          return fail({ kind: "conflict", reason: "fencing-token-mismatch" });
        }
        return existing;
      }
      return fail({ kind: "not-found", entity: "job" });
    }
    return ok(toJob(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function getPolicy(
  db: Queryable,
): Promise<CatalogPublicationStoreResult<PublicationPolicyRecord>> {
  try {
  const result = await db.query<PolicyRow>(
    `select
       revision, publication_enabled, low_risk_single_actor_publish,
       capability_contract_revision, updated_at, updated_by_principal_id
     from catalog_publication.publication_policies
     where singleton`,
  );
  const row = result.rows[0];
  if (!row) {
    return fail({ kind: "not-found", entity: "policy" });
  }
  return ok(toPolicy(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function getReceiptByJobId(
  db: Queryable,
  jobId: PublicationJobId,
): Promise<CatalogPublicationStoreResult<CatalogActivationReceiptRecord>> {
  try {
  const result = await db.query<ReceiptRow>(
    `select
       id, kind, release_id, release_digest, predecessor_release_id,
       predecessor_release_digest, verification_digest, publication_job_id,
       authorization_id, candidate_id, actor_principal_id, adoption_evidence,
       created_at
     from parameter_catalog.catalog_activation_receipts
     where publication_job_id = $1`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) {
    return fail({ kind: "not-found", entity: "receipt" });
  }
  return ok(toReceipt(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function insertReceipt(
  db: Queryable,
  input: InsertActivationReceiptInput,
): Promise<CatalogPublicationStoreResult<CatalogActivationReceiptRecord>> {
  try {
    const inserted = await db.query<ReceiptRow>(
      `insert into parameter_catalog.catalog_activation_receipts (
         id, kind, release_id, release_digest, predecessor_release_id,
         predecessor_release_digest, verification_digest, publication_job_id,
         authorization_id, candidate_id, actor_principal_id, adoption_evidence
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       returning
         id, kind, release_id, release_digest, predecessor_release_id,
         predecessor_release_digest, verification_digest, publication_job_id,
         authorization_id, candidate_id, actor_principal_id, adoption_evidence,
         created_at`,
      [
        input.id,
        input.kind,
        input.releaseId,
        input.releaseDigest,
        input.predecessorReleaseId,
        input.predecessorReleaseDigest,
        input.verificationDigest,
        input.publicationJobId,
        input.authorizationId,
        input.candidateId,
        input.actorPrincipalId,
        input.adoptionEvidence === null ? null : JSON.stringify(input.adoptionEvidence),
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "receipt" });
    }
    return ok(toReceipt(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}
