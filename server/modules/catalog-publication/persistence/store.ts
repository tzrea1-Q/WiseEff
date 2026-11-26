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

import { timeCatalogStage } from "../../../observability/catalogPublicationStages";
import { catalogCompilerContractFingerprint, catalogCompilerDtsContract, catalogCompilerOwnerContractFingerprint } from "../../catalog-kernel/compiler/contract";
import type { CatalogReleaseBundle, CatalogReleaseNode } from "../../catalog-kernel/compiler/types";
import { canonicalBundleEnvelope, encodeBundleBytes, parseBundleBytes } from "../builder/bundleCodec";

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
import {
  artifactByteChunkJoin,
  artifactByteColumns,
  assembleArtifactBytes,
  type ArtifactByteChunkRow,
} from "./artifactByteTransport";
import type {
  ActivationReceiptKind,
  AppendAuthorizationInput,
  ArtifactSourceKind,
  CatalogActivationReceiptRecord,
  CatalogPublicationStoreError,
  CatalogPublicationStoreResult,
  ClaimNextJobInput,
  CreatePublicationJobInput,
  InsertActivationReceiptInput,
  JobExecutionPatch,
  JsonObject,
  PersistArtifactInput,
  PersistCandidateInput,
  PreviewSnapshot,
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
  "markdown-import",
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
  return Buffer.compare(left, right) === 0;
};

type ArtifactRow = {
  storage_format: "full" | "successor-v1";
  id: string;
  artifact_digest: string;
  bytes_checksum: string;
  source_kind: ArtifactSourceKind;
  target_release_id: string;
  target_release_digest: string;
  predecessor_release_id: string | null;
  predecessor_release_digest: string | null;
  toolchain: unknown;
  created_at: Date | string;
};

const toArtifact = (row: ArtifactRow, artifactBytes: Uint8Array): ReleaseArtifactRecord => ({
  ...(row.storage_format === "successor-v1" ? { storageFormat: row.storage_format } : {}),
  id: CatalogArtifactId(row.id),
  artifactDigest: row.artifact_digest,
  bytesChecksum: row.bytes_checksum,
  artifactBytes,
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

async function readStoredArtifacts(
  db: Queryable, scope?: { readonly digest: string; readonly includeLineage: boolean },
): Promise<Map<string, ReleaseArtifactRecord>> {
  // UNION deduplicates even a malformed cycle. Only lightweight pins enter
  // the recursion; each required artifact is transported once in one snapshot.
  const compactStorage = (await db.query<{ available: boolean }>(
    "select to_regclass('catalog_publication.preview_snapshots') is not null as available",
  )).rows[0]?.available;
  const lineage = compactStorage && scope?.includeLineage ? `with recursive lineage(digest, base) as (
    select artifact_digest, compact_base_digest from catalog_publication.release_artifacts where artifact_digest = $1
    union
    select a.artifact_digest, a.compact_base_digest from catalog_publication.release_artifacts a
      join lineage l on l.base = a.artifact_digest
  )` : "";
  const { rows } = await db.query<ArtifactRow & ArtifactByteChunkRow>(
    `${lineage} select id, artifact_digest, bytes_checksum, source_kind, ${compactStorage ? "storage_format" : "'full' as storage_format"},
            target_release_id, target_release_digest, predecessor_release_id, predecessor_release_digest,
            toolchain, created_at, ${artifactByteColumns}
       from catalog_publication.release_artifacts as artifact
       ${lineage ? "join lineage on lineage.digest = artifact.artifact_digest" : ""}
       ${artifactByteChunkJoin}
       ${scope && !lineage ? "where artifact_digest = $1" : ""}
       order by created_at, id, chunk.byte_start`,
    scope ? [scope.digest] : [],
  );
  const records = new Map<string, ReleaseArtifactRecord>();
  for (let start = 0; start < rows.length;) {
    const first = rows[start]!;
    let end = start + 1;
    while (rows[end]?.id === first.id) end += 1;
    records.set(first.artifact_digest, toArtifact(first, assembleArtifactBytes(rows.slice(start, end))));
    start = end;
  }
  return records;
}

function matchingTarget(record: ReleaseArtifactRecord, node?: CatalogReleaseNode): boolean {
  return node?.manifest?.release?.id === record.targetReleaseId &&
    node.manifest.release.digest === record.targetReleaseDigest &&
    record.targetReleaseDigest === record.artifactDigest;
}

export async function getArtifactByDigest(
  db: Queryable,
  artifactDigest: string,
): Promise<CatalogPublicationStoreResult<ReleaseArtifactRecord>> {
  return readArtifact(db, artifactDigest, true);
}

export type StoredArtifactLineage = {
  readonly target: ReleaseArtifactRecord;
  readonly records: ReadonlyMap<string, ReleaseArtifactRecord>;
};

/** Own all physical bytes in one database snapshot. Decode after releasing the reader. */
export async function readArtifactLineage(
  db: Queryable, digest: string, includeLineage = true,
): Promise<CatalogPublicationStoreResult<StoredArtifactLineage>> {
  const invalid = requireSha256(digest, "artifactDigest");
  if (invalid) return fail(invalid);
  try {
    const records = await timeCatalogStage("artifact-read", () => readStoredArtifacts(db, { digest, includeLineage }),
      rows => ({
        artifactCount: rows.size,
        byteCount: Array.from(rows.values()).reduce((sum, row) => sum + row.artifactBytes.byteLength, 0),
      }));
    const target = records.get(digest);
    return target ? ok({ target, records }) : fail({ kind: "not-found", entity: "artifact" });
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

async function readArtifact(db: Queryable, digest: string, includeLineage: boolean): Promise<CatalogPublicationStoreResult<ReleaseArtifactRecord>> {
  const lineage = await readArtifactLineage(db, digest, includeLineage);
  if (!lineage.ok) return lineage;
  const { target, records } = lineage.value;
  return includeLineage && target.storageFormat
    ? timeCatalogStage("lineage-verify-decode", () => hydrateArtifact(target, records))
    : ok(target);
}

// Both bundle readers produce plain JSON trees. Overflowing numbers and negative
// zero are the only parsed scalars that canonical contract encoding would reject.
function checkParsedNumbers(value: unknown): void {
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    throw new TypeError("invalid contract number");
  }
  if (Array.isArray(value)) {
    for (const item of value) checkParsedNumbers(item);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) checkParsedNumbers(item);
  }
}

function decodePhysicalRelease(record: ReleaseArtifactRecord): CatalogPublicationStoreResult<CatalogReleaseBundle> {
  if (sha256DigestOfBytes(record.artifactBytes) !== record.bytesChecksum) {
    return fail({ kind: "invalid-input", reason: "invalid-artifact-lineage" });
  }
  const parsed = parseBundleBytes(record.artifactBytes);
  if (!parsed.ok) {
    return fail({ kind: "invalid-input", reason: parsed.detail === "catalog-release-bundle-scalar-too-large"
      ? parsed.detail : "invalid-artifact-bundle" });
  }
  const { bundle } = parsed;
  if (bundle.targetReleaseId !== record.targetReleaseId || bundle.releases.some(node =>
    typeof node?.manifest?.release?.id !== "string" || !Number.isSafeInteger(node.manifest.release.sequence))) {
    return fail({ kind: "invalid-input", reason: "invalid-artifact-bundle" });
  }
  if (record.storageFormat) {
    const node = bundle.releases[0];
    if (!node || bundle.releases.length !== 1 || !matchingTarget(record, node) ||
        !record.predecessorReleaseDigest || node.manifest.release.predecessor?.digest !== record.predecessorReleaseDigest ||
        node.manifest.release.predecessor.id !== record.predecessorReleaseId) {
      return fail({ kind: "invalid-input", reason: "invalid-compact-artifact" });
    }
  }
  return ok(bundle);
}

/** Verify one physically stored successor before extending a certified base. */
export function decodeStoredSuccessor(record: ReleaseArtifactRecord): CatalogPublicationStoreResult<CatalogReleaseNode> {
  if (!record.storageFormat) return fail({ kind: "invalid-input", reason: "invalid-compact-artifact" });
  const parsed = decodePhysicalRelease(record);
  if (!parsed.ok) return parsed;
  const node = parsed.value.releases[0]!;
  try {
    checkParsedNumbers(node);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return fail({ kind: "invalid-input", reason: "invalid-artifact-bundle" });
    }
    throw error;
  }
  return ok(node);
}

function assembleArtifactBundle<T>(
  first: ReleaseArtifactRecord,
  records: ReadonlyMap<string, ReleaseArtifactRecord>,
  consume: (logical: CatalogReleaseBundle) => T,
  checkpoint?: () => void,
): CatalogPublicationStoreResult<T> {
  const suffix: CatalogReleaseNode[] = [];
  const visited = new Set<string>();
  let record = first;
  while (true) {
    checkpoint?.();
    if (visited.has(record.artifactDigest)) return fail({ kind: "invalid-input", reason: "invalid-artifact-lineage" });
    visited.add(record.artifactDigest);
    const decoded = decodePhysicalRelease(record);
    if (!decoded.ok) return decoded;
    const bundle = decoded.value;
    if (!record.storageFormat) {
      if (!matchingTarget(record, bundle.releases.find(node => node.manifest.release.id === bundle.targetReleaseId))) {
        return fail({ kind: "invalid-input", reason: "invalid-artifact-base" });
      }
      try {
        return ok(consume({
          ...bundle, targetReleaseId: first.targetReleaseId, releases: [...bundle.releases, ...suffix.reverse()],
        }));
      } catch (error) {
        if (error instanceof TypeError || (error instanceof RangeError && error.message === "Maximum call stack size exceeded")) {
          return fail({ kind: "invalid-input", reason: "invalid-artifact-bundle" });
        }
        throw error;
      }
    }
    suffix.push(bundle.releases[0]!);
    const base = records.get(record.predecessorReleaseDigest!);
    if (!base || base.targetReleaseId !== record.predecessorReleaseId) {
      return fail({ kind: "invalid-input", reason: "invalid-artifact-base" });
    }
    record = base;
  }
}

function hydrateArtifact(
  first: ReleaseArtifactRecord,
  records: ReadonlyMap<string, ReleaseArtifactRecord>,
): CatalogPublicationStoreResult<ReleaseArtifactRecord> {
  const encoded = assembleArtifactBundle(first, records, encodeBundleBytes);
  if (!encoded.ok) return encoded;
  return ok({ ...first, storageFormat: undefined, artifactBytes: encoded.value, bytesChecksum: sha256DigestOfBytes(encoded.value),
    storageBytesChecksum: first.bytesChecksum });
}

/** Verify the independently stored bytes and supply compiler input without emitting a logical byte stream. */
export function decodeStoredArtifact({ target, records }: StoredArtifactLineage, checkpoint?: () => void):
  CatalogPublicationStoreResult<CatalogReleaseBundle> {
  if (target.storageFormat) {
    return assembleArtifactBundle(target, records, logical => {
      const bundle = canonicalBundleEnvelope(logical);
      checkParsedNumbers(bundle.releases);
      return bundle;
    }, checkpoint);
  }
  if (sha256DigestOfBytes(target.artifactBytes) !== target.bytesChecksum) {
    return fail({ kind: "invalid-input", reason: "invalid-artifact-checksum" });
  }
  const parsed = parseBundleBytes(target.artifactBytes);
  return parsed.ok ? ok(parsed.bundle) : fail({ kind: "invalid-input", reason: parsed.detail });
}

/** Read one database snapshot for permanent Definition erasure, including pending candidates. */
export async function readArtifactsForErasure(db: Queryable): Promise<ReleaseArtifactRecord[]> {
  const records = await readStoredArtifacts(db);
  const result: ReleaseArtifactRecord[] = [];
  for (const record of records.values()) {
    if (!record.storageFormat) {
      result.push(record);
      continue;
    }
    const hydrated = hydrateArtifact(record, records);
    if (!hydrated.ok) throw new Error(`Cannot read Catalog erasure lineage for ${record.id}`);
    result.push(hydrated.value);
  }
  return result;
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
  // Own the bytes before awaiting the lookup: the checksum, insert, and
  // returned record must refer to the same snapshot.
  const bytes = Buffer.from(input.artifactBytes);
  const bytesChecksum = sha256DigestOfBytes(bytes);
  // Compare in the writer's format when possible. A compact retry against an
  // older full row must reconstruct its logical bytes from the pinned parent.
  const matchExisting = async (stored: ReleaseArtifactRecord): Promise<CatalogPublicationStoreResult<ReleaseArtifactRecord>> => {
    let comparable: ReleaseArtifactRecord = { ...stored, ...input, bytesChecksum, artifactBytes: bytes };
    if (input.storageFormat && !stored.storageFormat && input.predecessorReleaseDigest) {
      const base = await getArtifactByDigest(db, input.predecessorReleaseDigest);
      if (!base.ok) return base;
      const hydrated = hydrateArtifact(comparable, new Map([[base.value.artifactDigest, base.value]]));
      if (!hydrated.ok) return hydrated;
      comparable = hydrated.value;
    }
    return comparable.storageFormat === stored.storageFormat && comparable.bytesChecksum === stored.bytesChecksum &&
      bytesEqual(comparable.artifactBytes, stored.artifactBytes)
      ? ok(stored) : fail({ kind: "conflict", reason: "artifact-digest-bytes-mismatch" });
  };
  const existing = await readArtifact(db, input.artifactDigest, !input.storageFormat);
  if (existing.ok) {
    return matchExisting(existing.value);
  }
  if (existing.error.kind !== "not-found") {
    return existing;
  }

  try {
    const inserted = await db.query<ArtifactRow>(
      `insert into catalog_publication.release_artifacts (
         id, artifact_digest, bytes_checksum, artifact_bytes, source_kind,
         target_release_id, target_release_digest, predecessor_release_id,
         predecessor_release_digest, toolchain${input.storageFormat ? ", storage_format, compact_base_digest" : ""}
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb${input.storageFormat ? ", $11, $9" : ""})
       on conflict (artifact_digest) do nothing
       returning
         id, artifact_digest, bytes_checksum, source_kind,
         target_release_id, target_release_digest, predecessor_release_id,
         predecessor_release_digest, toolchain, created_at, ${input.storageFormat ? "storage_format" : "'full' as storage_format"}`,
      [
        input.id,
        input.artifactDigest,
        bytesChecksum,
        bytes,
        input.sourceKind,
        input.targetReleaseId,
        input.targetReleaseDigest,
        input.predecessorReleaseId,
        input.predecessorReleaseDigest,
        JSON.stringify(input.toolchain),
        ...(input.storageFormat ? [input.storageFormat] : []),
      ],
    );
    const row = inserted.rows[0];
    if (!row) {
      const raced = await readArtifact(db, input.artifactDigest, !input.storageFormat);
      return raced.ok ? matchExisting(raced.value) : raced;
    }
    return ok(toArtifact(row, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

/** Bump the algorithm revision for validation changes not captured by the compiler contracts. */
const previewValidatorVersion = (proof: string) => [
  proof, catalogCompilerContractFingerprint, catalogCompilerOwnerContractFingerprint,
  catalogCompilerDtsContract(false).compilerFingerprint, catalogCompilerDtsContract(true).compilerFingerprint,
].join("/");
// Existing readers recognize only the stronger certificate. Writing a separate
// version prevents them from using a definitions-only target for a rename.
const spellingProof = previewValidatorVersion("catalog-subject-rename/v1");
const definitionProof = previewValidatorVersion("catalog-definition-edits/v1");

export async function getValidatedPreviewSnapshot(
  db: Queryable, digest: string, scope: "definitions" | "spellings" = "definitions",
): Promise<CatalogPublicationStoreResult<PreviewSnapshot>> {
  try {
    const result = await timeCatalogStage("snapshot-read", () => db.query<ArtifactByteChunkRow & {
      target_release_id: string; target_checksum: string; has_subject_rules: boolean; has_dts_examples: boolean; validator_version: string;
    }>(
      `select target_release_id, target_checksum, has_subject_rules, has_dts_examples, validator_version, ${artifactByteColumns}
         from (
           select a.target_release_id, s.target_checksum, s.has_subject_rules, s.has_dts_examples, s.validator_version,
                  coalesce(s.target_bytes, a.artifact_bytes) as artifact_bytes
           from catalog_publication.preview_snapshots s
           join catalog_publication.release_artifacts a on a.id = s.artifact_id
           where a.artifact_digest = $1 and a.target_release_digest = $1
             and s.bytes_checksum = a.bytes_checksum and s.validator_version in ($2, $3)
           order by (s.validator_version = $2) desc limit 1
         ) artifact
         ${artifactByteChunkJoin}
         order by chunk.byte_start`,
      [digest, spellingProof, scope === "definitions" ? definitionProof : null],
    ), read => ({ byteCount: read.rows[0]?.artifact_byte_length ?? 0 }));
    const row = result.rows[0];
    if (!row) return fail({ kind: "not-found", entity: "artifact" });
    return await timeCatalogStage("snapshot-verify-decode", () => {
      const bytes = assembleArtifactBytes(result.rows);
      const parsed = parseBundleBytes(bytes);
      const node = parsed.ok ? parsed.bundle.releases?.[0] : undefined;
      if (sha256DigestOfBytes(bytes) !== row.target_checksum || !parsed.ok ||
          parsed.bundle.releases?.length !== 1 || parsed.bundle.targetReleaseId !== row.target_release_id ||
          !node || node.manifest?.release?.digest !== digest || node.manifest.release.id !== row.target_release_id) {
        return fail({ kind: "invalid-input", reason: "invalid-preview-snapshot" });
      }
      return ok({ target: node, coversSubjectSpellings: row.validator_version === spellingProof,
        hasSubjectRules: row.has_subject_rules, hasDtsExamples: row.has_dts_examples });
    });
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function putValidatedPreviewSnapshot(
  db: Queryable, digest: string, snapshot: PreviewSnapshot, storageFormat?: "successor-v1",
): Promise<CatalogPublicationStoreResult<void>> {
  const release = snapshot.target.manifest.release;
  if (release.digest !== digest) return fail({ kind: "invalid-input", reason: "invalid-preview-snapshot" });
  const targetBytes = storageFormat ? null : encodeBundleBytes({
    schemaVersion: "1.0.0", targetReleaseId: release.id, releases: [snapshot.target],
  });
  try {
    const inserted = await db.query<{ present: boolean }>(
      `with source as (
         select id, bytes_checksum from catalog_publication.release_artifacts
         where artifact_digest = $1 and target_release_digest = $1 and target_release_id = $2
           and ($7::boolean = false or storage_format = 'successor-v1')
       ), saved as (
         insert into catalog_publication.preview_snapshots
           (artifact_id, artifact_digest, validator_version, bytes_checksum, has_subject_rules, target_bytes, target_checksum, has_dts_examples)
         select id, $1, $3, bytes_checksum, $4, $5, coalesce($6, bytes_checksum), $8 from source
         on conflict (artifact_id, validator_version) do nothing
       )
       select exists (select 1 from source) as present`,
      [digest, release.id, snapshot.coversSubjectSpellings ? spellingProof : definitionProof, snapshot.hasSubjectRules, targetBytes,
        targetBytes ? sha256DigestOfBytes(targetBytes) : null, Boolean(storageFormat), snapshot.hasDtsExamples],
    );
    return inserted.rows[0]?.present ? ok(undefined) : fail({ kind: "not-found", entity: "artifact" });
  } catch (error) {
    return fail(mapWriteError(error));
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

export async function getAuthorization(
  db: Queryable,
  authorizationId: PublicationAuthorizationId,
): Promise<CatalogPublicationStoreResult<PublicationAuthorizationRecord>> {
  try {
    const result = await db.query<AuthorizationRow>(
      `select
         id, event_kind, candidate_id, artifact_digest, expected_base_release_id,
         expected_base_release_digest, proposal_revision_id, impact_report_digest,
         capability_contract_digest, policy_revision, actor_principal_id,
         approved_authorization_id, created_at
       from catalog_publication.publication_authorizations
       where id = $1`,
      [authorizationId],
    );
    const row = result.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "authorization" });
    }
    return ok(toAuthorization(row));
  } catch (error) {
    return fail(mapWriteError(error));
  }
}

export async function listJobs(
  db: Queryable,
  limit: number,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord[]>> {
  try {
    const bounded = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    const result = await db.query<JobRow>(
      `select
         id, candidate_id, authorization_id, request_scope, idempotency_key,
         request_digest, status, lease_owner, lease_until, fencing_token,
         attempt_count, last_error_class, last_error_reason, created_at, updated_at
       from catalog_publication.publication_jobs
       order by created_at desc
       limit $1`,
      [bounded],
    );
    return ok(result.rows.map(toJob));
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

export async function getJobByIdempotency(
  db: Queryable,
  requestScope: string,
  idempotencyKey: string,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord>> {
  try {
    const result = await db.query<JobRow>(
      `select
         id, candidate_id, authorization_id, request_scope, idempotency_key,
         request_digest, status, lease_owner, lease_until, fencing_token,
         attempt_count, last_error_class, last_error_reason, created_at, updated_at
       from catalog_publication.publication_jobs
       where request_scope = $1 and idempotency_key = $2`,
      [requestScope, idempotencyKey],
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

export async function claimNextJob(
  db: Queryable,
  input: ClaimNextJobInput,
): Promise<CatalogPublicationStoreResult<PublicationJobRecord>> {
  if (input.leaseOwner.trim().length === 0 || input.leaseOwner.trim() !== input.leaseOwner) {
    return fail({ kind: "invalid-input", reason: "leaseOwner is required" });
  }
  if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds <= 0) {
    return fail({ kind: "invalid-input", reason: "leaseSeconds must be a positive integer" });
  }
  try {
    const claimed = await db.query<JobRow>(
      `with picked as (
         select id
           from catalog_publication.publication_jobs
          where (
                  status in ('queued', 'failed-retryable')
                  and (lease_until is null or lease_until < now())
                )
             or (
                  status = 'running'
                  and lease_until is not null
                  and lease_until < now()
                )
          order by created_at asc, id asc
          for update skip locked
          limit 1
       )
       update catalog_publication.publication_jobs as job
          set status = 'running',
              lease_owner = $1,
              lease_until = now() + make_interval(secs => $2::int),
              fencing_token = job.fencing_token + 1,
              attempt_count = job.attempt_count + 1,
              updated_at = now()
         from picked
        where job.id = picked.id
       returning
         job.id, job.candidate_id, job.authorization_id, job.request_scope, job.idempotency_key,
         job.request_digest, job.status, job.lease_owner, job.lease_until, job.fencing_token,
         job.attempt_count, job.last_error_class, job.last_error_reason, job.created_at, job.updated_at`,
      [input.leaseOwner, input.leaseSeconds],
    );
    const row = claimed.rows[0];
    if (!row) {
      return fail({ kind: "not-found", entity: "job" });
    }
    return ok(toJob(row));
  } catch (error) {
    return fail(mapWriteError(error));
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
  if (patch.expectedStatus !== undefined) {
    values.push(patch.expectedStatus);
    where += ` and status = $${values.length}`;
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
      if (patch.expectedFencingToken !== undefined || patch.expectedStatus !== undefined) {
        const existing = await getJob(db, jobId);
        if (existing.ok) {
          return fail({ kind: "conflict", reason: patch.expectedStatus !== undefined && existing.value.status !== patch.expectedStatus
            ? "job-status-mismatch" : "fencing-token-mismatch" });
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
