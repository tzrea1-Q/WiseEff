export const productFeedbackTypes = ["experience", "data", "export_submit", "feature"] as const;
export const productFeedbackStatuses = ["open", "in_progress", "closed"] as const;

export type ProductFeedbackType = (typeof productFeedbackTypes)[number];
export type ProductFeedbackStatus = (typeof productFeedbackStatuses)[number];
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

export type ProductFeedback = {
  id: string;
  submitterUserId?: string;
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  status: ProductFeedbackStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: ProductFeedbackAttachment[];
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
  closed: "已关闭"
};
