import type { ZodTypeAny } from "zod";
import { knowledgeCoveredRouteIds, knowledgeDtoSchemaCatalog } from "./knowledge";
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
import { parameterDefinitionDeletionDtoSchemaCatalog, parameterDefinitionDeletionCoveredRouteIds } from "./parameterDefinitionDeletion";
import { workflowPublicationDtoSchemaCatalog, workflowPublicationCoveredRouteIds } from "./workflowPublication";
export { workflowPublicationAdminStateSchema, workflowPublicationStateSchema } from "./workflowPublication";

export const dtoSchemaCatalog: Record<string, ZodTypeAny> = {
  ...workflowPublicationDtoSchemaCatalog,
  ...knowledgeDtoSchemaCatalog,
  ...coreDtoSchemaCatalog,
  ...parameterCatalogDtoSchemaCatalog,
  ...canonicalConflictDtoSchemaCatalog,
  ...canonicalBatchRollbackDtoSchemaCatalog,
  ...canonicalManualSyncDtoSchemaCatalog,
  ...productFeedbackDtoSchemaCatalog,
  ...sourceRevisionDtoSchemaCatalog,
  ...parameterDefinitionDeletionDtoSchemaCatalog,
  StructuralReadResponse: structuralReadResponseSchema,
  DtsSearchResponse: dtsSearchResponseSchema
};

export const dtoSchemaCoveredRouteIds = [
  ...workflowPublicationCoveredRouteIds,
  ...knowledgeCoveredRouteIds,
  ...coreDtoSchemaCoveredRouteIds,
  ...parameterCatalogCoveredRouteIds,
  ...productFeedbackCoveredRouteIds,
  ...sourceRevisionCoveredRouteIds,
  ...parameterDefinitionDeletionCoveredRouteIds
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
export * from "./skillDeletion";
export * from "./debugging";
export * from "./agent";
export * from "./parameterCatalog";
export * from "./canonicalConflict";
export * from "./canonicalBatchRollback";
export * from "./canonicalManualSync";
export * from "./productFeedback";
export * from "./sourceRevision";
export * from "./canonicalMemberAddition";
export * from "./parameterDefinitionDeletion";
export { projectBindingDtoSchema } from "../../parameter-topology/schemas";
export { logSkillSpecSchema } from "../../logs/skillSpec";
export { listSignalFields, type SignalField } from "../../logs/parsing/signalFields";
export { signalRuleSetSchema, signalPreviewRequestSchema, signalPreviewResponseSchema } from "../../logs/signalRules";
export { validatedLogFormatProfileSchema } from "../../logs/formatProfile";
export * from "./memberRemoval";
