import { randomUUID } from "node:crypto";

import type { Database } from "../../../shared/database/client";
import { chunkExtractedText, chunkMarkdown } from "./chunking";
import type { KnowledgeEmbeddingClient } from "./embeddingClient";
import {
  deleteChunksForEntry,
  hasKnowledgeVectorSupport,
  insertChunks,
  markIndexOutcome
} from "./repository";

export type KnowledgeIndexEntrySnapshot = {
  entryId: string;
  organizationId: string;
  entryStatus: string;
  contentForm: "markdown" | "file";
  title: string;
  tags: string[];
  headRevisionId: string | null;
  headRevisionNumber: number;
  contentMarkdown: string | null;
  extractedText: string | null;
  extractionStatus: string | null;
  extractionError: string | null;
};

/** Worker-side load: the indexing worker is a system actor scoped by explicit org id. */
export async function loadIndexEntrySnapshot(
  db: Database,
  input: { entryId: string; organizationId: string }
): Promise<KnowledgeIndexEntrySnapshot | null> {
  const result = await db.query<{
    id: string;
    organization_id: string;
    status: string;
    content_form: "markdown" | "file";
    title: string;
    tags: string[];
    head_revision_id: string | null;
    head_revision_number: number | string;
    content_markdown: string | null;
    extracted_text: string | null;
    extraction_status: string | null;
    extraction_error: string | null;
  }>(
    `
    select e.id, e.organization_id, e.status, e.content_form, e.title, e.tags,
           e.head_revision_id, e.head_revision_number,
           r.content_markdown,
           f.extracted_text, f.extraction_status, f.extraction_error
    from knowledge_entries e
    left join knowledge_revisions r on r.id = e.head_revision_id
    left join knowledge_files f on f.id = r.file_id
    where e.organization_id = $1
      and e.id = $2
    limit 1
    `,
    [input.organizationId, input.entryId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    entryId: row.id,
    organizationId: row.organization_id,
    entryStatus: row.status,
    contentForm: row.content_form,
    title: row.title,
    tags: row.tags ?? [],
    headRevisionId: row.head_revision_id,
    headRevisionNumber: Number(row.head_revision_number),
    contentMarkdown: row.content_markdown,
    extractedText: row.extracted_text,
    extractionStatus: row.extraction_status,
    extractionError: row.extraction_error
  };
}

export type IndexEntryResult =
  | { outcome: "indexed"; chunkCount: number; embeddedChunkCount: number }
  | { outcome: "removed" }
  | { outcome: "failed"; reason: string }
  | { outcome: "missing" };

/**
 * (Re)builds the retrieval projection of one entry. Published entries get
 * fresh chunks (embedded when the client and pgvector are both available);
 * drafts and archived entries are removed from the searchable set — the
 * published-only invariant (D13) is enforced here and at query time.
 *
 * Embedding failures keep the FTS-usable chunks but surface as a failed index
 * status so /knowledge-admin shows the honest reason and offers retry.
 */
export async function indexKnowledgeEntry(
  db: Database,
  input: {
    entryId: string;
    organizationId: string;
    embeddingClient?: KnowledgeEmbeddingClient;
  }
): Promise<IndexEntryResult> {
  const snapshot = await loadIndexEntrySnapshot(db, input);
  if (!snapshot) {
    // The entry was hard-deleted after enqueue; the status row cascaded away.
    return { outcome: "missing" };
  }

  if (snapshot.entryStatus !== "published") {
    await db.transaction(async (tx) => {
      await deleteChunksForEntry(tx, input);
      await markIndexOutcome(tx, {
        entryId: input.entryId,
        organizationId: input.organizationId,
        status: "succeeded",
        indexedRevisionId: snapshot.headRevisionId,
        indexedRevisionNumber: snapshot.headRevisionNumber,
        chunkCount: 0,
        embeddedChunkCount: 0
      });
    });
    return { outcome: "removed" };
  }

  if (snapshot.contentForm === "file" && snapshot.extractionStatus !== "succeeded") {
    const reason =
      snapshot.extractionStatus === "failed"
        ? `Text extraction failed: ${snapshot.extractionError ?? "unknown reason"}`
        : "Extracted text is not available yet; the entry re-enqueues when extraction completes.";
    await markIndexOutcome(db, {
      entryId: input.entryId,
      organizationId: input.organizationId,
      status: "failed",
      error: reason,
      indexedRevisionId: snapshot.headRevisionId,
      indexedRevisionNumber: snapshot.headRevisionNumber
    });
    return { outcome: "failed", reason };
  }

  const drafts =
    snapshot.contentForm === "markdown"
      ? chunkMarkdown({ title: snapshot.title, markdown: snapshot.contentMarkdown ?? "" })
      : chunkExtractedText({ title: snapshot.title, text: snapshot.extractedText ?? "" });

  const vectorSupport = await hasKnowledgeVectorSupport(db);
  let embeddings: number[][] | null = null;
  let embeddingError: string | null = null;
  if (vectorSupport && input.embeddingClient && drafts.length > 0) {
    try {
      embeddings = await input.embeddingClient.embed(drafts.map((draft) => draft.text));
    } catch (error) {
      embeddingError = error instanceof Error ? error.message : String(error);
    }
  }

  const embeddedChunkCount = embeddings ? drafts.length : 0;
  await db.transaction(async (tx) => {
    await deleteChunksForEntry(tx, input);
    if (snapshot.headRevisionId) {
      await insertChunks(tx, {
        entryId: input.entryId,
        organizationId: input.organizationId,
        revisionId: snapshot.headRevisionId,
        vectorSupport,
        chunks: drafts.map((draft, position) => ({
          id: randomUUID(),
          chunkIndex: draft.chunkIndex,
          text: draft.text,
          embedding: embeddings ? embeddings[position] : null
        }))
      });
    }
    await markIndexOutcome(tx, {
      entryId: input.entryId,
      organizationId: input.organizationId,
      status: embeddingError ? "failed" : "succeeded",
      error: embeddingError ? `Embedding failed (FTS chunks kept): ${embeddingError}` : null,
      indexedRevisionId: snapshot.headRevisionId,
      indexedRevisionNumber: snapshot.headRevisionNumber,
      chunkCount: drafts.length,
      embeddedChunkCount,
      embeddingModel: embeddings ? input.embeddingClient?.model ?? null : null
    });
  });

  if (embeddingError) {
    return { outcome: "failed", reason: embeddingError };
  }
  return { outcome: "indexed", chunkCount: drafts.length, embeddedChunkCount };
}
