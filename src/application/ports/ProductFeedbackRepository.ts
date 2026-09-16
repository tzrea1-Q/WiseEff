import type {
  ProductFeedback,
  ProductFeedbackResolutionCode,
  ProductFeedbackStats,
  ProductFeedbackStatus,
  ProductFeedbackType
} from "@/domain/productFeedback/types";

export type ProductFeedbackSubmitInput = {
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  files: File[];
};

export type ProductFeedbackDraftCreateInput = {
  pagePath?: string;
  pageTitle?: string;
  feedbackType?: ProductFeedbackType;
  description?: string;
  files?: File[];
};

export type ProductFeedbackDraftPatchInput = {
  pagePath?: string;
  pageTitle?: string;
  feedbackType?: ProductFeedbackType;
  description?: string;
  retainedAttachmentIds?: string[];
  newFiles?: File[];
};

export type ProductFeedbackDraftSubmitInput = {
  pagePath?: string;
  pageTitle?: string;
  feedbackType?: ProductFeedbackType;
  description?: string;
};

export type ProductFeedbackAppendProgressInput = {
  toStatus?: ProductFeedbackStatus;
  resolutionCode?: ProductFeedbackResolutionCode | null;
  publicMessage?: string | null;
  internalMessage?: string | null;
};

export type { ProductFeedbackStats };

export type ProductFeedbackListQuery = {
  status?: ProductFeedbackStatus;
  feedbackType?: ProductFeedbackType;
  q?: string;
  pagePath?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
};

export interface ProductFeedbackRepository {
  submit(input: ProductFeedbackSubmitInput): Promise<ProductFeedback>;
  list(query?: ProductFeedbackListQuery): Promise<{ items: ProductFeedback[]; nextCursor?: string }>;
  get(id: string): Promise<ProductFeedback | null>;
  update(id: string, patch: { status?: ProductFeedbackStatus; adminNote?: string | null }): Promise<ProductFeedback>;
  appendProgress?(id: string, input: ProductFeedbackAppendProgressInput): Promise<ProductFeedback>;
  getStats?(): Promise<ProductFeedbackStats>;
  getAttachmentObjectUrl(feedbackId: string, attachmentId: string): Promise<string>;

  createDraft?(input?: ProductFeedbackDraftCreateInput): Promise<ProductFeedback>;
  saveDraft?(id: string, input: ProductFeedbackDraftPatchInput): Promise<ProductFeedback>;
  deleteDraft?(id: string): Promise<{ ok: boolean }>;
  submitDraft?(id: string, input?: ProductFeedbackDraftSubmitInput): Promise<ProductFeedback>;
  listMine?(query?: { cursor?: string; limit?: number }): Promise<{ items: ProductFeedback[]; nextCursor?: string }>;
  getMine?(id: string): Promise<ProductFeedback | null>;
  getMineAttachmentObjectUrl?(feedbackId: string, attachmentId: string): Promise<string>;
}
