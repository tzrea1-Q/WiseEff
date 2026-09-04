import { z } from "zod";

import { logRecordStatuses } from "./status";

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
const booleanQuerySchema = z.union([z.boolean(), z.enum(["true", "false"])]).transform((value) => value === true || value === "true");

const relatedParameterPinSchema = z.object({
  kind: z.literal("canonical-pin"),
  bindingId: nonEmptyString,
  definitionId: nonEmptyString.optional(),
  definitionRevisionId: nonEmptyString.optional()
});

function rejectMismatchedRelatedParameterPin(
  value: { relatedParameterId?: string; relatedParameterPin?: { bindingId: string } },
  context: z.RefinementCtx
) {
  const pinId = value.relatedParameterPin?.bindingId;
  if (pinId && value.relatedParameterId && pinId !== value.relatedParameterId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["relatedParameterPin", "bindingId"],
      message: "relatedParameterPin.bindingId must match relatedParameterId."
    });
  }
}

export const createLogFileBodySchema = z
  .object({
    fileName: nonEmptyString,
    contentType: nonEmptyString,
    contentBase64: base64String,
    analysisQuestion: z.string().optional(),
    relatedParameterId: nonEmptyString.optional(),
    relatedParameterPin: relatedParameterPinSchema.optional(),
    logDomainId: nonEmptyString.optional()
  })
  .superRefine(rejectMismatchedRelatedParameterPin);

export const createLogBodySchema = z
  .object({
    fileObjectId: nonEmptyString,
    fileName: nonEmptyString,
    analysisQuestion: z.string().optional(),
    relatedParameterId: nonEmptyString.optional(),
    relatedParameterPin: relatedParameterPinSchema.optional(),
    logDomainId: nonEmptyString.optional()
  })
  .superRefine(rejectMismatchedRelatedParameterPin);

export function scopedRelatedParameterId(input: {
  relatedParameterId?: string;
  relatedParameterPin?: { bindingId: string };
}): string | undefined {
  return input.relatedParameterPin?.bindingId ?? input.relatedParameterId;
}

export const listLogsQuerySchema = z.object({
  status: z.enum(logRecordStatuses).optional(),
  timeWindow: z.enum(["today", "7d", "30d"]).optional(),
  includeArchived: booleanQuerySchema.optional()
});

export const logFeedbackBodySchema = z.object({
  rating: z.enum(["helpful", "not_helpful"]),
  note: z.string().max(2000).optional()
});

export const feedbackInsightsQuerySchema = z.object({
  timeWindow: z.enum(["today", "7d", "30d"]).optional()
});

export const rerunLogBodySchema = z.object({
  analysisQuestion: z.string().optional(),
  logDomainId: nonEmptyString.optional()
});

export const listLogDomainsQuerySchema = z.object({
  includeArchived: booleanQuerySchema.optional()
});

export const createLogDomainBodySchema = z.object({
  name: nonEmptyString.max(120),
  description: z.string().max(2000).optional(),
  formatProfile: z.unknown().optional()
});

export const updateLogDomainBodySchema = z.object({
  name: nonEmptyString.max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  formatProfile: z.unknown().optional(),
  status: z.enum(["active", "archived"]).optional(),
  /** Per-domain model-name override; null clears it back to the global model (P3b). */
  modelOverride: nonEmptyString.max(200).nullable().optional()
});

/**
 * Replace-style webhook configuration (P3b). `secret` undefined keeps the stored
 * secret so admins can toggle enabled/url without re-entering it; null clears it.
 */
export const setLogDomainWebhookBodySchema = z.object({
  url: z.string().max(2000).nullable(),
  enabled: z.boolean(),
  secret: z.string().min(16).max(200).nullable().optional()
});

export const webhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional()
});

/** Replace-set semantics; entries must be published knowledge entries in the caller's org. */
export const setLogDomainKnowledgeLinksBodySchema = z.object({
  knowledgeEntryIds: z.array(z.string().uuid()).max(50)
});

export type CreateLogFileBody = z.infer<typeof createLogFileBodySchema>;
export type CreateLogBody = z.infer<typeof createLogBodySchema>;
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
export type LogFeedbackBody = z.infer<typeof logFeedbackBodySchema>;
export type FeedbackInsightsQuery = z.infer<typeof feedbackInsightsQuerySchema>;
export type RerunLogBody = z.infer<typeof rerunLogBodySchema>;
export type ListLogDomainsQuery = z.infer<typeof listLogDomainsQuerySchema>;
export type CreateLogDomainBody = z.infer<typeof createLogDomainBodySchema>;
export type UpdateLogDomainBody = z.infer<typeof updateLogDomainBodySchema>;
export type SetLogDomainKnowledgeLinksBody = z.infer<typeof setLogDomainKnowledgeLinksBodySchema>;
export type SetLogDomainWebhookBody = z.infer<typeof setLogDomainWebhookBodySchema>;
export type WebhookDeliveriesQuery = z.infer<typeof webhookDeliveriesQuerySchema>;
