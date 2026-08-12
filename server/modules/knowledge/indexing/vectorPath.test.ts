import { describe, expect, it } from "vitest";

import type { Database } from "../../../shared/database/client";
import { createDeterministicEmbeddingClient } from "./embeddingClient";
import { indexKnowledgeEntry } from "./service";

type RecordedQuery = { text: string; values: unknown[] };

/**
 * Scripted Database double for the vector branch: pgvector is not available on
 * the local/CI PostgreSQL, so the embedding write path is exercised against
 * recorded SQL (the real pgvector loop lives in vectorSearch.integration.test.ts
 * and skips with a reason when the extension is absent).
 */
function createScriptedDb(options: {
  entrySnapshotRow: Record<string, unknown> | null;
  vectorSupport: boolean;
}): { db: Database; recorded: RecordedQuery[] } {
  const recorded: RecordedQuery[] = [];

  const query = async <Row>(text: string, values: unknown[] = []): Promise<{ rows: Row[]; rowCount: number | null }> => {
    recorded.push({ text, values });
    if (text.includes("from knowledge_entries e")) {
      return { rows: (options.entrySnapshotRow ? [options.entrySnapshotRow] : []) as Row[], rowCount: null };
    }
    if (text.includes("information_schema.columns")) {
      return { rows: (options.vectorSupport ? [{ ok: 1 }] : []) as Row[], rowCount: null };
    }
    return { rows: [] as Row[], rowCount: 0 };
  };

  const db: Database = {
    query,
    transaction: async (fn) => fn(db)
  };
  return { db, recorded };
}

const markdownSnapshotRow = {
  id: "entry-1",
  organization_id: "org-1",
  status: "published",
  content_form: "markdown",
  title: "快充温控调参经验",
  tags: ["快充"],
  head_revision_id: "rev-1",
  head_revision_number: 3,
  content_markdown: "# 背景\n\n当电池温度超过 45 度时降流。",
  extracted_text: null,
  extraction_status: null,
  extraction_error: null
};

describe("indexKnowledgeEntry vector path (scripted db)", () => {
  it("writes chunk embeddings as pgvector literals and records the embedding model", async () => {
    const { db, recorded } = createScriptedDb({ entrySnapshotRow: markdownSnapshotRow, vectorSupport: true });
    const embeddingClient = createDeterministicEmbeddingClient({ dimensions: 8 });

    const result = await indexKnowledgeEntry(db, {
      entryId: "entry-1",
      organizationId: "org-1",
      embeddingClient
    });

    expect(result).toMatchObject({ outcome: "indexed" });
    if (result.outcome !== "indexed") throw new Error("expected indexed outcome");
    expect(result.embeddedChunkCount).toBe(result.chunkCount);

    const inserts = recorded.filter((entry) => entry.text.includes("insert into knowledge_chunks"));
    expect(inserts.length).toBe(result.chunkCount);
    for (const insert of inserts) {
      expect(insert.text).toContain("embedding");
      expect(insert.text).toContain("::vector");
      const literal = insert.values[6];
      expect(String(literal)).toMatch(/^\[[-0-9.,eE]+\]$/);
    }

    const statusUpdate = recorded.find((entry) => entry.text.includes("update knowledge_index_status") && entry.text.includes("embedding_model"));
    expect(statusUpdate?.values).toContain("succeeded");
    expect(statusUpdate?.values).toContain("deterministic-fake-embedding");
  });

  it("skips embeddings when pgvector support is absent even with a client configured", async () => {
    const { db, recorded } = createScriptedDb({ entrySnapshotRow: markdownSnapshotRow, vectorSupport: false });

    const result = await indexKnowledgeEntry(db, {
      entryId: "entry-1",
      organizationId: "org-1",
      embeddingClient: createDeterministicEmbeddingClient()
    });

    expect(result).toMatchObject({ outcome: "indexed", embeddedChunkCount: 0 });
    const inserts = recorded.filter((entry) => entry.text.includes("insert into knowledge_chunks"));
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) {
      expect(insert.text).not.toContain("::vector");
    }
  });

  it("keeps FTS chunks but records an honest failure when the embedding API fails", async () => {
    const { db, recorded } = createScriptedDb({ entrySnapshotRow: markdownSnapshotRow, vectorSupport: true });

    const result = await indexKnowledgeEntry(db, {
      entryId: "entry-1",
      organizationId: "org-1",
      embeddingClient: {
        model: "broken",
        embed: async () => {
          throw new Error("Embedding API timed out after 10000ms.");
        }
      }
    });

    expect(result).toMatchObject({ outcome: "failed" });
    if (result.outcome !== "failed") throw new Error("expected failed outcome");
    expect(result.reason).toContain("timed out");

    const inserts = recorded.filter((entry) => entry.text.includes("insert into knowledge_chunks"));
    expect(inserts.length).toBeGreaterThan(0);
    for (const insert of inserts) {
      expect(insert.values[6]).toBeNull();
    }
    const statusUpdate = recorded.find((entry) => entry.text.includes("update knowledge_index_status") && entry.text.includes("embedding_model"));
    expect(statusUpdate?.values).toContain("failed");
    expect(String(statusUpdate?.values.find((value) => typeof value === "string" && value.includes("Embedding failed")))).toContain(
      "FTS chunks kept"
    );
  });
});
