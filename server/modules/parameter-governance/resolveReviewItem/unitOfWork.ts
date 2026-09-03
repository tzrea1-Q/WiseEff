import { randomUUID } from "node:crypto";
import pg from "pg";

import {
  CatalogSubjectId,
  DefinitionProposalId,
  ReviewItemEtag,
  ReviewItemId,
  ReviewResolutionId,
  SubjectPlacementId,
  SubjectRegistrationId,
  type CatalogReleasePin,
  type LegacyRowClass,
  type ReviewReason,
  type ReviewResolutionType,
} from "../../parameter-catalog-contract/index";
import { fingerprintCanonical } from "../review/fingerprint";
import type {
  ReviewEvidenceRecord,
  StoredReviewEvidenceBody,
} from "../review/types";

import { reviewResolutionCommandFamily, type ResolveReviewItemCommand } from "./command";
import type { ReviewResolutionResult, Result } from "./result";

export type ReviewResolutionWriterClient = {
  query: pg.PoolClient["query"];
};

const reviewReasons = new Set<ReviewReason>([
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed",
]);

type IdempotencyRow = {
  request_fingerprint: string;
  state: "pending" | "committed";
  result_kind: string | null;
  result_ref: string | null;
};

export type ReviewItemRow = {
  id: string;
  organization_id: string;
  evidence_fingerprint: string;
  matcher_revision: string;
  catalog_release_id: string;
  reason: ReviewReason;
  status: "open" | "resolved" | "out-of-scope";
  etag_version: string;
  current_resolution_id: string | null;
};

type ResolutionRow = {
  id: string;
  review_item_id: string;
  resolution_type: ReviewResolutionType;
  before_etag_version: string;
  after_etag_version: string;
  captured_catalog_release_id: string;
  request_fingerprint: string;
  registration_id: string | null;
  proposal_id: string | null;
  out_of_scope_reason: string | null;
  success_audit_ref: string;
};

type RegistrationPairRow = {
  registration_id: string;
  subject_id: string;
  placement_id: string;
};

type EvidenceRow = {
  id: string;
  organization_id: string;
  reason: ReviewReason;
  candidate_safe_digest: string;
  r_class: LegacyRowClass | null;
  source_graph_ref: string | null;
  evidence: unknown;
};

const isUsableToken = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

const parseStoredEvidence = (value: unknown): StoredReviewEvidenceBody | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isUsableToken(body.sourceIdentity) || !isUsableToken(body.catalogReleaseId)) return null;
  if (!isUsableToken(body.matcherRevision)) return null;
  if (typeof body.reason !== "string" || !reviewReasons.has(body.reason as ReviewReason)) {
    return null;
  }
  const payload =
    body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as StoredReviewEvidenceBody["payload"])
      : {};
  return {
    sourceIdentity: body.sourceIdentity,
    catalogReleaseId: body.catalogReleaseId,
    matcherRevision: body.matcherRevision,
    matcherOutput: typeof body.matcherOutput === "string" ? body.matcherOutput : "",
    reason: body.reason as ReviewReason,
    rClass: (body.rClass as LegacyRowClass | null) ?? null,
    sourceGraphRef: typeof body.sourceGraphRef === "string" ? body.sourceGraphRef : null,
    payload,
  };
};

export const withReviewResolutionUnitOfWork = async <T, E>(
  pool: pg.Pool,
  work: (client: ReviewResolutionWriterClient) => Promise<Result<T, E>>,
): Promise<Result<T, E>> => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set constraints all deferred");
    try {
      const result = await work(client);
      if (!result.ok) {
        await client.query("rollback");
        return result;
      }
      await client.query("set constraints all immediate");
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
};

const loadIdempotency = async (
  client: ReviewResolutionWriterClient,
  organizationId: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> => {
  const result = await client.query<IdempotencyRow>(
    `select request_fingerprint, state, result_kind, result_ref
       from parameter_catalog.governance_command_idempotency
      where organization_id = $1
        and command_family = $2
        and idempotency_key = $3
      for update`,
    [organizationId, reviewResolutionCommandFamily, idempotencyKey],
  );
  return result.rows[0] ?? null;
};

export const reserveIdempotency = async (
  client: ReviewResolutionWriterClient,
  command: ResolveReviewItemCommand,
  fingerprint: string,
): Promise<IdempotencyRow> => {
  await client.query(
    `insert into parameter_catalog.governance_command_idempotency (
       organization_id, command_family, idempotency_key, request_fingerprint, state
     ) values ($1,$2,$3,$4,'pending')
     on conflict (organization_id, command_family, idempotency_key) do nothing`,
    [
      command.organizationId,
      reviewResolutionCommandFamily,
      command.idempotencyKey,
      fingerprint,
    ],
  );
  const row = await loadIdempotency(
    client,
    command.organizationId,
    command.idempotencyKey,
  );
  if (row) return row;
  throw new Error("governance idempotency row missing after reserve");
};

export const commitIdempotency = async (
  client: ReviewResolutionWriterClient,
  command: ResolveReviewItemCommand,
  resultRef: string,
): Promise<void> => {
  await client.query(
    `update parameter_catalog.governance_command_idempotency
        set state = 'committed',
            result_kind = 'review-resolution',
            result_ref = $4,
            committed_at = now()
      where organization_id = $1
        and command_family = $2
        and idempotency_key = $3
        and state = 'pending'`,
    [
      command.organizationId,
      reviewResolutionCommandFamily,
      command.idempotencyKey,
      resultRef,
    ],
  );
};

export const lockReviewItem = async (
  client: ReviewResolutionWriterClient,
  organizationId: string,
  reviewItemId: string,
): Promise<ReviewItemRow | null> => {
  const result = await client.query<ReviewItemRow>(
    `select id, organization_id, evidence_fingerprint, matcher_revision,
            catalog_release_id, reason, status, etag_version::text, current_resolution_id
       from parameter_catalog.parameter_review_items
      where organization_id = $1 and id = $2
      for update`,
    [organizationId, reviewItemId],
  );
  return result.rows[0] ?? null;
};

export const loadEvidenceRecords = async (
  client: ReviewResolutionWriterClient,
  organizationId: string,
): Promise<ReviewEvidenceRecord[]> => {
  const result = await client.query<EvidenceRow>(
    `select id, organization_id, reason, candidate_safe_digest, r_class, source_graph_ref, evidence
       from parameter_catalog.parameter_review_evidence
      where organization_id = $1`,
    [organizationId],
  );
  const records: ReviewEvidenceRecord[] = [];
  for (const row of result.rows) {
    const evidence = parseStoredEvidence(row.evidence);
    if (!evidence) continue;
    records.push({
      id: row.id,
      organizationId: row.organization_id,
      reason: row.reason,
      candidateSafeDigest: row.candidate_safe_digest,
      rClass: row.r_class,
      sourceGraphRef: row.source_graph_ref,
      evidence,
    });
  }
  return records;
};

export const fingerprintResolvedItem = (input: {
  readonly id: string;
  readonly etagVersion: number;
  readonly status: "resolved" | "out-of-scope";
  readonly groupingFingerprint: string;
  readonly catalogReleaseId: string;
  readonly matcherRevision: string;
  readonly reason: ReviewReason;
  readonly resolutionId: string;
}): ReviewItemEtag =>
  ReviewItemEtag(
    fingerprintCanonical({
      kind: "review-resolution-etag",
      id: input.id,
      etagVersion: input.etagVersion,
      status: input.status,
      groupingFingerprint: input.groupingFingerprint,
      catalogReleaseId: input.catalogReleaseId,
      matcherRevision: input.matcherRevision,
      reason: input.reason,
      resolutionId: input.resolutionId,
    }),
  );

export const insertSuccessAudit = async (
  client: ReviewResolutionWriterClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly reviewItemId: string;
    readonly resolutionId: string;
    readonly resolutionType: ReviewResolutionType;
    readonly fingerprint: string;
  },
): Promise<void> => {
  await client.query(
    `insert into public.audit_events (
       id, organization_id, actor_type, app, kind, action, severity,
       target_type, target_id, metadata, trace_id
     ) values (
       $1,$2,'user','parameter-governance','parameter-catalog-governance',
       'review-item-resolved','info','review-item',$3,$4::jsonb,$5
     )`,
    [
      input.id,
      input.organizationId,
      input.reviewItemId,
      JSON.stringify({
        resolutionId: input.resolutionId,
        resolutionType: input.resolutionType,
        fingerprint: input.fingerprint,
      }),
      input.resolutionId,
    ],
  );
};

export const insertResolution = async (
  client: ReviewResolutionWriterClient,
  input: {
    readonly id: string;
    readonly reviewItemId: string;
    readonly resolutionType: ReviewResolutionType;
    readonly beforeEtagVersion: number;
    readonly afterEtagVersion: number;
    readonly principalId: string;
    readonly capturedReleaseId: string;
    readonly requestFingerprint: string;
    readonly registrationId: string | null;
    readonly proposalId: string | null;
    readonly outOfScopeReason: string | null;
    readonly successAuditRef: string;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.parameter_review_resolutions (
       id, review_item_id, resolution_type, before_etag_version, after_etag_version,
       accountable_principal_id, initiator_type, captured_catalog_release_id,
       request_fingerprint, registration_id, proposal_id, out_of_scope_reason,
       success_audit_ref
     ) values ($1,$2,$3,$4,$5,$6,'user',$7,$8,$9,$10,$11,$12)`,
    [
      input.id,
      input.reviewItemId,
      input.resolutionType,
      input.beforeEtagVersion,
      input.afterEtagVersion,
      input.principalId,
      input.capturedReleaseId,
      input.requestFingerprint,
      input.registrationId,
      input.proposalId,
      input.outOfScopeReason,
      input.successAuditRef,
    ],
  );
};

export const updateReviewItem = async (
  client: ReviewResolutionWriterClient,
  reviewItemId: string,
  status: "resolved" | "out-of-scope",
  resolutionId: string,
  etagVersion: number,
): Promise<void> => {
  await client.query(
    `update parameter_catalog.parameter_review_items
        set status = $2,
            current_resolution_id = $3,
            etag_version = $4,
            updated_at = now()
      where id = $1`,
    [reviewItemId, status, resolutionId, etagVersion],
  );
};

export const insertDraftProposal = async (
  client: ReviewResolutionWriterClient,
  command: Extract<ResolveReviewItemCommand, { resolution: "open-definition-proposal" }>,
): Promise<string> => {
  const proposalId = `dprp_${randomUUID()}`;
  const revisionId = `dprv_${randomUUID()}`;
  await client.query(
    `insert into parameter_catalog.definition_proposals (
       id, organization_id, author_principal_id, base_catalog_release_id,
       status, current_proposal_revision_id, etag_version
     ) values ($1,$2,$3,$4,'draft',$5,1)`,
    [
      proposalId,
      command.organizationId,
      command.context.actorKind === "org-admin" ? command.context.principalId : "unknown",
      command.expectedRelease.id,
      revisionId,
    ],
  );
  await client.query(
    `insert into parameter_catalog.definition_proposal_revisions (
       id, proposal_id, revision_number, payload, reason, evidence_refs
     ) values ($1,$2,1,$3::jsonb,$4,'[]'::jsonb)`,
    [
      revisionId,
      proposalId,
      JSON.stringify(command.proposal.payload ?? {}),
      command.proposal.reason,
    ],
  );
  return proposalId;
};

const loadRegistrationPair = async (
  client: ReviewResolutionWriterClient,
  organizationId: string,
  registrationId: string,
): Promise<RegistrationPairRow | null> => {
  const result = await client.query<RegistrationPairRow>(
    `select r.id as registration_id,
            r.subject_id,
            p.id as placement_id
       from parameter_catalog.organization_subject_registrations r
       join parameter_catalog.subject_placements p
         on p.id = r.current_placement_id
      where r.organization_id = $1 and r.id = $2`,
    [organizationId, registrationId],
  );
  return result.rows[0] ?? null;
};

export const loadStoredResult = async (
  client: ReviewResolutionWriterClient,
  command: ResolveReviewItemCommand,
  resolutionId: string,
  fingerprint: string,
): Promise<ReviewResolutionResult | null> => {
  const resolution = await client.query<ResolutionRow>(
    `select id, review_item_id, resolution_type, before_etag_version::text, after_etag_version::text,
            captured_catalog_release_id, request_fingerprint, registration_id, proposal_id,
            out_of_scope_reason, success_audit_ref
       from parameter_catalog.parameter_review_resolutions
      where id = $1`,
    [resolutionId],
  );
  const stored = resolution.rows[0];
  if (!stored) return null;
  const item = await lockReviewItem(client, command.organizationId, stored.review_item_id);
  if (!item) return null;
  const status = item.status === "out-of-scope" ? "out-of-scope" : "resolved";
  const afterEtag = fingerprintResolvedItem({
    id: item.id,
    etagVersion: Number(item.etag_version),
    status,
    groupingFingerprint: item.evidence_fingerprint,
    catalogReleaseId: item.catalog_release_id,
    matcherRevision: item.matcher_revision,
    reason: item.reason,
    resolutionId: stored.id,
  });
  const result: ReviewResolutionResult = {
    outcome: "replayed",
    reviewItemId: ReviewItemId(item.id),
    resolutionId: ReviewResolutionId(stored.id),
    resolutionType: stored.resolution_type,
    organizationId: item.organization_id,
    status,
    etag: afterEtag,
    beforeEtag: command.etag,
    release: command.expectedRelease,
    idempotencyKey: command.idempotencyKey,
    fingerprint,
    successAuditRef: stored.success_audit_ref,
  };
  if (stored.registration_id) {
    const pair = await loadRegistrationPair(
      client,
      command.organizationId,
      stored.registration_id,
    );
    if (!pair) return null;
    return {
      ...result,
      registrationId: SubjectRegistrationId(pair.registration_id),
      placementId: SubjectPlacementId(pair.placement_id),
      subjectId: CatalogSubjectId(pair.subject_id),
    };
  }
  if (stored.proposal_id) {
    return {
      ...result,
      proposalId: DefinitionProposalId(stored.proposal_id),
    };
  }
  return result;
};

export const recordDurableRefusal = async (
  pool: pg.Pool,
  organizationId: string,
  error: { readonly kind: string },
  reviewItemId: string | undefined,
): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query(
      `insert into public.audit_events (
         id, organization_id, actor_type, app, kind, action, severity,
         target_type, target_id, metadata, trace_id
       ) values (
         $1,$2,'user','parameter-governance','parameter-catalog-governance',
         'review-resolution-refused','warning','review-item',$3,$4::jsonb,$5
       )`,
      [
        `aud_${randomUUID()}`,
        organizationId,
        reviewItemId ?? organizationId,
        JSON.stringify({ failureKind: error.kind }),
        `refuse:${randomUUID()}`,
      ],
    );
  } catch (caught) {
    if (caught instanceof pg.DatabaseError && caught.code === "23503") return;
    throw caught;
  } finally {
    client.release();
  }
};
