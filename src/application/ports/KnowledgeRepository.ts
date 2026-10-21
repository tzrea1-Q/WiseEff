import type {
  KnowledgeContentForm,
  KnowledgeEntry,
  KnowledgeIndexHealth,
  KnowledgeImportOutcome,
  KnowledgeImportReport,
  KnowledgeOrigin,
  KnowledgeRevision,
  KnowledgeSearchResponse,
  KnowledgeSearchResult,
  KnowledgeSourceType,
  KnowledgeStatus
} from "@/domain/knowledge/types";

export type KnowledgeListQuery = {
  governable?: boolean;
  origin?: KnowledgeOrigin;
  status?: KnowledgeStatus;
  contentForm?: KnowledgeContentForm;
  sourceType?: KnowledgeSourceType;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

export type CreateMarkdownKnowledgeInput = {
  origin?: "authored" | "uploaded";
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
  openImport(tags: string[]): Promise<{ id: string }>;
  importDocument(batchId: string, input: { file: File; relativePath: string }): Promise<KnowledgeImportOutcome>;
  importArchive(batchId: string, file: File): Promise<{ outcomes: KnowledgeImportOutcome[] }>;
  getImport(batchId: string): Promise<KnowledgeImportReport>;
  completeImport(batchId: string): Promise<KnowledgeImportReport>;
  list(query?: KnowledgeListQuery): Promise<{ items: KnowledgeEntry[] }>;
  get(entryId: string): Promise<KnowledgeEntry | null>;
  /** Distinguish a dangling binding from a private entry without exposing its metadata. */
  getBinding(entryId: string): Promise<{ entry: KnowledgeEntry | null; deleted: boolean }>;
  createMarkdown(input: CreateMarkdownKnowledgeInput): Promise<KnowledgeEntry>;
  /** Upload a document: MD/TXT become markdown drafts; other formats remain file entries. */
  createFile(input: CreateFileKnowledgeInput): Promise<KnowledgeEntry>;
  /** Distil a completed log-analysis record into a pre-filled knowledge draft. */
  distillFromLog(logId: string): Promise<KnowledgeEntry>;
  /** Distil a terminal DTS reload run into a pre-filled knowledge draft. */
  distillFromReloadRun(runId: string): Promise<KnowledgeEntry>;
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
  /** Published knowledge for an exact canonical Definition identity. */
  relatedToDefinition(definitionId: string): Promise<{ items: KnowledgeSearchResult[] }>;
  /** Add or remove only a verified canonical Definition reference. */
  addDefinitionReference(entryId: string, definitionId: string): Promise<KnowledgeEntry>;
  removeDefinitionReference(entryId: string, definitionId: string): Promise<KnowledgeEntry>;
  /** Remove a structural definition reference (entry-edit gated). */
  removeParameterReference(entryId: string, specId: string): Promise<KnowledgeEntry>;
  getFileObjectUrl(entryId: string): Promise<string>;
  /** Index health governance surface (knowledge:manage). */
  getIndexHealth(): Promise<KnowledgeIndexHealth>;
  retryEntryIndex(entryId: string): Promise<void>;
  rebuildIndex(): Promise<{ enqueued: number }>;
}
