import { DefinitionProposalId } from "../../parameter-catalog-contract/index";

import { assertOrgScope, fail, isUsableToken, runQuery } from "./client";
import { emptyReasonForView, mapProposalStatus } from "./mapping";
import type {
  GetProposalQuery,
  GovernanceProposalRecord,
  GovernanceQueryable,
  GovernanceQueryFailure,
  ListProposalsQuery,
  ProposalList,
  Result,
} from "./types";
import { GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "./types";

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

type ProposalJoinRow = {
  id: string;
  organization_id: string;
  author_principal_id: string;
  base_catalog_release_id: string;
  base_definition_revision_id: string | null;
  base_definition_id: string | null;
  status: string;
  current_proposal_revision_id: string;
  etag_version: string;
  created_at: Date | string;
  revision_id: string | null;
  payload: unknown;
  intent_id: string | null;
  reviewer_principal_id: string | null;
};

const proposalSelect = `
  select
    proposal.id,
    proposal.organization_id,
    proposal.author_principal_id,
    proposal.base_catalog_release_id,
    proposal.base_definition_revision_id,
    definition_revision.definition_id as base_definition_id,
    proposal.status,
    proposal.current_proposal_revision_id,
    proposal.etag_version::text as etag_version,
    proposal.created_at,
    revision.id as revision_id,
    revision.payload,
    intent.id as intent_id,
    intent.reviewer_principal_id
  from parameter_catalog.definition_proposals proposal
  left join parameter_catalog.definition_proposal_revisions revision
    on revision.proposal_id = proposal.id
   and revision.id = proposal.current_proposal_revision_id
  left join parameter_catalog.catalog_publication_intents intent
    on intent.proposal_id = proposal.id
  left join parameter_catalog.definition_revisions definition_revision
    on definition_revision.id = proposal.base_definition_revision_id
`;

const requestedChangeFromPayload = (
  payload: unknown,
): { readonly kind: string; readonly [key: string]: unknown } => {
  if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const kind =
      typeof record.kind === "string" && isUsableToken(record.kind)
        ? record.kind
        : "definition-proposal";
    return { ...record, kind };
  }
  return { kind: "definition-proposal" };
};

const mapProposal = (
  row: ProposalJoinRow,
): Result<GovernanceProposalRecord, GovernanceQueryFailure> => {
  if (!row.revision_id) {
    return fail({
      kind: "missing-required-relation",
      resource: "proposal-revision",
      id: row.id,
    });
  }
  const status = mapProposalStatus(row.status);
  if (!status) {
    return fail({ kind: "invalid-query", reason: "proposal-status-literal" });
  }
  const version = Number(row.etag_version);
  return {
    ok: true,
    value: {
      id: DefinitionProposalId(row.id),
      organizationId: row.organization_id,
      status,
      version,
      etag: `${row.id}-v${version}`,
      base: {
        catalogReleaseId: row.base_catalog_release_id,
        definitionId: row.base_definition_id,
        definitionRevisionId: row.base_definition_revision_id,
      },
      createdAt: toIso(row.created_at),
      requestedChange: requestedChangeFromPayload(row.payload),
      submittedByPersonId: row.author_principal_id,
      acceptedByPersonId: row.reviewer_principal_id,
      publicationIntentRef: row.intent_id,
    },
  };
};

export const PROPOSAL_LIST_DEFAULT_LIMIT = 50;
export const PROPOSAL_LIST_MAX_LIMIT = 200;

export const listProposals = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: ListProposalsQuery,
): Promise<Result<ProposalList, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (!isUsableToken(query.observedCatalogReleaseId)) {
    return fail({ kind: "invalid-query", reason: "observedCatalogReleaseId" });
  }
  return runQuery(source, "listProposals", async (client) => {
    // Newest first and bounded: the panel pages this list, so an unbounded
    // organization-wide projection would hide the current draft behind older
    // rows. `observedCatalogReleaseId` names the release the caller is viewing.
    const requested = query.limit ?? PROPOSAL_LIST_DEFAULT_LIMIT;
    const limit = Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, PROPOSAL_LIST_MAX_LIMIT)
      : PROPOSAL_LIST_DEFAULT_LIMIT;
    // Newest first and bounded. The list stays organization-wide on purpose: a
    // proposal raised against an earlier release must remain reachable so its
    // author can still withdraw it after the catalog advances. Bounding is what
    // keeps a long-lived lane from hiding the current draft behind older rows.
    const result = await client.query<ProposalJoinRow>(
      `${proposalSelect}
        where proposal.organization_id = $1
        order by proposal.created_at desc, proposal.id desc
        limit $2`,
      [query.organizationId, limit],
    );
    const items: GovernanceProposalRecord[] = [];
    for (const row of result.rows) {
      const mapped = mapProposal(row);
      if (!mapped.ok) return mapped;
      items.push(mapped.value);
    }
    return {
      ok: true,
      value: {
        semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS,
        items,
        emptyReason: emptyReasonForView("proposals", items.length, false),
      },
    };
  });
};

export const getProposal = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: GetProposalQuery,
): Promise<Result<GovernanceProposalRecord, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (!isUsableToken(query.proposalId) || !isUsableToken(query.observedCatalogReleaseId)) {
    return fail({ kind: "invalid-query", reason: "proposalId" });
  }
  return runQuery(source, "getProposal", async (client) => {
    const result = await client.query<ProposalJoinRow>(
      `${proposalSelect}
        where proposal.organization_id = $1
          and proposal.id = $2`,
      [query.organizationId, query.proposalId],
    );
    const row = result.rows[0];
    if (!row) {
      return fail({ kind: "not-found", resource: "proposal" });
    }
    return mapProposal(row);
  });
};
