import type {
  DefinitionProposalId,
  DefinitionProposalRevisionId,
  DefinitionProposalStatus,
  PublicationIntentId,
  Result as ContractResult,
} from "../../parameter-catalog-contract/index";

export type Result<T, E> = ContractResult<T, E>;

export type PublicationIntentResult = {
  readonly id: PublicationIntentId;
  readonly repositoryReference: string;
  readonly reviewerPrincipalId: string;
  readonly successAuditRef: string;
};

export type ProposalResultSnapshot = {
  readonly proposalId: DefinitionProposalId;
  readonly proposalRevisionId: DefinitionProposalRevisionId;
  readonly revisionNumber: number;
  readonly status: DefinitionProposalStatus;
  readonly etagVersion: number;
  readonly organizationId: string;
  readonly baseCatalogReleaseId: string;
  readonly baseDefinitionRevisionId: string | null;
  readonly publicationIntent: PublicationIntentResult | null;
};

export type ProposalResult = ProposalResultSnapshot & {
  readonly outcome: "committed" | "replayed";
  readonly fingerprint: string;
  readonly idempotencyKey: string;
};
