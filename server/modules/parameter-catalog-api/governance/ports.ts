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
import type { GovernanceCatalogQueries } from "../../parameter-governance/queries";
import type { Result } from "../../parameter-catalog-contract/index";
import { CatalogGovernanceQueryError } from "./errors";
import type { CatalogGovernancePorts, CatalogGovernanceQueryScope } from "./types";

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

const requirePrincipal = (input: CatalogGovernanceQueryScope, operation: string): string => {
  if (!input.principalId) {
    throw new CatalogGovernanceQueryError({ kind: "invalid-query", reason: "principalId", operation });
  }
  return input.principalId;
};

const authScope = (input: CatalogGovernanceQueryScope, operation: string) => ({
  organizationId: input.organizationId,
  principalId: requirePrincipal(input, operation),
});

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

/** Test-only empty governance query ports. Must not be the production pool default. */
export const emptyGovernanceQueryPortsForTests: Pick<
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

/** @deprecated Test constructor. Use emptyGovernanceQueryPortsForTests. */
export const emptyGovernanceQueryPorts = emptyGovernanceQueryPortsForTests;

const unavailableQuery = (operation: string): never => {
  throw new CatalogGovernanceQueryError({ kind: "query-unavailable", operation });
};

export const unavailableGovernanceQueryPorts: Pick<
  CatalogGovernancePorts,
  | "listRegistrations"
  | "getRegistration"
  | "getPlacement"
  | "listObservations"
  | "getObservation"
  | "listProposals"
  | "getProposal"
> = {
  listRegistrations: async () => unavailableQuery("listRegistrations"),
  getRegistration: async () => unavailableQuery("getRegistration"),
  getPlacement: async () => unavailableQuery("getPlacement"),
  listObservations: async () => unavailableQuery("listObservations"),
  getObservation: async () => unavailableQuery("getObservation"),
  listProposals: async () => unavailableQuery("listProposals"),
  getProposal: async () => unavailableQuery("getProposal"),
};

export function bindGovernanceCatalogQueryPorts(
  queries: GovernanceCatalogQueries,
): Pick<
  CatalogGovernancePorts,
  | "listRegistrations"
  | "getRegistration"
  | "getPlacement"
  | "listObservations"
  | "getObservation"
  | "listProposals"
  | "getProposal"
> {
  return {
    async listRegistrations(input) {
      const result = await queries.listRegistrations({
        organizationId: input.organizationId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "listRegistrations"),
      });
      if (!result.ok) throw new CatalogGovernanceQueryError(result.error);
      return result.value.items;
    },
    async getRegistration(input) {
      const result = await queries.getRegistration({
        organizationId: input.organizationId,
        registrationId: input.registrationId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "getRegistration"),
      });
      if (!result.ok) {
        if (result.error.kind === "not-found") return null;
        throw new CatalogGovernanceQueryError(result.error);
      }
      return result.value;
    },
    async getPlacement(input) {
      const result = await queries.getPlacement({
        organizationId: input.organizationId,
        registrationId: input.registrationId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "getPlacement"),
      });
      if (!result.ok) {
        if (result.error.kind === "not-found") return null;
        throw new CatalogGovernanceQueryError(result.error);
      }
      return result.value;
    },
    async listObservations(input) {
      const result = await queries.listObservations({
        organizationId: input.organizationId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "listObservations"),
      });
      if (!result.ok) throw new CatalogGovernanceQueryError(result.error);
      return result.value.items;
    },
    async getObservation(input) {
      const result = await queries.getObservation({
        organizationId: input.organizationId,
        observationId: input.observationId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "getObservation"),
      });
      if (!result.ok) {
        if (result.error.kind === "not-found") return null;
        throw new CatalogGovernanceQueryError(result.error);
      }
      return result.value;
    },
    async listProposals(input) {
      const result = await queries.listProposals({
        organizationId: input.organizationId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "listProposals"),
      });
      if (!result.ok) throw new CatalogGovernanceQueryError(result.error);
      return result.value.items;
    },
    async getProposal(input) {
      const result = await queries.getProposal({
        organizationId: input.organizationId,
        proposalId: input.proposalId,
        observedCatalogReleaseId: input.catalogReleaseId,
        authScope: authScope(input, "getProposal"),
      });
      if (!result.ok) {
        if (result.error.kind === "not-found") return null;
        throw new CatalogGovernanceQueryError(result.error);
      }
      return result.value;
    },
  };
}
