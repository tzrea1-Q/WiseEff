import {
  parameterCatalogCanonicalRoutes,
  type ParameterCatalogCanonicalRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";

export const catalogPublicationCommandByRouteId = {
  "catalog.createPublicationCandidate": "previewCandidate",
  "catalog.getPublicationCandidate": "getCandidate",
  "catalog.publishPublicationCandidate": "publishCandidate",
  "catalog.getPublication": "getPublication",
} as const;

export type CatalogPublicationCommandName =
  (typeof catalogPublicationCommandByRouteId)[keyof typeof catalogPublicationCommandByRouteId];

export const catalogPublicationRoutes = parameterCatalogCanonicalRoutes.filter(
  (route) => route.id in catalogPublicationCommandByRouteId,
);

export const catalogPublicationRouteIds = catalogPublicationRoutes.map(
  (route) => route.id,
) as Array<keyof typeof catalogPublicationCommandByRouteId>;

export function isCatalogPublicationRouteId(
  id: ParameterCatalogCanonicalRouteId,
): id is keyof typeof catalogPublicationCommandByRouteId {
  return id in catalogPublicationCommandByRouteId;
}

export const catalogPublicationWriteRouteIds = catalogPublicationRoutes
  .filter((route) => route.method !== "GET")
  .map((route) => route.id);
