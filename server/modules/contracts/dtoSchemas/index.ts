import type { ZodTypeAny } from "zod";
import {
  dtoSchemaCatalog as coreDtoSchemaCatalog,
  dtoSchemaCoveredRouteIds as coreDtoSchemaCoveredRouteIds
} from "./catalog";
import {
  parameterCatalogCoveredRouteIds,
  parameterCatalogDtoSchemaCatalog
} from "./parameterCatalog";

export const dtoSchemaCatalog: Record<string, ZodTypeAny> = {
  ...coreDtoSchemaCatalog,
  ...parameterCatalogDtoSchemaCatalog
};

export const dtoSchemaCoveredRouteIds = [
  ...coreDtoSchemaCoveredRouteIds,
  ...parameterCatalogCoveredRouteIds
] as const;

export type DtoSchemaCoveredRouteId = (typeof dtoSchemaCoveredRouteIds)[number];

export {
  errorEnvelopeSchema,
  itemEnvelopeSchema,
  itemsEnvelopeSchema,
  okEnvelopeSchema
} from "./envelopes";
export * from "./parameters";
export * from "./logs";
export * from "./debugging";
export * from "./agent";
export * from "./parameterCatalog";
