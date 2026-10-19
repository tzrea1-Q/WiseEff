import type { ZodTypeAny } from "zod";
export { parsePreviewRequestSchema, parsePreviewResponseSchema, decodedEventSchema, decodedValueSchema } from "./logs";
export { parsingSpecSchema, registerCaseKey } from "../../logs/parsing/spec";
export { extractorPreviewRequestSchema, extractorPreviewResponseSchema } from "../../logs/parsing/extractorBuilder";
export { formatPreviewRequestSchema, formatPreviewResponseSchema } from "../../logs/formatProfile";
import {
  dtoSchemaCatalog as coreDtoSchemaCatalog,
  dtoSchemaCoveredRouteIds as coreDtoSchemaCoveredRouteIds
} from "./catalog";
import {
  parameterCatalogCoveredRouteIds,
  parameterCatalogDtoSchemaCatalog
} from "./parameterCatalog";
import { canonicalConflictDtoSchemaCatalog } from "./canonicalConflict";
import { canonicalBatchRollbackDtoSchemaCatalog } from "./canonicalBatchRollback";
import { canonicalManualSyncDtoSchemaCatalog } from "./canonicalManualSync";
import { productFeedbackCoveredRouteIds, productFeedbackDtoSchemaCatalog } from "./productFeedback";
import { structuralReadResponseSchema, dtsSearchResponseSchema } from "./dtsStructure";
import { sourceRevisionCoveredRouteIds, sourceRevisionDtoSchemaCatalog } from "./sourceRevision";

export const dtoSchemaCatalog: Record<string, ZodTypeAny> = {
  ...coreDtoSchemaCatalog,
  ...parameterCatalogDtoSchemaCatalog,
  ...canonicalConflictDtoSchemaCatalog,
  ...canonicalBatchRollbackDtoSchemaCatalog,
  ...canonicalManualSyncDtoSchemaCatalog,
  ...productFeedbackDtoSchemaCatalog,
  ...sourceRevisionDtoSchemaCatalog,
  StructuralReadResponse: structuralReadResponseSchema,
  DtsSearchResponse: dtsSearchResponseSchema
};

export const dtoSchemaCoveredRouteIds = [
  ...coreDtoSchemaCoveredRouteIds,
  ...parameterCatalogCoveredRouteIds,
  ...productFeedbackCoveredRouteIds,
  ...sourceRevisionCoveredRouteIds
] as const;

export type DtoSchemaCoveredRouteId = (typeof dtoSchemaCoveredRouteIds)[number];

export {
  errorEnvelopeSchema,
  itemEnvelopeSchema,
  itemsEnvelopeSchema,
  okEnvelopeSchema
} from "./envelopes";
export * from "./parameters";
export * from "./parameterDashboard";
export * from "./logs";
export * from "./debugging";
export * from "./agent";
export * from "./parameterCatalog";
export * from "./canonicalConflict";
export * from "./canonicalBatchRollback";
export * from "./canonicalManualSync";
export * from "./productFeedback";
export * from "./sourceRevision";
export { projectBindingDtoSchema } from "../../parameter-topology/schemas";
export { validatedLogFormatProfileSchema } from "../../logs/formatProfile";
