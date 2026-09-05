import type pg from "pg";

import { getObservation, listObservations } from "./observations";
import { getProposal, listProposals } from "./proposals";
import {
  getPlacement,
  getRegistration,
  listRegistrations,
  projectRegistrations,
  selectDefinitionIds,
  selectSubjectIds,
} from "./registration";
import type {
  DefinitionIdSelection,
  DefinitionSelectionQuery,
  GetObservationQuery,
  GetPlacementQuery,
  GetProposalQuery,
  GetRegistrationQuery,
  GovernanceObservationRecord,
  GovernancePlacementRecord,
  GovernanceProposalRecord,
  GovernanceQueryable,
  GovernanceQueryFailure,
  GovernanceRegistrationRecord,
  ListObservationsQuery,
  ListProposalsQuery,
  ListRegistrationsQuery,
  ObservationList,
  ProjectRegistrationsQuery,
  ProposalList,
  RegistrationList,
  RegistrationProjectionPage,
  RegistrationSelectionQuery,
  Result,
  SubjectIdSelection,
} from "./types";

export { emptyReasonForView } from "./mapping";
export {
  mapObservationRecognition,
  mapProposalStatus,
  mapRegistrationMethod,
  mapRegistrationStatus,
} from "./mapping";
export { GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "./types";
export type {
  CatalogDefinitionIndexEntry,
  CatalogQueryEmptyReason,
  CatalogQueryView,
  CatalogRegistrationProjection,
  DefinitionIdSelection,
  DefinitionSelectionQuery,
  GetObservationQuery,
  GetPlacementQuery,
  GetProposalQuery,
  GetRegistrationQuery,
  GovernanceCurrentProjectionSemantics,
  GovernanceObservationRecord,
  GovernancePlacementRecord,
  GovernanceProposalRecord,
  GovernanceQueryable,
  GovernanceQueryAuthScope,
  GovernanceQueryFailure,
  GovernanceRegistrationRecord,
  ListObservationsQuery,
  ListProposalsQuery,
  ListRegistrationsQuery,
  ObservationList,
  ObservationRecognition,
  ProjectRegistrationsQuery,
  ProposalList,
  RegistrationFilter,
  RegistrationHttpMethod,
  RegistrationHttpStatus,
  RegistrationList,
  RegistrationProjectionPage,
  RegistrationSelectionQuery,
  Result,
  SubjectIdSelection,
  SubjectRegistrationProjection,
} from "./types";

export type GovernanceQueryClient = pg.Pool | pg.PoolClient | GovernanceQueryable;

export type GovernanceCatalogQueries = {
  readonly projectRegistrations: (
    query: ProjectRegistrationsQuery,
  ) => Promise<Result<RegistrationProjectionPage, GovernanceQueryFailure>>;
  readonly selectSubjectIds: (
    query: RegistrationSelectionQuery,
  ) => Promise<Result<SubjectIdSelection, GovernanceQueryFailure>>;
  readonly selectDefinitionIds: (
    query: DefinitionSelectionQuery,
  ) => Promise<Result<DefinitionIdSelection, GovernanceQueryFailure>>;
  readonly listRegistrations: (
    query: ListRegistrationsQuery,
  ) => Promise<Result<RegistrationList, GovernanceQueryFailure>>;
  readonly getRegistration: (
    query: GetRegistrationQuery,
  ) => Promise<Result<GovernanceRegistrationRecord, GovernanceQueryFailure>>;
  readonly getPlacement: (
    query: GetPlacementQuery,
  ) => Promise<Result<GovernancePlacementRecord, GovernanceQueryFailure>>;
  readonly listObservations: (
    query: ListObservationsQuery,
  ) => Promise<Result<ObservationList, GovernanceQueryFailure>>;
  readonly getObservation: (
    query: GetObservationQuery,
  ) => Promise<Result<GovernanceObservationRecord, GovernanceQueryFailure>>;
  readonly listProposals: (
    query: ListProposalsQuery,
  ) => Promise<Result<ProposalList, GovernanceQueryFailure>>;
  readonly getProposal: (
    query: GetProposalQuery,
  ) => Promise<Result<GovernanceProposalRecord, GovernanceQueryFailure>>;
};

export function createGovernanceCatalogQueries(
  client: GovernanceQueryClient,
): GovernanceCatalogQueries {
  return {
    projectRegistrations: (query) => projectRegistrations(client, query),
    selectSubjectIds: (query) => selectSubjectIds(client, query),
    selectDefinitionIds: (query) => selectDefinitionIds(client, query),
    listRegistrations: (query) => listRegistrations(client, query),
    getRegistration: (query) => getRegistration(client, query),
    getPlacement: (query) => getPlacement(client, query),
    listObservations: (query) => listObservations(client, query),
    getObservation: (query) => getObservation(client, query),
    listProposals: (query) => listProposals(client, query),
    getProposal: (query) => getProposal(client, query),
  };
}
