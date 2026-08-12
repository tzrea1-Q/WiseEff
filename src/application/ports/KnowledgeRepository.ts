import type {
  KnowledgeContentForm,
  KnowledgeEntry,
  KnowledgeRevision,
  KnowledgeSearchResult,
  KnowledgeStatus
} from "@/domain/knowledge/types";

export type KnowledgeListQuery = {
  status?: KnowledgeStatus;
  contentForm?: KnowledgeContentForm;
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
  update(entryId: string, input: UpdateKnowledgeInput): Promise<KnowledgeEntry>;
  publish(entryId: string): Promise<KnowledgeEntry>;
  archive(entryId: string): Promise<KnowledgeEntry>;
  restore(entryId: string): Promise<KnowledgeEntry>;
  hardDelete(entryId: string): Promise<void>;
  listRevisions(entryId: string): Promise<KnowledgeRevision[]>;
  restoreRevision(entryId: string, revisionId: string, expectedHeadRevisionNumber: number): Promise<KnowledgeEntry>;
  search(q: string): Promise<KnowledgeSearchResult[]>;
  getFileObjectUrl(entryId: string): Promise<string>;
}
