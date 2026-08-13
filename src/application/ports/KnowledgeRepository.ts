import type {
  KnowledgeContentForm,
  KnowledgeEntry,
  KnowledgeIndexHealth,
  KnowledgeRevision,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  KnowledgeSourceType,
  KnowledgeStatus
} from "@/domain/knowledge/types";

export type KnowledgeListQuery = {
  status?: KnowledgeStatus;
  contentForm?: KnowledgeContentForm;
  sourceType?: KnowledgeSourceType;
  tag?: string;
  q?: string;
};

export type CreateMarkdownKnowledgeInput = {
  title: string;
  tags: string[];
  contentMarkdown: string;
};

export type CreateFileKnowledgeInput = {
  title: string;
  tags: string[];
  file: File;
};

export type UpdateKnowledgeInput = {
  expectedHeadRevisionNumber: number;
  title?: string;
  tags?: string[];
  contentMarkdown?: string;
  file?: File;
};

/**
 * Thrown by repository implementations when a save carries a stale expected
 * head revision. UI code offers a reload-and-retry path instead of overwriting.
 */
export class KnowledgeRevisionConflictError extends Error {
  constructor(
    message: string,
    public readonly expectedHeadRevisionNumber: number,
    public readonly currentHeadRevisionNumber: number
  ) {
    super(message);
    this.name = "KnowledgeRevisionConflictError";
  }
}

export interface KnowledgeRepository {
  list(query?: KnowledgeListQuery): Promise<{ items: KnowledgeEntry[] }>;
  get(entryId: string): Promise<KnowledgeEntry | null>;
  createMarkdown(input: CreateMarkdownKnowledgeInput): Promise<KnowledgeEntry>;
  createFile(input: CreateFileKnowledgeInput): Promise<KnowledgeEntry>;
  /** Distil a completed log-analysis record into a pre-filled knowledge draft. */
  distillFromLog(logId: string): Promise<KnowledgeEntry>;
  update(entryId: string, input: UpdateKnowledgeInput): Promise<KnowledgeEntry>;
  publish(entryId: string): Promise<KnowledgeEntry>;
  archive(entryId: string): Promise<KnowledgeEntry>;
  restore(entryId: string): Promise<KnowledgeEntry>;
  /** Archive-reject an agent-sourced draft from the publish queue. */
  rejectAgentDraft(entryId: string): Promise<KnowledgeEntry>;
  hardDelete(entryId: string): Promise<void>;
  listRevisions(entryId: string): Promise<KnowledgeRevision[]>;
  restoreRevision(entryId: string, revisionId: string, expectedHeadRevisionNumber: number): Promise<KnowledgeEntry>;
  /** Hybrid search response: items plus the retrieval mode that actually ran. */
  search(q: string): Promise<KnowledgeSearchResponse>;
  /**
   * Related published knowledge for a completed log-analysis record, derived
   * from its stored conclusion/impact text (log result page recommendations).
   */
  relatedToLog(logId: string): Promise<KnowledgeSearchResponse>;
  /**
   * Published entries structurally referencing one parameter definition
   * (definition detail 相关知识; published-only, org-scoped server-side).
   */
  relatedToSpec(specId: string): Promise<{ items: KnowledgeSearchResult[] }>;
  /** Add a structural definition reference (idempotent; entry-edit gated). */
  addParameterReference(entryId: string, specId: string): Promise<KnowledgeEntry>;
  /** Remove a structural definition reference (entry-edit gated). */
  removeParameterReference(entryId: string, specId: string): Promise<KnowledgeEntry>;
  getFileObjectUrl(entryId: string): Promise<string>;
  /** Index health governance surface (knowledge:manage). */
  getIndexHealth(): Promise<KnowledgeIndexHealth>;
  retryEntryIndex(entryId: string): Promise<void>;
  rebuildIndex(): Promise<{ enqueued: number }>;
}
