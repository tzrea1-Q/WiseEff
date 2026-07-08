import { z } from "zod";

import { feedbackStatuses, feedbackTypes } from "./types";

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

export const productFeedbackAttachmentBodySchema = z.object({
  fileName: nonEmptyString,
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  contentBase64: base64String
});

export const createProductFeedbackBodySchema = z.object({
  pagePath: z.string().min(1).max(500),
  pageTitle: z.string().min(1).max(200),
  feedbackType: z.enum(feedbackTypes),
  description: z.string().min(1).max(4000),
  attachments: z.array(productFeedbackAttachmentBodySchema).max(5).optional()
});

export const listProductFeedbackQuerySchema = z.object({
  status: z.enum(feedbackStatuses).optional(),
  feedbackType: z.enum(feedbackTypes).optional(),
  q: z.string().optional(),
  pagePath: z.string().optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
});

export const patchProductFeedbackBodySchema = z
  .object({
    status: z.enum(feedbackStatuses).optional(),
    adminNote: z.string().max(2000).optional()
  })
  .refine(
    (value) => Object.prototype.hasOwnProperty.call(value, "status") || Object.prototype.hasOwnProperty.call(value, "adminNote"),
    { message: "Expected status or adminNote." }
  );

export type ProductFeedbackAttachmentBody = z.infer<typeof productFeedbackAttachmentBodySchema>;
export type CreateProductFeedbackBody = z.infer<typeof createProductFeedbackBodySchema>;
export type ListProductFeedbackQueryBody = z.infer<typeof listProductFeedbackQuerySchema>;
export type PatchProductFeedbackBody = z.infer<typeof patchProductFeedbackBodySchema>;
