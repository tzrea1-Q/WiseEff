import { z } from "zod";

import { knowledgeContentForms, knowledgeOrigins, knowledgeSourceTypes, knowledgeStatuses } from "./types";

const nonEmptyString = z.string().min(1);
export const KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT = 200_000;
const base64String = nonEmptyString.refine(
  (value) => {
    try {
      return Buffer.from(value, "base64").toString("base64") === value;
    } catch {
      return false;
    }
  },
  { message: "Expected valid base64 content." }
);

export const knowledgeTagSchema = z.string().min(1).max(60);
export const knowledgeTagsSchema = z.array(knowledgeTagSchema).max(20).default([]);

const batchEntryIds = z.array(z.string().uuid()).min(1).max(200).refine(
  (ids) => new Set(ids).size === ids.length, "Entry IDs must be unique."
);
export const batchKnowledgeEntriesBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_tags"), entryIds: batchEntryIds, tags: z.array(knowledgeTagSchema).min(1).max(20) }).strict(),
  z.object({ action: z.literal("remove_tags"), entryIds: batchEntryIds, tags: z.array(knowledgeTagSchema).min(1).max(20) }).strict(),
  z.object({ action: z.literal("publish"), entryIds: batchEntryIds }).strict(),
  z.object({ action: z.literal("archive"), entryIds: batchEntryIds }).strict()
]);
export type BatchKnowledgeEntriesInput = z.infer<typeof batchKnowledgeEntriesBodySchema>;

export const knowledgeFileUploadSchema = z.object({
  fileName: nonEmptyString.max(255),
  contentType: z.enum([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "text/markdown"
  ]),
  contentBase64: base64String
});

export const openKnowledgeImportSchema = z.object({ tags: knowledgeTagsSchema }).strict();
export const importKnowledgeArchiveSchema = z.object({
  file: z.object({ fileName: nonEmptyString.max(255).regex(/\.zip$/i), contentType: z.string().max(255), contentBase64: base64String })
}).strict();
export const importKnowledgeDocumentSchema = z.object({
  relativePath: z.string().min(1).max(1024).refine((path) =>
    !/^[a-z]:/i.test(path) && !path.includes("\\") && !/[\u0000-\u001f]/.test(path) && path.split("/").every((part) => part && part !== "." && part !== ".."),
  "Expected a relative document path."),
  file: z.object({ fileName: nonEmptyString.max(255), contentType: z.string().max(255), contentBase64: base64String })
}).strict();

export const createKnowledgeEntryBodySchema = z.discriminatedUnion("contentForm", [
  z.object({
    contentForm: z.literal("markdown"),
    origin: z.enum(["authored", "uploaded"]).optional(),
    title: nonEmptyString.max(200),
    tags: knowledgeTagsSchema,
    contentMarkdown: z.string().max(KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT).default("")
  }),
  z.object({
    contentForm: z.literal("file"),
    title: nonEmptyString.max(200),
    tags: knowledgeTagsSchema,
    file: knowledgeFileUploadSchema
  })
]);

export const updateKnowledgeEntryBodySchema = z
  .object({
    expectedHeadRevisionNumber: z.number().int().min(0),
    title: nonEmptyString.max(200).optional(),
    tags: knowledgeTagsSchema.optional(),
    contentMarkdown: z.string().max(KNOWLEDGE_MARKDOWN_CHARACTER_LIMIT).optional(),
    file: knowledgeFileUploadSchema.optional()
  })
  .refine(
    (value) =>
      value.title !== undefined || value.tags !== undefined || value.contentMarkdown !== undefined || value.file !== undefined,
    { message: "Expected at least one of title, tags, contentMarkdown, or file." }
  );

export const restoreKnowledgeRevisionBodySchema = z.object({
  expectedHeadRevisionNumber: z.number().int().min(1)
});

export const listKnowledgeEntriesQuerySchema = z.object({
  governable: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  origin: z.enum(knowledgeOrigins).optional(),
  status: z.enum(knowledgeStatuses).optional(),
  contentForm: z.enum(knowledgeContentForms).optional(),
  sourceType: z.enum(knowledgeSourceTypes).optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

export const distillKnowledgeFromLogBodySchema = z.object({
  logId: nonEmptyString.max(100)
});

export const distillKnowledgeFromReloadRunBodySchema = z.object({
  runId: nonEmptyString.max(100)
});

export const searchKnowledgeQuerySchema = z.object({
  q: nonEmptyString.max(200),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const relatedKnowledgeForLogQuerySchema = z.object({
  logId: nonEmptyString.max(100),
  limit: z.coerce.number().int().min(1).max(20).optional()
});

export const relatedKnowledgeForSpecQuerySchema = z.object({
  // parameter_specs.id is a text surrogate (e.g. "pspec:…"), not a uuid.
  specId: nonEmptyString.max(300),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export const relatedKnowledgeForDefinitionQuerySchema = z.object({
  definitionId: nonEmptyString.max(300),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export type CreateKnowledgeEntryBody = z.infer<typeof createKnowledgeEntryBodySchema>;
export type DistillKnowledgeFromLogBody = z.infer<typeof distillKnowledgeFromLogBodySchema>;
export type DistillKnowledgeFromReloadRunBody = z.infer<typeof distillKnowledgeFromReloadRunBodySchema>;
export type UpdateKnowledgeEntryBody = z.infer<typeof updateKnowledgeEntryBodySchema>;
export type RestoreKnowledgeRevisionBody = z.infer<typeof restoreKnowledgeRevisionBodySchema>;
export type ListKnowledgeEntriesQueryBody = z.infer<typeof listKnowledgeEntriesQuerySchema>;
export type SearchKnowledgeQueryBody = z.infer<typeof searchKnowledgeQuerySchema>;
export type RelatedKnowledgeForLogQuery = z.infer<typeof relatedKnowledgeForLogQuerySchema>;
export type RelatedKnowledgeForSpecQuery = z.infer<typeof relatedKnowledgeForSpecQuerySchema>;
export type RelatedKnowledgeForDefinitionQuery = z.infer<typeof relatedKnowledgeForDefinitionQuerySchema>;
