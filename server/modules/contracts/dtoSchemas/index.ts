import { z, type ZodTypeAny } from "zod";
import { initializationConfigSnapshotSchema, initializationSnapshotItemSchema, previewInitializationSnapshotBodySchema, upsertInitializationDraftBodySchema } from "../../parameters/schemas";
import { organizationDeletionDtoSchemaCatalog, organizationDeletionRoutes } from "./organizationDeletion";
export * from "./organizationDeletion";
import { accountTransferDtoSchemaCatalog, accountTransferRoutes } from "./accountTransfer";
export * from "./accountTransfer";
import { assetHandoverDtoSchemaCatalog, assetHandoverRoutes } from "./organizationAssetHandover";
import { organizationInvitationDtoSchemaCatalog, organizationInvitationRoutes } from "./organizationInvitations";
import { projectMembersCoveredRouteIds, projectMembersDtoSchemaCatalog } from "./projectMembers";
import { platformOrganizationDtoSchemaCatalog, platformOrganizationRoutes } from "./platformOrganizations";
import { organizationTeamDtoSchemaCatalog, organizationTeamRoutes } from "./organizationTeams";
import { organizationWorkspaceDtoSchemaCatalog, organizationWorkspaceRoutes } from "./organizationWorkspace";
export { administratorRecoverySchema, createPlatformOrganizationSchema, platformOrganizationSchema, recoverOrganizationAdministratorSchema, experienceRegistrationSchema, updateExperienceRegistrationSchema } from "./platformOrganizations";
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
import { sharedDtsiDtoSchemaCatalog, sharedDtsiRoutes } from "./sharedDtsi";
export * from "./sharedDtsi";
export * from "./dtsPreprocessing";
export { workflowPublicationAdminStateSchema, workflowPublicationStateSchema } from "./workflowPublication";

export const dtoSchemaCatalog: Record<string, ZodTypeAny> = {
  ...sharedDtsiDtoSchemaCatalog,
  ...organizationDeletionDtoSchemaCatalog,
  ...accountTransferDtoSchemaCatalog,
  ...assetHandoverDtoSchemaCatalog,
  ...organizationInvitationDtoSchemaCatalog,
  ...projectMembersDtoSchemaCatalog,
  ...platformOrganizationDtoSchemaCatalog,
  ...organizationTeamDtoSchemaCatalog,
  ...organizationWorkspaceDtoSchemaCatalog,
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
  DtsSearchResponse: dtsSearchResponseSchema,
  PreviewProjectInitializationSnapshotRequest: previewInitializationSnapshotBodySchema,
  UpsertProjectInitializationDraftRequest: upsertInitializationDraftBodySchema,
  ProjectInitializationCompleteCopyPreviewResponse: z.object({ items: z.array(initializationSnapshotItemSchema), configSnapshots: z.array(initializationConfigSnapshotSchema) })
};

export const dtoSchemaCoveredRouteIds = [
  "parameters.initialization.completeCopyPreview",
  ...sharedDtsiRoutes.map(route => route.id),
  ...organizationDeletionRoutes.map(route => route.id),
  ...accountTransferRoutes.map(route => route.id),
  ...assetHandoverRoutes.map(route => route.id),
  ...organizationInvitationRoutes.map((route) => route.id),
  ...projectMembersCoveredRouteIds,
  ...platformOrganizationRoutes.map((route) => route.id),
  ...organizationTeamRoutes.map((route) => route.id),
  ...organizationWorkspaceRoutes.map(route => route.id),
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
export * from "./configSetPackage";
export * from "./parameterDefinitionDeletion";
export { projectBindingDtoSchema } from "../../parameter-topology/schemas";
export { logSkillSpecSchema } from "../../logs/skillSpec";
export { listSignalFields, type SignalField } from "../../logs/parsing/signalFields";
export { signalRuleSetSchema, signalPreviewRequestSchema, signalPreviewResponseSchema } from "../../logs/signalRules";
export { validatedLogFormatProfileSchema } from "../../logs/formatProfile";
export * from "./memberRemoval";
