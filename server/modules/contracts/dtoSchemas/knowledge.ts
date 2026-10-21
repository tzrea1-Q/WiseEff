import { z } from "zod";
import { createKnowledgeEntryBodySchema, updateKnowledgeEntryBodySchema } from "../../knowledge/schemas";
import { knowledgeContentForms, knowledgeOrigins, knowledgeSourceTypes, knowledgeStatuses, knowledgeExtractionStatuses } from "../../knowledge/types";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";

const referenceFields = {
  propertyKey: z.string().nullable(), displayName: z.string().nullable(), driverModule: z.string().nullable(),
  createdByUserId: z.string().nullable(), createdAt: z.string()
};
const referenceSchema = z.discriminatedUnion("kind", [
  z.object({ ...referenceFields, kind: z.literal("definition"), definitionId: z.string(),
    lifecycle: z.enum(["active", "deprecated", "retired"]).nullable(), availability: z.enum(["current", "unavailable"]) }),
  z.object({ ...referenceFields, kind: z.literal("legacy-spec"), specId: z.string(),
    lifecycle: z.enum(["draft", "active", "deprecated"]), historicalOnly: z.boolean().optional(),
    mappingStatus: z.enum(["current", "historical", "orphaned", "archived", "unmapped"]).optional(),
    canonicalTargetKind: z.string().nullable().optional(), canonicalTargetId: z.string().nullable().optional() })
]);

export const knowledgeEntryDtoSchema = z.object({
  id: z.string().uuid(), organizationId: z.string(), title: z.string(),
  contentForm: z.enum(knowledgeContentForms), status: z.enum(knowledgeStatuses), origin: z.enum(knowledgeOrigins),
  tags: z.array(z.string()), sourceType: z.enum(knowledgeSourceTypes),
  sourceSessionId: z.string().nullable(), sourceLogId: z.string().nullable(), sourceLogDeleted: z.boolean().optional(),
  sourceReloadRunId: z.string().nullable(), createdByUserId: z.string().nullable(), headRevisionId: z.string().nullable(),
  headRevisionNumber: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
  publishedAt: z.string().nullable(), archivedAt: z.string().nullable(), contentMarkdown: z.string().nullable(),
  file: z.object({ id: z.string(), entryId: z.string(), organizationId: z.string(), storageKey: z.string(),
    fileName: z.string(), contentType: z.string(), sizeBytes: z.number(), checksum: z.string(),
    extractionStatus: z.enum(knowledgeExtractionStatuses), extractionError: z.string().nullable(),
    createdAt: z.string(), updatedAt: z.string() }).nullable(),
  parameterReferences: z.array(referenceSchema)
});

export const knowledgeDtoSchemaCatalog = {
  CreateKnowledgeEntryRequest: createKnowledgeEntryBodySchema,
  UpdateKnowledgeEntryRequest: updateKnowledgeEntryBodySchema,
  KnowledgeEntryResponse: itemEnvelopeSchema(knowledgeEntryDtoSchema),
  KnowledgeBindingResponse: z.object({ entry: knowledgeEntryDtoSchema.nullable(), deleted: z.boolean() }),
  KnowledgeEntryListResponse: itemsEnvelopeSchema(knowledgeEntryDtoSchema)
};
export const knowledgeCoveredRouteIds = ["knowledge.createEntry", "knowledge.getEntry", "knowledge.getBinding", "knowledge.listEntries", "knowledge.updateEntry"] as const;
