export const knowledgeContentForms = ["markdown", "file"] as const;
export const knowledgeStatuses = ["draft", "published", "archived"] as const;
export const knowledgeSourceTypes = ["human", "agent"] as const;
export const knowledgeExtractionStatuses = ["pending", "succeeded", "failed"] as const;

export type KnowledgeContentForm = (typeof knowledgeContentForms)[number];
export type KnowledgeStatus = (typeof knowledgeStatuses)[number];
export type KnowledgeSourceType = (typeof knowledgeSourceTypes)[number];
export type KnowledgeExtractionStatus = (typeof knowledgeExtractionStatuses)[number];

export type KnowledgeFileDto = {
  id: string;
  entryId: string;
  organizationId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  extractionStatus: KnowledgeExtractionStatus;
  extractionError: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Structural reference from a knowledge entry to a parameter definition.
 * Binds to `parameter_specs.id` — the stable surrogate (ADR-0017) — so identity
 * corrections never break it; the lifecycle is reported honestly so deprecated
 * definitions (ADR-0011 soft retirement) render an explicit badge while the
 * reference survives.
 */
export type KnowledgeParameterReferenceDto = {
  specId: string;
  propertyKey: string;
  displayName: string | null;
  /** Attribution-subject display name (the module humans know the definition by). */
  driverModule: string | null;
  lifecycle: "draft" | "active" | "deprecated";
  createdByUserId: string;
  createdAt: string;
};

export type KnowledgeEntryDto = {
  id: string;
  organizationId: string;
  title: string;
  contentForm: KnowledgeContentForm;
  status: KnowledgeStatus;
  tags: string[];
  sourceType: KnowledgeSourceType;
  sourceSessionId: string | null;
  /** Log-analysis record this entry was distilled from (Phase 3 distillation). */
  sourceLogId: string | null;
  /** DTS reload run this entry was distilled from (deferred roadmap item 3). */
  sourceReloadRunId: string | null;
  createdByUserId: string;
  headRevisionId: string | null;
  headRevisionNumber: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  /** Head-revision markdown content for markdown-form entries. */
  contentMarkdown: string | null;
  /** Current file metadata for file-form entries. */
  file: KnowledgeFileDto | null;
  /** Structural parameter-definition references (deferred roadmap item 2). */
  parameterReferences: KnowledgeParameterReferenceDto[];
};

export type KnowledgeRevisionDto = {
  id: string;
  entryId: string;
  organizationId: string;
  revisionNumber: number;
  title: string;
  tags: string[];
  contentMarkdown: string | null;
  fileId: string | null;
  authorUserId: string;
  restoredFromRevisionId: string | null;
  createdAt: string;
};

export type KnowledgeSearchResultDto = {
  entryId: string;
  title: string;
  contentForm: KnowledgeContentForm;
  tags: string[];
  excerpt: string;
  updatedAt: string;
  /** Head revision at match time — citation-ready deep-link identity. */
  revisionId: string | null;
};

export const knowledgeRetrievalModes = ["semantic_fts", "fts_only"] as const;
export type KnowledgeRetrievalMode = (typeof knowledgeRetrievalModes)[number];

/** Honest retrieval-mode report: what actually ran for this query and why. */
export type KnowledgeRetrievalInfo = {
  mode: KnowledgeRetrievalMode;
  vectorAvailable: boolean;
  embeddingConfigured: boolean;
  degradedReason?: string;
};

export type KnowledgeSearchResponseDto = {
  items: KnowledgeSearchResultDto[];
  retrieval: KnowledgeRetrievalInfo;
};

export type ListKnowledgeEntriesQuery = {
  status?: KnowledgeStatus;
  contentForm?: KnowledgeContentForm;
  sourceType?: KnowledgeSourceType;
  tag?: string;
  q?: string;
  limit?: number;
};

export type InsertKnowledgeEntryInput = {
  id: string;
  title: string;
  contentForm: KnowledgeContentForm;
  tags: string[];
  sourceType: KnowledgeSourceType;
  sourceSessionId: string | null;
  sourceLogId: string | null;
  sourceReloadRunId: string | null;
  searchText: string;
};

export type InsertKnowledgeRevisionInput = {
  id: string;
  entryId: string;
  revisionNumber: number;
  title: string;
  tags: string[];
  contentMarkdown: string | null;
  fileId: string | null;
  restoredFromRevisionId: string | null;
};

export type InsertKnowledgeFileInput = {
  id: string;
  entryId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
};
