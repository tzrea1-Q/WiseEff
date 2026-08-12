export const knowledgeContentForms = ["markdown", "file"] as const;
export const knowledgeStatuses = ["draft", "published", "archived"] as const;
export const knowledgeExtractionStatuses = ["pending", "succeeded", "failed"] as const;

export type KnowledgeContentForm = (typeof knowledgeContentForms)[number];
export type KnowledgeStatus = (typeof knowledgeStatuses)[number];
export type KnowledgeExtractionStatus = (typeof knowledgeExtractionStatuses)[number];
export type KnowledgeSourceType = "human" | "agent";

export type KnowledgeFileMeta = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  extractionStatus: KnowledgeExtractionStatus;
  extractionError: string | null;
  createdAt: string;
};

export type KnowledgeEntry = {
  id: string;
  title: string;
  contentForm: KnowledgeContentForm;
  status: KnowledgeStatus;
  tags: string[];
  sourceType: KnowledgeSourceType;
  createdByUserId: string;
  headRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  contentMarkdown: string | null;
  file: KnowledgeFileMeta | null;
};

export type KnowledgeRevision = {
  id: string;
  entryId: string;
  revisionNumber: number;
  title: string;
  tags: string[];
  contentMarkdown: string | null;
  fileId: string | null;
  authorUserId: string;
  restoredFromRevisionId: string | null;
  createdAt: string;
};

export type KnowledgeSearchResult = {
  entryId: string;
  title: string;
  contentForm: KnowledgeContentForm;
  tags: string[];
  excerpt: string;
  updatedAt: string;
};

export const knowledgeStatusLabels: Record<KnowledgeStatus, string> = {
  draft: "草稿",
  published: "已发布",
  archived: "已归档"
};

export const knowledgeContentFormLabels: Record<KnowledgeContentForm, string> = {
  markdown: "Markdown",
  file: "文件"
};

export const knowledgeExtractionStatusLabels: Record<KnowledgeExtractionStatus, string> = {
  pending: "提取中",
  succeeded: "提取成功",
  failed: "提取失败"
};

export const knowledgeSourceTypeLabels: Record<KnowledgeSourceType, string> = {
  human: "人工",
  agent: "Agent"
};
