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

/**
 * Definition identity correction migration (#847, `PCAT-API-13`).  A separate
 * command map and route family so the frozen PCAT-API-04/05/06 governance
 * command set stays exactly 19 entries.
 */
export const catalogDefinitionReplacementCommandByRouteId = {
  "catalog.previewDefinitionReplacement": "previewDefinitionReplacement",
  "catalog.listDefinitionReplacements": "listDefinitionReplacements",
  "catalog.createDefinitionReplacement": "executeDefinitionReplacement",
  "catalog.getDefinitionReplacement": "getDefinitionReplacement",
  "catalog.continueDefinitionReplacement": "continueDefinitionReplacement",
} as const;

export type CatalogGovernanceCommandName =
  | (typeof catalogGovernanceCommandByRouteId)[keyof typeof catalogGovernanceCommandByRouteId]
  | (typeof catalogDefinitionReplacementCommandByRouteId)[keyof typeof catalogDefinitionReplacementCommandByRouteId];

const GOVERNANCE_GATES = new Set(["PCAT-API-04", "PCAT-API-05", "PCAT-API-06"]);
const DEFINITION_REPLACEMENT_GATES = new Set(["PCAT-API-13"]);

export const catalogGovernanceRoutes = parameterCatalogCanonicalRoutes.filter((route) =>
  parameterCatalogRouteGates[route.id].some((gate) => GOVERNANCE_GATES.has(gate)),
);

/** Definition identity correction migration routes (`PCAT-API-13`). */
export const catalogDefinitionReplacementRoutes = parameterCatalogCanonicalRoutes.filter((route) =>
  parameterCatalogRouteGates[route.id].some((gate) => DEFINITION_REPLACEMENT_GATES.has(gate)),
);

export const catalogGovernanceRouteIds = catalogGovernanceRoutes.map(
  (route) => route.id,
) as Array<keyof typeof catalogGovernanceCommandByRouteId>;

export function isCatalogGovernanceRouteId(
  id: ParameterCatalogCanonicalRouteId,
): id is keyof typeof catalogGovernanceCommandByRouteId {
  return id in catalogGovernanceCommandByRouteId;
}

export type CatalogDefinitionReplacementRouteId =
  keyof typeof catalogDefinitionReplacementCommandByRouteId;

export function isCatalogDefinitionReplacementRouteId(
  id: ParameterCatalogCanonicalRouteId,
): id is CatalogDefinitionReplacementRouteId {
  return id in catalogDefinitionReplacementCommandByRouteId;
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

export const catalogDefinitionReplacementWriteRouteIds = catalogDefinitionReplacementRoutes
  .filter((route) => route.method !== "GET")
  .map((route) => route.id);

/**
 * Create and continue require `If-Match` carrying the frozen preview fingerprint
 * (`#847` §6.2).  The header value is the `sha256:` fingerprint itself, not a
 * version number, because an ETag alone cannot detect a source or tip change.
 */
export const catalogDefinitionReplacementIfMatchRouteIds = [
  "catalog.createDefinitionReplacement",
  "catalog.continueDefinitionReplacement",
] as const satisfies ReadonlyArray<CatalogDefinitionReplacementRouteId>;
