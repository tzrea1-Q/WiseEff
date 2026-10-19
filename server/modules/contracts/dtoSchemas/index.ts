import type { ZodTypeAny } from "zod";
export { parsePreviewRequestSchema, parsePreviewResponseSchema, decodedEventSchema, decodedValueSchema } from "./logs";
export { parsingSpecSchema } from "../../logs/parsing/spec";
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

export const dtoSchemaCatalog: Record<string, ZodTypeAny> = {
  ...coreDtoSchemaCatalog,
  ...parameterCatalogDtoSchemaCatalog,
  ...canonicalConflictDtoSchemaCatalog,
  ...canonicalBatchRollbackDtoSchemaCatalog,
  ...canonicalManualSyncDtoSchemaCatalog,
  ...productFeedbackDtoSchemaCatalog
};

export const dtoSchemaCoveredRouteIds = [
  ...coreDtoSchemaCoveredRouteIds,
  ...parameterCatalogCoveredRouteIds,
  ...productFeedbackCoveredRouteIds
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
export { projectBindingDtoSchema } from "../../parameter-topology/schemas";
export { logSkillSpecSchema } from "../../logs/skillSpec";
export { signalRuleSetSchema, signalPreviewRequestSchema, signalPreviewResponseSchema } from "../../logs/signalRules";
