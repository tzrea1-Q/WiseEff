import { z } from "zod";
import { EventType } from "@ag-ui/core";
import {
  XIAOZE_INTERRUPT_EVENT,
  XIAOZE_PROMPT_DEBUG_EVENT,
  XIAOZE_RUN_TIMING_EVENT,
  XIAOZE_TURN_REPLY_EVENT,
  XIAOZE_TURN_STATE_EVENT,
  type XiaozeCitation,
  type XiaozeInterruptPayload,
  type XiaozePromptDebugPayload,
  type XiaozePromptDebugSnapshot,
  type XiaozePromptDebugTool,
  type XiaozeRunStep,
  type XiaozeRunTimingPayload,
  type XiaozeTurnReplyPayload,
  type XiaozeTurnStatePayload
} from "@wiseeff/xiaoze-protocol";

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

export const xiaozeCitationSchema: z.ZodType<XiaozeCitation> = z.object({
  type: z.enum(["parameter", "log", "audit", "debugging", "knowledge"]),
  id: z.string(),
  label: z.string(),
  href: z.string().optional(),
  snippet: z.string().optional(),
  confidence: z.number().optional()
});

export const xiaozeRunStepSchema: z.ZodType<XiaozeRunStep> = z.object({
  id: z.string(),
  kind: z.enum(["graph", "tool", "model"]),
  label: z.string(),
  toolName: z.string().optional(),
  status: z.enum(["running", "succeeded", "failed", "forbidden"]),
  summary: z.string().optional(),
  startedAtMs: z.number(),
  durationMs: z.number().optional()
});

export const xiaozeSuggestContextSchema = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  pageKey: z.string().optional(),
  path: z.string().optional()
});

export const xiaozeSuggestRequestSchema = z.object({
  context: xiaozeSuggestContextSchema.optional()
});

export const xiaozeSuggestionItemSchema = z.object({
  id: z.string(),
  tone: z.enum(["neutral", "warning", "danger"]),
  headline: z.string(),
  meta: z.string().optional(),
  citations: z.array(xiaozeCitationSchema)
});

export const xiaozeSuggestResponseSchema = z.object({
  suggestions: z.array(xiaozeSuggestionItemSchema)
});

export const xiaozeTurnStatePayloadSchema: z.ZodType<XiaozeTurnStatePayload> = z.object({
  runId: z.string(),
  messageId: z.string(),
  reasoningMessageId: z.string(),
  phase: z.enum(["thinking", "tool", "composing", "done", "error"]),
  steps: z.array(xiaozeRunStepSchema).optional(),
  text: z.string().optional(),
  reasoning: z.string().optional(),
  answerStreaming: z.boolean().optional()
});

export const xiaozeTurnReplyPayloadSchema: z.ZodType<XiaozeTurnReplyPayload> = z.object({
  runId: z.string(),
  messageId: z.string(),
  reasoningMessageId: z.string(),
  text: z.string(),
  reasoning: z.string().optional(),
  runSteps: z.array(xiaozeRunStepSchema).optional(),
  citations: z.array(xiaozeCitationSchema).optional()
});

export const xiaozeRunTimingPayloadSchema: z.ZodType<XiaozeRunTimingPayload> = z.object({
  runId: z.string(),
  reasoningMessageId: z.string(),
  startedAt: z.number(),
  durationMs: z.number(),
  phase: z.enum(["finished", "error"])
});

export const xiaozePromptDebugToolSchema: z.ZodType<XiaozePromptDebugTool> = z.object({
  name: z.string(),
  description: z.string(),
  schema: z.record(z.string(), z.unknown()),
  requiresApproval: z.boolean().optional()
});

export const xiaozePromptDebugSnapshotSchema: z.ZodType<XiaozePromptDebugSnapshot> = z.object({
  threadId: z.string(),
  userMessage: z.string(),
  context: z.object({
    projectId: z.string().optional(),
    pageKey: z.string().optional()
  }),
  system: z.object({
    policy: z.string(),
    toolCatalog: z.string()
  }),
  llmMessages: z.array(z.unknown()),
  tools: z.array(xiaozePromptDebugToolSchema),
  model: z.string().optional(),
  promptVersion: z.string().optional()
});

export const xiaozePromptDebugPayloadSchema: z.ZodType<XiaozePromptDebugPayload> = z.object({
  runId: z.string(),
  messageId: z.string(),
  snapshot: xiaozePromptDebugSnapshotSchema
});

export const xiaozeInterruptPayloadSchema: z.ZodType<XiaozeInterruptPayload> = z.object({
  approvalId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  payload: z.record(z.string(), z.unknown()),
  citations: z.array(xiaozeCitationSchema)
});

function customEventFrameSchema<Name extends string, Value extends z.ZodTypeAny>(name: Name, value: Value) {
  return z.object({
    event: z.literal(EventType.CUSTOM),
    data: z.object({
      type: z.literal(EventType.CUSTOM),
      name: z.literal(name),
      value
    })
  });
}

export const xiaozeTurnStateCustomEventSchema = customEventFrameSchema(
  XIAOZE_TURN_STATE_EVENT,
  xiaozeTurnStatePayloadSchema
);
export const xiaozeTurnReplyCustomEventSchema = customEventFrameSchema(
  XIAOZE_TURN_REPLY_EVENT,
  xiaozeTurnReplyPayloadSchema
);
export const xiaozeRunTimingCustomEventSchema = customEventFrameSchema(
  XIAOZE_RUN_TIMING_EVENT,
  xiaozeRunTimingPayloadSchema
);
export const xiaozePromptDebugCustomEventSchema = customEventFrameSchema(
  XIAOZE_PROMPT_DEBUG_EVENT,
  xiaozePromptDebugPayloadSchema
);
export const xiaozeInterruptCustomEventSchema = customEventFrameSchema(
  XIAOZE_INTERRUPT_EVENT,
  xiaozeInterruptPayloadSchema
);
