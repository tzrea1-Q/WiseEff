import { z } from "zod";
import {
  appendProductFeedbackProgressBodySchema,
  createProductFeedbackBodySchema,
  createProductFeedbackDraftBodySchema,
  patchProductFeedbackBodySchema,
  patchProductFeedbackDraftBodySchema,
  replyToProductFeedbackBodySchema,
  submitProductFeedbackDraftBodySchema
} from "../../product-feedback/schemas";
import { feedbackPriorities, feedbackResolutionCodes, feedbackStatuses, feedbackTypes, progressEventKinds } from "../../product-feedback/types";
import { itemEnvelopeSchema } from "./envelopes";

const attachment = z.object({
  deletedAt: z.string().nullable().optional(), cleanupPending: z.boolean().optional(), canDelete: z.boolean().optional(),
  messageId: z.string().nullable().optional(), uploadedByUserId: z.string().nullable().optional(),
  id: z.string(), feedbackId: z.string(), organizationId: z.string(), storageKey: z.string(),
  fileName: z.string(), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sizeBytes: z.number(), checksum: z.string(), sortOrder: z.number(), createdAt: z.string()
});
export const productFeedbackPublicProgressSchema = z.object({
  id: z.string(), feedbackId: z.string(), kind: z.enum(progressEventKinds),
  fromStatus: z.enum(feedbackStatuses).nullable(), toStatus: z.enum(feedbackStatuses).nullable(),
  resolutionCode: z.enum(feedbackResolutionCodes).nullable(), publicMessage: z.string().nullable(),
  author: z.enum(["submitter", "team"]).optional(), createdAt: z.string()
}).strict();
export const productFeedbackUserDtoSchema = z.object({
  id: z.string(), organizationId: z.string(), pagePath: z.string(), pageTitle: z.string(),
  feedbackType: z.enum(feedbackTypes), description: z.string(), status: z.enum(feedbackStatuses),
  resolutionCode: z.enum(feedbackResolutionCodes).nullable(), submittedAt: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string(), attachments: z.array(attachment),
  progressEvents: z.array(productFeedbackPublicProgressSchema), latestPublicProgress: z.string().nullable().optional()
}).strict();
const assignee = z.object({ id: z.string(), name: z.string(), username: z.string().nullable() });
export const productFeedbackAdminDtoSchema = productFeedbackUserDtoSchema.extend({
  submitterUserId: z.string().nullable(), submitter: assignee.extend({ id: z.string().nullable() }),
  adminNote: z.string().nullable(), priority: z.enum(feedbackPriorities),
  assigneeUserId: z.string().nullable(), assignee: assignee.nullable(),
  progressEvents: z.array(productFeedbackPublicProgressSchema.extend({
    actorUserId: z.string().nullable(), internalMessage: z.string().nullable()
  }))
});

export const productFeedbackDtoSchemaCatalog = {
  ProductFeedbackAttachmentCleanupRequest: z.object({}).strict(),
  CreateProductFeedbackRequest: createProductFeedbackBodySchema,
  CreateProductFeedbackDraftRequest: createProductFeedbackDraftBodySchema,
  PatchProductFeedbackDraftRequest: patchProductFeedbackDraftBodySchema,
  SubmitProductFeedbackDraftRequest: submitProductFeedbackDraftBodySchema,
  PatchProductFeedbackRequest: patchProductFeedbackBodySchema,
  AppendProductFeedbackProgressRequest: appendProductFeedbackProgressBodySchema,
  ReplyToProductFeedbackRequest: replyToProductFeedbackBodySchema,
  ProductFeedbackResponse: itemEnvelopeSchema(productFeedbackAdminDtoSchema),
  ProductFeedbackUserResponse: itemEnvelopeSchema(productFeedbackUserDtoSchema),
  ProductFeedbackListResponse: z.object({ items: z.array(productFeedbackAdminDtoSchema), nextCursor: z.string().nullable() }),
  ProductFeedbackUserListResponse: z.object({ items: z.array(productFeedbackUserDtoSchema), nextCursor: z.string().nullable(), pendingAttachmentCleanupCount: z.number().int().nonnegative().optional() }),
  ProductFeedbackAttachmentCleanupResponse: z.object({ pendingAttachmentCleanupCount: z.number().int().nonnegative() }),
  ProductFeedbackAttachmentDeletionResponse: z.object({ item: z.union([productFeedbackAdminDtoSchema,productFeedbackUserDtoSchema]), pendingAttachmentCleanupCount: z.number().int().nonnegative() }),
  ProductFeedbackAssigneesResponse: z.object({ items: z.array(assignee) }),
  ProductFeedbackStatsResponse: z.object({ total: z.number(), open: z.number(), inProgress: z.number(), resolved: z.number(), closed: z.number() }),
  DeleteProductFeedbackDraftResponse: z.object({ ok: z.literal(true) })
};

export const productFeedbackCoveredRouteIds = [
  "productFeedback.deleteAttachment",
  "productFeedback.retryAttachmentCleanup",
  "productFeedback.create", "productFeedback.createDraft", "productFeedback.patchDraft",
  "productFeedback.deleteDraft", "productFeedback.submitDraft", "productFeedback.listMine",
  "productFeedback.getMine", "productFeedback.replyToMine", "productFeedback.list",
  "productFeedback.stats", "productFeedback.assignees", "productFeedback.get",
  "productFeedback.patch", "productFeedback.appendProgress"
] as const;
