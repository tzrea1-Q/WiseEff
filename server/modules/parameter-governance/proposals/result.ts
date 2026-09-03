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

export type ProposalResult = {
  readonly outcome: "committed" | "replayed";
  readonly proposalId: DefinitionProposalId;
  readonly proposalRevisionId: DefinitionProposalRevisionId;
  readonly revisionNumber: number;
  readonly status: DefinitionProposalStatus;
  readonly etagVersion: number;
  readonly organizationId: string;
  readonly baseCatalogReleaseId: string;
  readonly baseDefinitionRevisionId: string | null;
  readonly fingerprint: string;
  readonly idempotencyKey: string;
  readonly publicationIntent: PublicationIntentResult | null;
};
