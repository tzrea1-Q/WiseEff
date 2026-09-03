import {
  parameterCatalogCanonicalRoutes,
  parameterCatalogRouteGates,
  type ParameterCatalogCanonicalRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";

export const catalogGovernanceCommandByRouteId = {
  "catalog.listRegistrations": "listRegistrations",
  "catalog.createRegistration": "executeRegistration",
  "catalog.getRegistration": "getRegistration",
  "catalog.retireRegistration": "executeRegistration",
  "catalog.restoreRegistration": "executeRegistration",
  "catalog.getPlacement": "getPlacement",
  "catalog.updatePlacement": "executeRegistration",
  "catalog.listObservations": "listObservations",
  "catalog.getObservation": "getObservation",
  "catalog.listReviewItems": "listReviewQueue",
  "catalog.getReviewItem": "getReviewItem",
  "catalog.resolveReviewItem": "resolveReviewItem",
  "catalog.listProposals": "listProposals",
  "catalog.createProposal": "executeProposal",
  "catalog.getProposal": "getProposal",
  "catalog.submitProposal": "executeProposal",
  "catalog.withdrawProposal": "executeProposal",
  "catalog.acceptProposal": "executeProposal",
  "catalog.rejectProposal": "executeProposal",
} as const;

export type CatalogGovernanceCommandName =
  (typeof catalogGovernanceCommandByRouteId)[keyof typeof catalogGovernanceCommandByRouteId];

const GOVERNANCE_GATES = new Set(["PCAT-API-04", "PCAT-API-05", "PCAT-API-06"]);

export const catalogGovernanceRoutes = parameterCatalogCanonicalRoutes.filter((route) =>
  parameterCatalogRouteGates[route.id].some((gate) => GOVERNANCE_GATES.has(gate)),
);

export const catalogGovernanceRouteIds = catalogGovernanceRoutes.map(
  (route) => route.id,
) as Array<keyof typeof catalogGovernanceCommandByRouteId>;

export function isCatalogGovernanceRouteId(
  id: ParameterCatalogCanonicalRouteId,
): id is keyof typeof catalogGovernanceCommandByRouteId {
  return id in catalogGovernanceCommandByRouteId;
}

export const catalogGovernanceWriteRouteIds = catalogGovernanceRoutes
  .filter((route) => route.method !== "GET")
  .map((route) => route.id);

export const catalogGovernanceIfMatchRouteIds = [
  "catalog.retireRegistration",
  "catalog.restoreRegistration",
  "catalog.updatePlacement",
  "catalog.resolveReviewItem",
  "catalog.submitProposal",
  "catalog.withdrawProposal",
  "catalog.acceptProposal",
  "catalog.rejectProposal",
] as const satisfies ReadonlyArray<keyof typeof catalogGovernanceCommandByRouteId>;
