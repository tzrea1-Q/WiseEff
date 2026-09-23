export { handleCatalogGovernance, matchCatalogGovernanceRoute } from "./handlers";
export { listModuleRegistryFacts, type ModuleRegistryFact } from "../../parameter-governance/queries/registration";
export {
  catalogGovernanceCommandByRouteId,
  catalogGovernanceRouteIds,
  catalogGovernanceRoutes,
  catalogDefinitionReplacementRoutes,
} from "./mapping";
export {
  registerCatalogGovernanceRoutes,
  registerCatalogDefinitionReplacementRoutes,
  catalogGovernanceRouteManifest,
  catalogDefinitionReplacementRouteManifest,
} from "./routes";
export { createCatalogGovernanceHttpServer, listenCatalogGovernanceHttpServer } from "./http";
export {
  bindCatalogGovernanceCommands,
  bindGovernanceCatalogQueryPorts,
  emptyGovernanceQueryPorts,
  emptyGovernanceQueryPortsForTests,
  unavailableGovernanceQueryPorts,
} from "./ports";
export { THREAT_MATRIX } from "./threatMatrix";
export type { ThreatMatrixRow } from "./threatMatrix";
export type {
  CatalogGovernanceAuthResult,
  CatalogGovernancePorts,
  CatalogGovernanceRequest,
  CatalogGovernanceResponse,
  CatalogGovernanceRouteId,
  ObservationRecord,
  ProposalRecord,
  RegistrationRecord,
  TrustedGovernanceActorKind,
  TrustedGovernanceScope,
} from "./types";
