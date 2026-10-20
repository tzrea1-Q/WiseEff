import { z } from "zod";
import { itemEnvelopeSchema } from "./envelopes";

const count = z.number().int().nonnegative();

export const catalogDefinitionDeletionPreviewResponseSchema = itemEnvelopeSchema(z.object({
  definition: z.object({ id: z.string().min(1), propertyKey: z.string().min(1), subjectName: z.string() }).strict(),
  catalogRelease: z.object({ id: z.string().min(1), digest: z.string().min(1) }).strict(),
  affected: z.object({ organizations: count, projects: count, bindings: count,
    values: count, revisions: count, relatedRecords: count }).strict(),
  originalFilesRetained: z.literal(true),
  previewToken: z.string().min(1)
}).strict());

export const catalogDeleteDefinitionRequestSchema = z.object({ previewToken: z.string().min(1) }).strict();

export const catalogDefinitionDeletedResponseSchema = itemEnvelopeSchema(z.object({
  definitionId: z.string().min(1), deleted: z.literal(true),
  counts: z.record(count), originalFilesRetained: z.literal(true)
}).strict());

export const parameterDefinitionDeletionDtoSchemaCatalog = {
  CatalogDefinitionDeletionPreviewResponse: catalogDefinitionDeletionPreviewResponseSchema,
  CatalogDeleteDefinitionRequest: catalogDeleteDefinitionRequestSchema,
  CatalogDefinitionDeletedResponse: catalogDefinitionDeletedResponseSchema
};

export const parameterDefinitionDeletionRoutes = [
  { id: "catalog.previewDefinitionDeletion", method: "GET", path: "/api/v2/catalog/definitions/:definitionId/deletion-preview", module: "catalog", stability: "mvp" },
  { id: "catalog.deleteDefinition", method: "DELETE", path: "/api/v2/catalog/definitions/:definitionId", module: "catalog", stability: "mvp" },
] as const;

export const parameterDefinitionDeletionCoveredRouteIds = parameterDefinitionDeletionRoutes.map(route => route.id);

export const parameterDefinitionDeletionSchemaRegistry = {
  "catalog.previewDefinitionDeletion": {
    summary: "Preview the platform-wide permanent deletion of a parameter definition",
    tags: ["catalog" as const], responseBody: "CatalogDefinitionDeletionPreviewResponse",
    additionalResponses: { "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" },
  },
  "catalog.deleteDefinition": {
    summary: "Permanently delete a definition and all associated platform data; retain original source files",
    tags: ["catalog" as const], requestBody: "CatalogDeleteDefinitionRequest", responseBody: "CatalogDefinitionDeletedResponse",
    additionalResponses: { "400": "ErrorResponse", "401": "ErrorResponse", "403": "ErrorResponse", "404": "ErrorResponse", "409": "ErrorResponse" },
  },
};
