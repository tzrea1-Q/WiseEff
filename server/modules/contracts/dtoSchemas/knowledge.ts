import { z } from "zod";
import { batchKnowledgeEntriesBodySchema, createKnowledgeEntryBodySchema, updateKnowledgeEntryBodySchema, openKnowledgeImportSchema, importKnowledgeDocumentSchema, importKnowledgeArchiveSchema } from "../../knowledge/schemas";
import { knowledgeContentForms, knowledgeOrigins, knowledgeSourceTypes, knowledgeStatuses, knowledgeExtractionStatuses } from "../../knowledge/types";
import { itemEnvelopeSchema, itemsEnvelopeSchema } from "./envelopes";
import { historicalAttributionSchema } from "./historicalAttribution";

const referenceFields = {
  historicalAttribution: historicalAttributionSchema.optional(),
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
  responsibleUserId: z.string().nullable().optional(),
  historicalAttribution: historicalAttributionSchema.optional(),
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
  parameterReferences: z.array(referenceSchema),
  pendingSuggestionCount: z.number().int().nonnegative().optional()
});

const importOutcomeSchema = z.object({
  id: z.string().uuid(), relativePath: z.string(),
  status: z.enum(["created", "duplicate_skipped", "unsupported_skipped", "extraction_failed", "rejected"]),
  entryId: z.string().uuid().nullable(), error: z.string().nullable(), warnings: z.array(z.string()).optional()
});
const importCountsSchema = z.object({ created: z.number().int(), duplicate_skipped: z.number().int(), unsupported_skipped: z.number().int(),
  extraction_failed: z.number().int(), rejected: z.number().int() });

export const knowledgeDtoSchemaCatalog = {
  KnowledgeReferenceSuggestionsResponse: itemsEnvelopeSchema(z.object({
    definitionId: z.string(), propertyKey: z.string(), displayName: z.string().nullable(), driverModule: z.string(),
    lifecycle: z.enum(["active", "deprecated"]), mentionCount: z.number().int().positive(), snippet: z.string(),
    page: z.number().int().positive().nullable(), detectedRevisionId: z.string().uuid()
  })),
  KnowledgeSearchResponse: z.object({
    items: z.array(z.object({
      entryId: z.string(), title: z.string(), contentForm: z.enum(knowledgeContentForms), tags: z.array(z.string()),
      excerpt: z.string(), updatedAt: z.string(), revisionId: z.string().nullable(),
      pageStart: z.number().int().min(1).nullable().optional().describe("1-based physical PDF start page of the excerpt's chunk; absent for non-PDF or legacy indexes."),
      pageEnd: z.number().int().min(1).nullable().optional().describe("1-based physical PDF end page of the same chunk and revision.")
    })),
    retrieval: z.object({
      mode: z.enum(["semantic_fts", "fts_only"]), vectorAvailable: z.boolean(), embeddingConfigured: z.boolean(),
      degradedReason: z.string().optional()
    })
  }),
  BatchKnowledgeEntriesRequest: batchKnowledgeEntriesBodySchema,
  BatchKnowledgeEntriesResponse: z.object({ results: z.array(z.object({
    entryId: z.string().uuid(), title: z.string().nullable(), status: z.enum(["succeeded", "refused", "failed"]),
    entry: knowledgeEntryDtoSchema.nullable(), error: z.object({ code: z.string(), message: z.string(), reason: z.string().optional() }).nullable()
  })), summaryError: z.string().nullable() }),
  OpenKnowledgeImportRequest: openKnowledgeImportSchema,
  OpenKnowledgeImportResponse: itemEnvelopeSchema(z.object({ id: z.string().uuid() })),
  ImportKnowledgeDocumentRequest: importKnowledgeDocumentSchema,
  ImportKnowledgeDocumentResponse: itemEnvelopeSchema(importOutcomeSchema),
  ImportKnowledgeArchiveRequest: importKnowledgeArchiveSchema,
  ImportKnowledgeArchiveResponse: itemEnvelopeSchema(z.object({ outcomes: z.array(importOutcomeSchema) })),
  CompleteKnowledgeImportRequest: z.object({}).strict(),
  KnowledgeImportReportResponse: itemEnvelopeSchema(z.object({ id: z.string().uuid(), tags: z.array(z.string()), completed: z.boolean(),
    documentCount: z.number().int(), totalBytes: z.number().int(), counts: importCountsSchema, outcomes: z.array(importOutcomeSchema) })),
  CreateKnowledgeEntryRequest: createKnowledgeEntryBodySchema,
  UpdateKnowledgeEntryRequest: updateKnowledgeEntryBodySchema,
  KnowledgeEntryResponse: itemEnvelopeSchema(knowledgeEntryDtoSchema),
  KnowledgeBindingResponse: z.object({ entry: knowledgeEntryDtoSchema.nullable(), deleted: z.boolean() }),
  KnowledgeEntryListResponse: itemsEnvelopeSchema(knowledgeEntryDtoSchema)
};
export const knowledgeCoveredRouteIds = ["knowledge.batchEntries", "knowledge.openImport", "knowledge.importDocument", "knowledge.importArchive", "knowledge.getImport", "knowledge.completeImport",
  "knowledge.createEntry", "knowledge.getEntry", "knowledge.getBinding", "knowledge.listEntries", "knowledge.updateEntry"] as const;
