import { z } from "zod";

import { knowledgeContentForms, knowledgeStatuses } from "./types";

const nonEmptyString = z.string().min(1);
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

export const createKnowledgeEntryBodySchema = z.discriminatedUnion("contentForm", [
  z.object({
    contentForm: z.literal("markdown"),
    title: nonEmptyString.max(200),
    tags: knowledgeTagsSchema,
    contentMarkdown: z.string().max(200_000).default("")
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
    contentMarkdown: z.string().max(200_000).optional(),
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
  status: z.enum(knowledgeStatuses).optional(),
  contentForm: z.enum(knowledgeContentForms).optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export const searchKnowledgeQuerySchema = z.object({
  q: nonEmptyString.max(200),
  limit: z.coerce.number().int().min(1).max(50).optional()
});

export type CreateKnowledgeEntryBody = z.infer<typeof createKnowledgeEntryBodySchema>;
export type UpdateKnowledgeEntryBody = z.infer<typeof updateKnowledgeEntryBodySchema>;
export type RestoreKnowledgeRevisionBody = z.infer<typeof restoreKnowledgeRevisionBodySchema>;
export type ListKnowledgeEntriesQueryBody = z.infer<typeof listKnowledgeEntriesQuerySchema>;
export type SearchKnowledgeQueryBody = z.infer<typeof searchKnowledgeQuerySchema>;
