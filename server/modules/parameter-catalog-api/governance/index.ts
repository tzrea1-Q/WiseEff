export { handleCatalogGovernance, matchCatalogGovernanceRoute } from "./handlers";
export {
  catalogGovernanceCommandByRouteId,
  catalogGovernanceRouteIds,
  catalogGovernanceRoutes,
} from "./mapping";
export { registerCatalogGovernanceRoutes, catalogGovernanceRouteManifest } from "./routes";
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
