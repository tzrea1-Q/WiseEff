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
  /** Xiaoze session that distilled this entry (agent-sourced drafts only). */
  sourceSessionId: string | null;
  /** Log-analysis record this entry was distilled from, if any. */
  sourceLogId: string | null;
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
  /** Head revision at match time — citation-ready deep-link identity. */
  revisionId: string | null;
};

export type KnowledgeRetrievalMode = "semantic_fts" | "fts_only";

/** Honest retrieval-mode report from the search/index APIs. */
export type KnowledgeRetrievalInfo = {
  mode: KnowledgeRetrievalMode;
  vectorAvailable: boolean;
  embeddingConfigured: boolean;
  degradedReason?: string;
};

export type KnowledgeSearchResponse = {
  items: KnowledgeSearchResult[];
  retrieval: KnowledgeRetrievalInfo;
};

export const knowledgeIndexStates = ["pending", "processing", "succeeded", "failed"] as const;
export type KnowledgeIndexState = (typeof knowledgeIndexStates)[number];

export type KnowledgeIndexStatusItem = {
  entryId: string;
  title: string;
  entryStatus: KnowledgeStatus;
  status: KnowledgeIndexState;
  error: string | null;
  indexedRevisionNumber: number | null;
  chunkCount: number;
  embeddedChunkCount: number;
  updatedAt: string;
};

export type KnowledgeIndexHealth = {
  retrieval: KnowledgeRetrievalInfo;
  items: KnowledgeIndexStatusItem[];
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

export const knowledgeIndexStateLabels: Record<KnowledgeIndexState, string> = {
  pending: "排队中",
  processing: "索引中",
  succeeded: "已索引",
  failed: "失败"
};

export const knowledgeRetrievalModeLabels: Record<KnowledgeRetrievalMode, string> = {
  semantic_fts: "语义 + 全文混合检索",
  fts_only: "仅全文检索(FTS-only)"
};
