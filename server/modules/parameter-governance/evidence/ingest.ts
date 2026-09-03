import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  CatalogReleaseId,
  ParameterObservationId,
  ReviewEvidenceId,
  serializeContract,
  type ContractJsonValue,
  type LegacyRowClass,
  type ReviewReason,
} from "../../parameter-catalog-contract/index";

import { planEvidenceIngest, type PlannedIngest } from "./plan";
import {
  evidenceIngestCommandFamily,
  type EvidenceIngest,
  type IngestEvidenceCommand,
  type IngestEvidenceFailure,
  type IngestEvidenceResult,
  type Result,
} from "./types";

type IdempotencyRow = {
  request_fingerprint: string;
  state: "pending" | "committed";
  result_kind: string | null;
  result_ref: string | null;
};

type ObservationRow = {
  id: string;
  evidence_fingerprint: string;
  catalog_release_id: string;
  source_locator: unknown;
};

type ReviewEvidenceRow = {
  id: string;
  candidate_safe_digest: string;
  reason: ReviewReason;
  r_class: LegacyRowClass | null;
  evidence: unknown;
};

type ReviewEvidenceLookup =
  | { readonly status: "absent" }
  | { readonly status: "found"; readonly row: ReviewEvidenceRow }
  | { readonly status: "ambiguous"; readonly row: ReviewEvidenceRow };

const asJson = (value: unknown): string => JSON.stringify(value);

const isUniqueViolation = (error: unknown): error is pg.DatabaseError =>
  error instanceof pg.DatabaseError && error.code === "23505";

const isForeignKeyViolation = (error: unknown): error is pg.DatabaseError =>
  error instanceof pg.DatabaseError && error.code === "23503";

const catalogReleaseFk = new Set([
  "parameter_observations_catalog_release_id_fkey",
]);

const mapInsertFailure = (
  error: unknown,
  command: IngestEvidenceCommand,
): IngestEvidenceFailure | null => {
  if (!isForeignKeyViolation(error)) return null;
  const detail = error.detail ?? "";
  if (
    (error.constraint && catalogReleaseFk.has(error.constraint)) ||
    detail.includes("catalog_releases")
  ) {
    return {
      kind: "catalog-release-not-found",
      catalogReleaseId: command.catalogReleaseId,
    };
  }
  if (
    error.constraint === "parameter_observations_organization_id_fkey" ||
    error.constraint === "parameter_observations_project_id_organization_id_fkey" ||
    error.constraint === "parameter_review_evidence_organization_id_fkey" ||
    error.constraint === "governance_command_idempotency_organization_id_fkey" ||
    detail.includes("organizations") ||
    detail.includes("projects")
  ) {
    return { kind: "missing-source-provenance", missing: ["organizationId"] };
  }
  return null;
};

const observationResult = (
  row: ObservationRow,
  status: "ingested" | "replayed",
  fingerprint: string,
): IngestEvidenceResult => ({
  kind: "observation",
  status,
  id: ParameterObservationId(row.id),
  fingerprint,
  catalogReleaseId: CatalogReleaseId(row.catalog_release_id),
});

const reviewResult = (
  row: ReviewEvidenceRow,
  status: "ingested" | "replayed",
  fingerprint: string,
): IngestEvidenceResult => ({
  kind: "review-evidence",
  status,
  id: ReviewEvidenceId(row.id),
  fingerprint,
  reason: row.reason,
  rClass: row.r_class,
});

const sameCanonicalJson = (left: unknown, right: unknown): boolean =>
  serializeContract(left as ContractJsonValue) ===
  serializeContract(right as ContractJsonValue);

const loadObservation = async (
  client: pg.PoolClient,
  organizationId: string,
  sourceIdentity: string,
): Promise<ObservationRow | null> => {
  const result = await client.query<ObservationRow>(
    `select id, evidence_fingerprint, catalog_release_id, source_locator
     from parameter_catalog.parameter_observations
     where organization_id = $1 and source_identity = $2
     for update`,
    [organizationId, sourceIdentity],
  );
  return result.rows[0] ?? null;
};

const loadReviewEvidence = async (
  client: pg.PoolClient,
  id: string,
): Promise<ReviewEvidenceRow | null> => {
  const result = await client.query<ReviewEvidenceRow>(
    `select id, candidate_safe_digest, reason, r_class, evidence
     from parameter_catalog.parameter_review_evidence
     where id = $1
     for update`,
    [id],
  );
  return result.rows[0] ?? null;
};

const loadReviewEvidenceByIdentity = async (
  client: pg.PoolClient,
  organizationId: string,
  sourceIdentity: string,
): Promise<ReviewEvidenceLookup> => {
  const result = await client.query<ReviewEvidenceRow>(
    `select id, candidate_safe_digest, reason, r_class, evidence
     from parameter_catalog.parameter_review_evidence
     where organization_id = $1
       and evidence->>'sourceIdentity' = $2
     for update`,
    [organizationId, sourceIdentity],
  );
  if (result.rows.length === 0) return { status: "absent" };
  if (result.rows.length === 1) return { status: "found", row: result.rows[0]! };
  return { status: "ambiguous", row: result.rows[0]! };
};

const fingerprintConflict = (
  command: IngestEvidenceCommand,
  storedId: string,
  storedFingerprint: string,
  attemptedFingerprint: string,
): Result<never, IngestEvidenceFailure> => ({
  ok: false,
  error: {
    kind: "fingerprint-conflict",
    sourceIdentity: command.sourceIdentity,
    storedId,
    storedFingerprint,
    attemptedFingerprint,
  },
});

const overwriteRefused = (
  command: IngestEvidenceCommand,
  storedId: string,
): Result<never, IngestEvidenceFailure> => ({
  ok: false,
  error: {
    kind: "evidence-overwrite-refused",
    sourceIdentity: command.sourceIdentity,
    storedId,
  },
});

const replayOrConflictObservation = (
  stored: ObservationRow,
  planned: PlannedIngest,
  command: IngestEvidenceCommand,
): Result<IngestEvidenceResult, IngestEvidenceFailure> => {
  if (
    planned.kind === "observation" &&
    stored.evidence_fingerprint === planned.fingerprint
  ) {
    return {
      ok: true,
      value: observationResult(stored, "replayed", planned.fingerprint),
    };
  }
  return fingerprintConflict(
    command,
    stored.id,
    stored.evidence_fingerprint,
    planned.fingerprint,
  );
};

const replayOrRefuseReviewEvidence = (
  stored: ReviewEvidenceRow,
  planned: PlannedIngest,
  command: IngestEvidenceCommand,
): Result<IngestEvidenceResult, IngestEvidenceFailure> => {
  if (
    planned.kind === "review-evidence" &&
    stored.candidate_safe_digest === planned.fingerprint &&
    sameCanonicalJson(stored.evidence, planned.evidence)
  ) {
    return {
      ok: true,
      value: reviewResult(stored, "replayed", planned.fingerprint),
    };
  }
  return overwriteRefused(command, stored.id);
};

const insertObservation = async (
  client: pg.PoolClient,
  command: IngestEvidenceCommand,
  planned: PlannedIngest & { kind: "observation" },
): Promise<ObservationRow> => {
  const id = `pobs_${randomUUID()}`;
  const inserted = await client.query<ObservationRow>(
    `insert into parameter_catalog.parameter_observations (
       id, organization_id, project_id, logical_node_id, config_revision_id,
       source_identity, source_locator, catalog_release_id, matcher_revision,
       evidence_fingerprint
     ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     returning id, evidence_fingerprint, catalog_release_id, source_locator`,
    [
      id,
      command.organizationId,
      planned.provenance.projectId,
      planned.provenance.logicalNodeId,
      planned.provenance.configRevisionId,
      command.sourceIdentity,
      asJson(planned.provenance.sourceLocator),
      command.catalogReleaseId,
      command.matcherRevision,
      planned.fingerprint,
    ],
  );
  return inserted.rows[0]!;
};

const insertReviewEvidence = async (
  client: pg.PoolClient,
  command: IngestEvidenceCommand,
  planned: PlannedIngest & { kind: "review-evidence" },
): Promise<ReviewEvidenceRow> => {
  const id = `prev_${randomUUID()}`;
  const inserted = await client.query<ReviewEvidenceRow>(
    `insert into parameter_catalog.parameter_review_evidence (
       id, organization_id, observation_id, reason, candidate_safe_digest,
       r_class, source_graph_ref, evidence
     ) values ($1,$2,null,$3,$4,$5,$6,$7::jsonb)
     returning id, candidate_safe_digest, reason, r_class, evidence`,
    [
      id,
      command.organizationId,
      planned.reason,
      planned.fingerprint,
      planned.rClass,
      planned.sourceGraphRef,
      asJson(planned.evidence),
    ],
  );
  return inserted.rows[0]!;
};

const resultKindFor = (planned: PlannedIngest): string =>
  planned.kind === "observation" ? "observation" : "review-evidence";

const loadIdempotency = async (
  client: pg.PoolClient,
  organizationId: string,
  sourceIdentity: string,
): Promise<IdempotencyRow | null> => {
  const result = await client.query<IdempotencyRow>(
    `select request_fingerprint, state, result_kind, result_ref
     from parameter_catalog.governance_command_idempotency
     where organization_id = $1
       and command_family = $2
       and idempotency_key = $3
     for update`,
    [organizationId, evidenceIngestCommandFamily, sourceIdentity],
  );
  return result.rows[0] ?? null;
};

const reserveIdempotency = async (
  client: pg.PoolClient,
  command: IngestEvidenceCommand,
  planned: PlannedIngest,
): Promise<IdempotencyRow> => {
  await client.query(
    `insert into parameter_catalog.governance_command_idempotency (
       organization_id, command_family, idempotency_key, request_fingerprint, state
     ) values ($1,$2,$3,$4,'pending')
     on conflict (organization_id, command_family, idempotency_key) do nothing`,
    [
      command.organizationId,
      evidenceIngestCommandFamily,
      command.sourceIdentity,
      planned.fingerprint,
    ],
  );
  const row = await loadIdempotency(
    client,
    command.organizationId,
    command.sourceIdentity,
  );
  if (row) return row;
  throw new Error("governance idempotency row missing after reserve");
};

const commitIdempotency = async (
  client: pg.PoolClient,
  command: IngestEvidenceCommand,
  planned: PlannedIngest,
  resultRef: string,
): Promise<void> => {
  await client.query(
    `update parameter_catalog.governance_command_idempotency
     set state = 'committed',
         result_kind = $4,
         result_ref = $5,
         committed_at = now()
     where organization_id = $1
       and command_family = $2
       and idempotency_key = $3
       and state = 'pending'`,
    [
      command.organizationId,
      evidenceIngestCommandFamily,
      command.sourceIdentity,
      resultKindFor(planned),
      resultRef,
    ],
  );
};

const finishReplay = async (
  client: pg.PoolClient,
  command: IngestEvidenceCommand,
  planned: PlannedIngest,
  replayed: Result<IngestEvidenceResult, IngestEvidenceFailure>,
): Promise<Result<IngestEvidenceResult, IngestEvidenceFailure>> => {
  if (replayed.ok) {
    await commitIdempotency(client, command, planned, replayed.value.id);
  }
  return replayed;
};

const conflictAgainstStored = (
  command: IngestEvidenceCommand,
  planned: PlannedIngest,
  observation: ObservationRow | null,
  review: ReviewEvidenceLookup,
  reserved: IdempotencyRow,
): Result<IngestEvidenceResult, IngestEvidenceFailure> => {
  if (observation) {
    return replayOrConflictObservation(observation, planned, command);
  }
  if (review.status !== "absent") {
    return replayOrRefuseReviewEvidence(review.row, planned, command);
  }
  if (planned.kind === "observation") {
    return fingerprintConflict(
      command,
      reserved.result_ref ?? command.sourceIdentity,
      reserved.request_fingerprint,
      planned.fingerprint,
    );
  }
  return overwriteRefused(
    command,
    reserved.result_ref ?? command.sourceIdentity,
  );
};

const executePlannedIngest = async (
  client: pg.PoolClient,
  command: IngestEvidenceCommand,
  planned: PlannedIngest,
): Promise<Result<IngestEvidenceResult, IngestEvidenceFailure>> => {
  const reserved = await reserveIdempotency(client, command, planned);
  const observation = await loadObservation(
    client,
    command.organizationId,
    command.sourceIdentity,
  );
  const review = await loadReviewEvidenceByIdentity(
    client,
    command.organizationId,
    command.sourceIdentity,
  );

  if (review.status === "ambiguous") {
    return overwriteRefused(command, review.row.id);
  }

  if (observation && review.status === "found") {
    return planned.kind === "observation"
      ? fingerprintConflict(
          command,
          observation.id,
          observation.evidence_fingerprint,
          planned.fingerprint,
        )
      : overwriteRefused(command, review.row.id);
  }

  if (reserved.request_fingerprint !== planned.fingerprint) {
    return conflictAgainstStored(command, planned, observation, review, reserved);
  }

  if (reserved.state === "committed" && reserved.result_ref) {
    if (observation) {
      return replayOrConflictObservation(observation, planned, command);
    }
    if (review.status === "found") {
      return replayOrRefuseReviewEvidence(review.row, planned, command);
    }
    const byRef =
      reserved.result_kind === "observation"
        ? null
        : await loadReviewEvidence(client, reserved.result_ref);
    if (byRef) {
      return replayOrRefuseReviewEvidence(byRef, planned, command);
    }
    throw new Error("committed evidence idempotency is missing its row");
  }

  if (observation) {
    return finishReplay(
      client,
      command,
      planned,
      replayOrConflictObservation(observation, planned, command),
    );
  }
  if (review.status === "found") {
    return finishReplay(
      client,
      command,
      planned,
      replayOrRefuseReviewEvidence(review.row, planned, command),
    );
  }

  if (planned.kind === "observation") {
    let stored: ObservationRow;
    try {
      stored = await insertObservation(client, command, planned);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await loadObservation(
          client,
          command.organizationId,
          command.sourceIdentity,
        );
        if (!existing) throw error;
        return finishReplay(
          client,
          command,
          planned,
          replayOrConflictObservation(existing, planned, command),
        );
      }
      const mapped = mapInsertFailure(error, command);
      if (mapped) return { ok: false, error: mapped };
      throw error;
    }
    await commitIdempotency(client, command, planned, stored.id);
    return {
      ok: true,
      value: observationResult(stored, "ingested", planned.fingerprint),
    };
  }

  let stored: ReviewEvidenceRow;
  try {
    stored = await insertReviewEvidence(client, command, planned);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await loadReviewEvidenceByIdentity(
        client,
        command.organizationId,
        command.sourceIdentity,
      );
      if (existing.status === "absent") throw error;
      return finishReplay(
        client,
        command,
        planned,
        replayOrRefuseReviewEvidence(existing.row, planned, command),
      );
    }
    const mapped = mapInsertFailure(error, command);
    if (mapped) return { ok: false, error: mapped };
    throw error;
  }
  await commitIdempotency(client, command, planned, stored.id);
  return {
    ok: true,
    value: reviewResult(stored, "ingested", planned.fingerprint),
  };
};

export const ingestEvidence = async (
  pool: pg.Pool,
  command: IngestEvidenceCommand,
): Promise<Result<IngestEvidenceResult, IngestEvidenceFailure>> => {
  const planned = planEvidenceIngest(command);
  if (!planned.ok) return planned;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await executePlannedIngest(client, command, planned.value);
    if (!result.ok) {
      await client.query("rollback");
      return result;
    }
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const mapped = mapInsertFailure(error, command);
    if (mapped) return { ok: false, error: mapped };
    throw error;
  } finally {
    client.release();
  }
};

export const createEvidenceIngest = (pool: pg.Pool): EvidenceIngest => ({
  ingest: (command) => ingestEvidence(pool, command),
});
