import type pg from "pg";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  PublicationIntentId,
  type CatalogReleasePin,
  type DefinitionProposalStatus,
} from "../../parameter-catalog-contract/index";

import {
  proposalIdempotencyIdentity,
  type ProposalCommand,
} from "./command";
import type { ProposalFailure } from "./failures";
import { mapWriterDatabaseError } from "./failures";
import type {
  ProposalResultSnapshot,
  PublicationIntentResult,
  Result,
} from "./result";

export type ProposalWriterClient = {
  query: pg.PoolClient["query"];
};

export type IdempotencyRow = {
  request_fingerprint: string;
  state: "pending" | "committed";
  result_kind: string | null;
  result_ref: string | null;
};

export type ProposalRow = {
  id: string;
  organization_id: string;
  author_principal_id: string;
  base_catalog_release_id: string;
  base_definition_revision_id: string | null;
  status: DefinitionProposalStatus;
  current_proposal_revision_id: string;
  etag_version: string;
};

export type ProposalRevisionRow = {
  id: string;
  proposal_id: string;
  revision_number: string;
};

export type PublicationIntentRow = {
  id: string;
  proposal_id: string;
  proposal_revision_id: string;
  repository_reference: string;
  reviewer_principal_id: string;
  success_audit_ref: string;
};

export type DefinitionRevisionRef = {
  readonly id: string;
  readonly definitionId: string;
};

/** Same advisory key as Kernel current-pointer exclusive/shared guards. */
export const CURRENT_POINTER_LOCK_KEY = 688004000041;

const fail = (error: ProposalFailure): Result<never, ProposalFailure> => ({
  ok: false,
  error,
});

const proposalSelect = `id, organization_id, author_principal_id, base_catalog_release_id,
            base_definition_revision_id, status, current_proposal_revision_id,
            etag_version::text as etag_version`;

export const loadIdempotency = async (
  client: ProposalWriterClient,
  organizationId: string,
  family: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> => {
  const result = await client.query<IdempotencyRow>(
    `select request_fingerprint, state, result_kind, result_ref
     from parameter_catalog.governance_command_idempotency
     where organization_id = $1
       and command_family = $2
       and idempotency_key = $3
     for update`,
    [organizationId, family, idempotencyKey],
  );
  return result.rows[0] ?? null;
};

export const reserveIdempotency = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
  fingerprint: string,
): Promise<IdempotencyRow> => {
  const identity = proposalIdempotencyIdentity(command);
  await client.query(
    `insert into parameter_catalog.governance_command_idempotency (
       organization_id, command_family, idempotency_key, request_fingerprint, state
     ) values ($1,$2,$3,$4,'pending')
     on conflict (organization_id, command_family, idempotency_key) do nothing`,
    [command.organizationId, identity.family, identity.key, fingerprint],
  );
  const row = await loadIdempotency(
    client,
    command.organizationId,
    identity.family,
    identity.key,
  );
  if (row) return row;
  throw new Error("governance idempotency row missing after reserve");
};

export const commitIdempotency = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
  resultRef: string,
): Promise<void> => {
  const identity = proposalIdempotencyIdentity(command);
  await client.query(
    `update parameter_catalog.governance_command_idempotency
     set state = 'committed',
         result_kind = 'definition-proposal',
         result_ref = $4,
         committed_at = now()
     where organization_id = $1
       and command_family = $2
       and idempotency_key = $3
       and state = 'pending'`,
    [command.organizationId, identity.family, identity.key, resultRef],
  );
};

export const lockAndLoadCurrentRelease = async (
  client: ProposalWriterClient,
): Promise<Result<CatalogReleasePin, ProposalFailure>> => {
  const previous = await client.query<{ lock_timeout: string }>(
    "select pg_catalog.current_setting('lock_timeout') as lock_timeout",
  );
  const previousTimeout = previous.rows[0]?.lock_timeout ?? "0";
  await client.query("select pg_catalog.set_config('lock_timeout', '2s', true)");
  try {
    await client.query("select pg_catalog.pg_advisory_xact_lock_shared($1::bigint)", [
      CURRENT_POINTER_LOCK_KEY,
    ]);
  } catch (error) {
    await client
      .query("select pg_catalog.set_config('lock_timeout', $1, true)", [previousTimeout])
      .catch(() => undefined);
    const mapped = mapWriterDatabaseError(error);
    if (mapped) return fail(mapped);
    throw error;
  }
  await client.query("select pg_catalog.set_config('lock_timeout', $1, true)", [
    previousTimeout,
  ]);

  const result = await client.query<{ id: string; digest: string }>(
    `select state.current_catalog_release_id as id, release.release_digest as digest
       from parameter_catalog.catalog_state state
       join parameter_catalog.catalog_releases release
         on release.id = state.current_catalog_release_id`,
  );
  if (result.rows.length !== 1) {
    return fail({ kind: "invalid-command", reason: "currentRelease" });
  }
  return {
    ok: true,
    value: {
      id: CatalogReleaseId(result.rows[0]!.id),
      digest: CatalogReleaseDigest(result.rows[0]!.digest),
    },
  };
};

export const loadReleasePin = async (
  client: ProposalWriterClient,
  releaseId: string,
): Promise<CatalogReleasePin | null> => {
  const result = await client.query<{ digest: string }>(
    `select release_digest as digest
       from parameter_catalog.catalog_releases
      where id = $1`,
    [releaseId],
  );
  if (!result.rows[0]) return null;
  return {
    id: CatalogReleaseId(releaseId),
    digest: CatalogReleaseDigest(result.rows[0].digest),
  };
};

export const assertReleasePinExists = async (
  client: ProposalWriterClient,
  pin: CatalogReleasePin,
): Promise<Result<true, ProposalFailure>> => {
  const stored = await loadReleasePin(client, pin.id);
  if (!stored) {
    return fail({ kind: "invalid-command", reason: "baseRelease" });
  }
  if (stored.digest !== pin.digest) {
    return fail({
      kind: "proposal-stale",
      capturedRelease: pin,
      currentRelease: stored,
    });
  }
  return { ok: true, value: true };
};

export const loadDefinitionRevision = async (
  client: ProposalWriterClient,
  revisionId: string,
): Promise<DefinitionRevisionRef | null> => {
  const result = await client.query<{ id: string; definition_id: string }>(
    `select id, definition_id
       from parameter_catalog.definition_revisions
      where id = $1`,
    [revisionId],
  );
  if (!result.rows[0]) return null;
  return { id: result.rows[0].id, definitionId: result.rows[0].definition_id };
};

export const assertRevisionVisibleInRelease = async (
  client: ProposalWriterClient,
  releaseId: string,
  revisionId: string,
  expectedDefinitionId?: string | null,
): Promise<Result<DefinitionRevisionRef, ProposalFailure>> => {
  const revision = await loadDefinitionRevision(client, revisionId);
  if (!revision) {
    return fail({ kind: "invalid-command", reason: "baseDefinitionRevisionId" });
  }
  if (expectedDefinitionId != null && expectedDefinitionId !== revision.definitionId) {
    return fail({ kind: "invalid-command", reason: "baseDefinitionId" });
  }
  const head = await client.query(
    `select 1
       from parameter_catalog.catalog_release_definition_heads
      where release_id = $1
        and definition_id = $2
        and revision_id = $3`,
    [releaseId, revision.definitionId, revision.id],
  );
  if ((head.rowCount ?? 0) === 0) {
    return fail({ kind: "invalid-command", reason: "baseDefinitionRevisionId" });
  }
  return { ok: true, value: revision };
};

export const loadProposalById = async (
  client: ProposalWriterClient,
  organizationId: string,
  proposalId: string,
): Promise<ProposalRow | null> => {
  const result = await client.query<ProposalRow>(
    `select ${proposalSelect}
     from parameter_catalog.definition_proposals
     where organization_id = $1 and id = $2
     for update`,
    [organizationId, proposalId],
  );
  return result.rows[0] ?? null;
};

export const loadRevision = async (
  client: ProposalWriterClient,
  proposalId: string,
  revisionId: string,
): Promise<ProposalRevisionRow | null> => {
  const result = await client.query<ProposalRevisionRow>(
    `select id, proposal_id, revision_number::text as revision_number
     from parameter_catalog.definition_proposal_revisions
     where proposal_id = $1 and id = $2`,
    [proposalId, revisionId],
  );
  return result.rows[0] ?? null;
};

export const loadPublicationIntent = async (
  client: ProposalWriterClient,
  proposalId: string,
): Promise<PublicationIntentRow | null> => {
  const result = await client.query<PublicationIntentRow>(
    `select id, proposal_id, proposal_revision_id, repository_reference,
            reviewer_principal_id, success_audit_ref
     from parameter_catalog.catalog_publication_intents
     where proposal_id = $1`,
    [proposalId],
  );
  return result.rows[0] ?? null;
};

export const loadSuccessAuditSnapshot = async (
  client: ProposalWriterClient,
  organizationId: string,
  action: string,
  fingerprint: string,
  targetId: string,
): Promise<ProposalResultSnapshot | null> => {
  const result = await client.query<{ metadata: { resultSnapshot?: unknown } }>(
    `select metadata
       from public.audit_events
      where organization_id = $1
        and kind = 'definition-proposal'
        and action = $2
        and trace_id = $3
        and target_id = $4
      order by created_at asc
      limit 1`,
    [organizationId, action, fingerprint, targetId],
  );
  const raw = result.rows[0]?.metadata?.resultSnapshot;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snapshot = raw as ProposalResultSnapshot;
  if (
    typeof snapshot.proposalId !== "string" ||
    typeof snapshot.proposalRevisionId !== "string" ||
    typeof snapshot.revisionNumber !== "number" ||
    typeof snapshot.status !== "string" ||
    typeof snapshot.etagVersion !== "number"
  ) {
    return null;
  }
  return {
    proposalId: DefinitionProposalId(snapshot.proposalId),
    proposalRevisionId: DefinitionProposalRevisionId(snapshot.proposalRevisionId),
    revisionNumber: snapshot.revisionNumber,
    status: snapshot.status,
    etagVersion: snapshot.etagVersion,
    organizationId: snapshot.organizationId,
    baseCatalogReleaseId: snapshot.baseCatalogReleaseId,
    baseDefinitionRevisionId: snapshot.baseDefinitionRevisionId,
    publicationIntent: snapshot.publicationIntent
      ? {
          id: PublicationIntentId(snapshot.publicationIntent.id),
          repositoryReference: snapshot.publicationIntent.repositoryReference,
          reviewerPrincipalId: snapshot.publicationIntent.reviewerPrincipalId,
          successAuditRef: snapshot.publicationIntent.successAuditRef,
        }
      : null,
  };
};

export const insertProposal = async (
  client: ProposalWriterClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly authorPrincipalId: string;
    readonly baseCatalogReleaseId: string;
    readonly baseDefinitionRevisionId: string | null;
    readonly currentProposalRevisionId: string;
    readonly status: DefinitionProposalStatus;
  },
): Promise<ProposalRow> => {
  const result = await client.query<ProposalRow>(
    `insert into parameter_catalog.definition_proposals (
       id, organization_id, author_principal_id, base_catalog_release_id,
       base_definition_revision_id, status, current_proposal_revision_id, etag_version
     ) values ($1,$2,$3,$4,$5,$6,$7,1)
     returning ${proposalSelect}`,
    [
      input.id,
      input.organizationId,
      input.authorPrincipalId,
      input.baseCatalogReleaseId,
      input.baseDefinitionRevisionId,
      input.status,
      input.currentProposalRevisionId,
    ],
  );
  return result.rows[0]!;
};

export const insertProposalRevision = async (
  client: ProposalWriterClient,
  input: {
    readonly id: string;
    readonly proposalId: string;
    readonly payload: string;
    readonly reason: string;
    readonly evidenceRefs: string;
  },
): Promise<ProposalRevisionRow> => {
  const result = await client.query<ProposalRevisionRow>(
    `insert into parameter_catalog.definition_proposal_revisions (
       id, proposal_id, revision_number, payload, reason, evidence_refs
     ) values ($1,$2,1,$3::jsonb,$4,$5::jsonb)
     returning id, proposal_id, revision_number::text as revision_number`,
    [input.id, input.proposalId, input.payload, input.reason, input.evidenceRefs],
  );
  return result.rows[0]!;
};

export const updateProposalStatus = async (
  client: ProposalWriterClient,
  proposalId: string,
  status: DefinitionProposalStatus,
  expectedEtag: number,
  nextEtag: number,
): Promise<ProposalRow | null> => {
  const result = await client.query<ProposalRow>(
    `update parameter_catalog.definition_proposals
     set status = $2, etag_version = $3, updated_at = now()
     where id = $1 and etag_version = $4
     returning ${proposalSelect}`,
    [proposalId, status, nextEtag, expectedEtag],
  );
  return result.rows[0] ?? null;
};

export const insertPublicationIntent = async (
  client: ProposalWriterClient,
  input: {
    readonly id: string;
    readonly proposalId: string;
    readonly proposalRevisionId: string;
    readonly baseCatalogReleaseId: string;
    readonly repositoryReference: string;
    readonly reviewerPrincipalId: string;
    readonly successAuditRef: string;
  },
): Promise<PublicationIntentRow> => {
  const result = await client.query<PublicationIntentRow>(
    `insert into parameter_catalog.catalog_publication_intents (
       id, proposal_id, proposal_revision_id, base_catalog_release_id,
       repository_reference, reviewer_principal_id, success_audit_ref
     ) values ($1,$2,$3,$4,$5,$6,$7)
     returning id, proposal_id, proposal_revision_id, repository_reference,
               reviewer_principal_id, success_audit_ref`,
    [
      input.id,
      input.proposalId,
      input.proposalRevisionId,
      input.baseCatalogReleaseId,
      input.repositoryReference,
      input.reviewerPrincipalId,
      input.successAuditRef,
    ],
  );
  return result.rows[0]!;
};

export const intentResult = (row: PublicationIntentRow): PublicationIntentResult => ({
  id: PublicationIntentId(row.id),
  repositoryReference: row.repository_reference,
  reviewerPrincipalId: row.reviewer_principal_id,
  successAuditRef: row.success_audit_ref,
});
