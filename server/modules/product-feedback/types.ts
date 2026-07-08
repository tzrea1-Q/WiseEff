export const feedbackTypes = ["experience", "data", "export_submit", "feature"] as const;
export const feedbackStatuses = ["open", "in_progress", "closed"] as const;

export type ProductFeedbackType = (typeof feedbackTypes)[number];
export type ProductFeedbackStatus = (typeof feedbackStatuses)[number];
export type ProductFeedbackAttachmentContentType = "image/png" | "image/jpeg" | "image/webp";

export type ProductFeedbackAttachmentDto = {
  id: string;
  feedbackId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: ProductFeedbackAttachmentContentType;
  sizeBytes: number;
  checksum: string;
  sortOrder: number;
  createdAt: string;
};

export type ProductFeedbackDto = {
  id: string;
  organizationId: string;
  submitterUserId: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachmentDto[];
};

export type InsertProductFeedbackInput = {
  id: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
};

export type InsertProductFeedbackAttachmentInput = {
  id: string;
  storageKey: string;
  fileName: string;
  contentType: ProductFeedbackAttachmentContentType;
  sizeBytes: number;
  checksum: string;
  sortOrder: number;
};

export type ListProductFeedbackQuery = {
  status?: ProductFeedbackStatus;
  feedbackType?: ProductFeedbackType;
  q?: string;
  pagePath?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: {
    createdAt: string;
    id: string;
  };
  limit?: number;
};

export type ListProductFeedbackResult = {
  items: ProductFeedbackDto[];
  nextCursor: { createdAt: string; id: string } | null;
};

export type UpdateProductFeedbackPatch = {
  status?: ProductFeedbackStatus;
  adminNote?: string | null;
};
