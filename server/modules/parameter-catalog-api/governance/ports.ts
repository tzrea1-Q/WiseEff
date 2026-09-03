import type { RegistrationCommand } from "../../parameter-governance/registration/command";
import type { RegistrationFailure } from "../../parameter-governance/registration/failures";
import type { RegistrationResult } from "../../parameter-governance/registration/result";
import type {
  GetReviewItemQuery,
  ListReviewQueueQuery,
  ReviewQueueFailure,
  ReviewQueueItem,
  ReviewQueueList,
} from "../../parameter-governance/review/types";
import type { ResolveReviewItemCommand } from "../../parameter-governance/resolveReviewItem/command";
import type { GovernanceFailure } from "../../parameter-governance/resolveReviewItem/failures";
import type { ReviewResolutionResult } from "../../parameter-governance/resolveReviewItem/result";
import type { ProposalCommand } from "../../parameter-governance/proposals/command";
import type { ProposalFailure } from "../../parameter-governance/proposals/failures";
import type { ProposalResult } from "../../parameter-governance/proposals/result";
import type { Result } from "../../parameter-catalog-contract/index";
import type { CatalogGovernancePorts } from "./types";

export type CatalogGovernanceCommandServices = {
  readonly executeRegistration: (
    command: RegistrationCommand,
  ) => Promise<Result<RegistrationResult, RegistrationFailure>>;
  readonly resolveReviewItem: (
    command: ResolveReviewItemCommand,
  ) => Promise<Result<ReviewResolutionResult, GovernanceFailure>>;
  readonly executeProposal: (
    command: ProposalCommand,
  ) => Promise<Result<ProposalResult, ProposalFailure>>;
  readonly listReviewQueue: (
    query: ListReviewQueueQuery,
  ) => Promise<Result<ReviewQueueList, ReviewQueueFailure>>;
  readonly getReviewItem: (
    query: GetReviewItemQuery,
  ) => Promise<Result<ReviewQueueItem, ReviewQueueFailure>>;
};

const emptyList = async <T>(): Promise<readonly T[]> => [];
const missing = async <T>(): Promise<T | null> => null;

export function bindCatalogGovernanceCommands(
  services: CatalogGovernanceCommandServices,
): Pick<
  CatalogGovernancePorts,
  | "executeRegistration"
  | "resolveReviewItem"
  | "executeProposal"
  | "listReviewQueue"
  | "getReviewItem"
> {
  return {
    executeRegistration: (command) => services.executeRegistration(command),
    resolveReviewItem: (command) => services.resolveReviewItem(command),
    executeProposal: (command) => services.executeProposal(command),
    listReviewQueue: (query) => services.listReviewQueue(query),
    getReviewItem: (query) => services.getReviewItem(query),
  };
}

export const emptyGovernanceQueryPorts: Pick<
  CatalogGovernancePorts,
  | "listRegistrations"
  | "getRegistration"
  | "getPlacement"
  | "listObservations"
  | "getObservation"
  | "listProposals"
  | "getProposal"
> = {
  listRegistrations: emptyList,
  getRegistration: missing,
  getPlacement: missing,
  listObservations: emptyList,
  getObservation: missing,
  listProposals: emptyList,
  getProposal: missing,
};
