export const productFeedbackTypes = ["experience", "data", "export_submit", "feature"] as const;
export const productFeedbackStatuses = ["open", "in_progress", "resolved", "closed"] as const;
export const productFeedbackResolutionCodes = [
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

export type ProductFeedbackType = (typeof productFeedbackTypes)[number];
export type ProductFeedbackStatus = (typeof productFeedbackStatuses)[number];
export type ProductFeedbackResolutionCode = (typeof productFeedbackResolutionCodes)[number];
export type ProductFeedbackProgressEventKind = (typeof progressEventKinds)[number];
export type ProductFeedbackAttachmentContentType = "image/png" | "image/jpeg" | "image/webp";

export type ProductFeedbackAttachment = {
  id: string;
  feedbackId: string;
  fileName: string;
  contentType: ProductFeedbackAttachmentContentType;
  sizeBytes: number;
  sortOrder: number;
  createdAt: string;
};

export type SubmitterIdentity = {
  id: string | null;
  name: string;
  username: string | null;
};

export type ProductFeedbackProgressEvent = {
  id: string;
  feedbackId: string;
  actorUserId?: string | null;
  kind: ProductFeedbackProgressEventKind;
  fromStatus?: ProductFeedbackStatus | null;
  toStatus?: ProductFeedbackStatus | null;
  resolutionCode?: ProductFeedbackResolutionCode | null;
  publicMessage?: string | null;
  internalMessage?: string | null;
  createdAt: string;
};

export type ProductFeedback = {
  id: string;
  submitterUserId?: string | null;
  submitter?: SubmitterIdentity;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  resolutionCode?: ProductFeedbackResolutionCode | null;
  adminNote: string | null;
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachment[];
  progressEvents?: ProductFeedbackProgressEvent[];
  latestPublicProgress?: string | null;
};

export const productFeedbackTypeLabels: Record<ProductFeedbackType, string> = {
  experience: "体验问题",
  data: "数据问题",
  export_submit: "导出/提交问题",
  feature: "功能建议"
};

export const productFeedbackStatusLabels: Record<ProductFeedbackStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭"
};

export const productFeedbackResolutionLabels: Record<ProductFeedbackResolutionCode, string> = {
  completed: "已解决",
  duplicate: "重复反馈",
  cannot_reproduce: "无法复现",
  not_planned: "暂不处理",
  invalid: "无效反馈",
  other: "其他"
};

export type ProductFeedbackStats = {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  closed: number;
};
