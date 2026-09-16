export const feedbackTypes = ["experience", "data", "export_submit", "feature"] as const;
export const feedbackStatuses = ["open", "in_progress", "resolved", "closed"] as const;
export const feedbackResolutionCodes = [
  "completed",
  "duplicate",
  "cannot_reproduce",
  "not_planned",
  "invalid",
  "other"
] as const;
export const progressEventKinds = [
  "submitted",
  "status_changed",
  "progress",
  "reopened",
  "legacy_note"
] as const;

export type ProductFeedbackType = (typeof feedbackTypes)[number];
export type ProductFeedbackStatus = (typeof feedbackStatuses)[number];
export type ProductFeedbackResolutionCode = (typeof feedbackResolutionCodes)[number];
export type ProductFeedbackProgressEventKind = (typeof progressEventKinds)[number];
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

export type SubmitterIdentityDto = {
  id: string | null;
  name: string;
  username: string | null;
};

export type ProductFeedbackProgressEventUserDto = {
  id: string;
  feedbackId: string;
  kind: ProductFeedbackProgressEventKind;
  fromStatus: ProductFeedbackStatus | null;
  toStatus: ProductFeedbackStatus | null;
  resolutionCode: ProductFeedbackResolutionCode | null;
  publicMessage: string | null;
  createdAt: string;
};

export type ProductFeedbackProgressEventAdminDto = ProductFeedbackProgressEventUserDto & {
  actorUserId: string | null;
  internalMessage: string | null;
};

export type ProductFeedbackUserDto = {
  id: string;
  organizationId: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  resolutionCode: ProductFeedbackResolutionCode | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachmentDto[];
  progressEvents: ProductFeedbackProgressEventUserDto[];
  latestPublicProgress?: string | null;
};

export type ProductFeedbackAdminDto = {
  id: string;
  organizationId: string;
  submitterUserId: string | null;
  submitter: SubmitterIdentityDto;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  resolutionCode: ProductFeedbackResolutionCode | null;
  adminNote: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachmentDto[];
  progressEvents: ProductFeedbackProgressEventAdminDto[];
  latestPublicProgress?: string | null;
};

export type ProductFeedbackDto = ProductFeedbackAdminDto;

export type InsertProductFeedbackInput = {
  id: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  submittedAt?: string | null;
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
  items: ProductFeedbackAdminDto[];
  nextCursor: { createdAt: string; id: string } | null;
};

export type ListMyFeedbackQuery = {
  cursor?: {
    updatedAt: string;
    id: string;
  };
  limit?: number;
};

export type ListMyFeedbackResult = {
  items: ProductFeedbackUserDto[];
  nextCursor: { updatedAt: string; id: string } | null;
};

export type UpdateProductFeedbackPatch = {
  status?: ProductFeedbackStatus;
  adminNote?: string | null;
};

