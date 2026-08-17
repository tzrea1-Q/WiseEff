import { z } from "zod";

import { itemsEnvelopeSchema, okEnvelopeSchema } from "./envelopes";

export const xiaozeThreadMessageRoleSchema = z.enum(["user", "assistant", "reasoning", "system"]);

export const xiaozeThreadContextSchema = z.object({
  path: z.string().optional(),
  pageKey: z.string().optional(),
  projectId: z.string().optional(),
  roleId: z.string().optional()
});

export const xiaozeThreadListItemDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number()
});

export const xiaozeThreadMessageDtoSchema = z.object({
  id: z.string(),
  role: xiaozeThreadMessageRoleSchema,
  content: z.string(),
  citations: z.array(z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  confidence: z.number().optional(),
  createdAt: z.string()
});

export const xiaozeThreadDetailDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  preview: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  context: xiaozeThreadContextSchema,
  messages: z.array(xiaozeThreadMessageDtoSchema).optional()
});

export const xiaozeThreadListResponseSchema = itemsEnvelopeSchema(xiaozeThreadListItemDtoSchema).extend({
  nextCursor: z.string().nullable()
});

export const xiaozeThreadCreateResponseSchema = z.object({
  thread: xiaozeThreadDetailDtoSchema
});

export const xiaozeThreadDetailResponseSchema = z.object({
  thread: xiaozeThreadDetailDtoSchema,
  messages: z.array(xiaozeThreadMessageDtoSchema)
});

export const xiaozeThreadPatchRequestSchema = z.object({
  title: z.string().trim().min(1).max(80)
});

export const xiaozeThreadPatchResponseSchema = z.object({
  thread: xiaozeThreadDetailDtoSchema
});

export const xiaozeThreadArchiveResponseSchema = okEnvelopeSchema;

export const xiaozeThreadCreateRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  context: xiaozeThreadContextSchema.optional()
});

/**
 * AG-UI run bodies are owned by `@ag-ui/client`. This schema pins the fields
 * WiseEff actually reads (threadId + messages) and allows the rest of the
 * protocol envelope through without inventing a second event format.
 */
export const xiaozeAgUiRunRequestSchema = z
  .object({
    threadId: z.string().optional(),
    runId: z.string().optional(),
    messages: z.array(z.unknown()).optional(),
    tools: z.array(z.unknown()).optional(),
    context: z.array(z.unknown()).optional(),
    state: z.unknown().optional(),
    forwardedProps: z.record(z.string(), z.unknown()).optional(),
    resume: z.array(z.unknown()).optional()
  })
  .passthrough();
