import type pg from "pg";

import type { DefinitionProposalStatus } from "../../parameter-catalog-contract/index";

import type { ProposalCommand } from "./command";
import { proposalCommandFamily } from "./command";

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

export const loadIdempotency = async (
  client: ProposalWriterClient,
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
    [organizationId, proposalCommandFamily, idempotencyKey],
  );
  return result.rows[0] ?? null;
};

export const reserveIdempotency = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
  fingerprint: string,
): Promise<IdempotencyRow> => {
  await client.query(
    `insert into parameter_catalog.governance_command_idempotency (
       organization_id, command_family, idempotency_key, request_fingerprint, state
     ) values ($1,$2,$3,$4,'pending')
     on conflict (organization_id, command_family, idempotency_key) do nothing`,
    [command.organizationId, proposalCommandFamily, command.idempotencyKey, fingerprint],
  );
  const row = await loadIdempotency(client, command.organizationId, command.idempotencyKey);
  if (row) return row;
  throw new Error("governance idempotency row missing after reserve");
};

export const commitIdempotency = async (
  client: ProposalWriterClient,
  command: ProposalCommand,
  resultRef: string,
): Promise<void> => {
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
    [
      command.organizationId,
      proposalCommandFamily,
      command.idempotencyKey,
      resultRef,
    ],
  );
};

export const loadProposalById = async (
  client: ProposalWriterClient,
  organizationId: string,
  proposalId: string,
): Promise<ProposalRow | null> => {
  const result = await client.query<ProposalRow>(
    `select id, organization_id, author_principal_id, base_catalog_release_id,
            base_definition_revision_id, status, current_proposal_revision_id,
            etag_version::text as etag_version
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

export const insertProposal = async (
  client: ProposalWriterClient,
  input: {
    readonly id: string;
    readonly organizationId: string;
    readonly authorPrincipalId: string;
    readonly baseCatalogReleaseId: string;
    readonly baseDefinitionRevisionId: string;
    readonly currentProposalRevisionId: string;
  },
): Promise<ProposalRow> => {
  const result = await client.query<ProposalRow>(
    `insert into parameter_catalog.definition_proposals (
       id, organization_id, author_principal_id, base_catalog_release_id,
       base_definition_revision_id, status, current_proposal_revision_id, etag_version
     ) values ($1,$2,$3,$4,$5,'submitted',$6,1)
     returning id, organization_id, author_principal_id, base_catalog_release_id,
               base_definition_revision_id, status, current_proposal_revision_id,
               etag_version::text as etag_version`,
    [
      input.id,
      input.organizationId,
      input.authorPrincipalId,
      input.baseCatalogReleaseId,
      input.baseDefinitionRevisionId,
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
  etagVersion: number,
): Promise<ProposalRow> => {
  const result = await client.query<ProposalRow>(
    `update parameter_catalog.definition_proposals
     set status = $2, etag_version = $3, updated_at = now()
     where id = $1
     returning id, organization_id, author_principal_id, base_catalog_release_id,
               base_definition_revision_id, status, current_proposal_revision_id,
               etag_version::text as etag_version`,
    [proposalId, status, etagVersion],
  );
  return result.rows[0]!;
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
