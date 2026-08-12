import { describe, expect, it } from "vitest";

import type { Queryable, QueryResult } from "../../shared/database/client";
import { createDeterministicEmbeddingClient } from "./indexing/embeddingClient";
import { searchPublishedKnowledgeForLogAnalysis } from "./logDomainRetrieval";

type QueryCall = { text: string; values: unknown[] };

/**
 * Scripted-SQL harness (same approach as the knowledge vector-path unit tests):
 * responses are matched on SQL fragments so the assertions can pin the exact
 * query shapes — published-only filters, the linked-entry restriction, and the
 * organization scoping — without a live pgvector database.
 */
function createScriptedDb(
  handlers: Array<{ match: string; rows: unknown[] | ((call: QueryCall) => unknown[]) }>
): { db: Queryable; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    calls,
    db: {
      query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
        const call = { text, values };
        calls.push(call);
        const handler = handlers.find((candidate) => text.includes(candidate.match));
        if (!handler) {
          throw new Error(`Unexpected query: ${text.slice(0, 120)}`);
        }
        const rows = typeof handler.rows === "function" ? handler.rows(call) : handler.rows;
        return { rows: rows as Row[], rowCount: rows.length };
      }
    }
  };
}

const entryRow = {
  id: "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a01",
  title: "E_THERMAL_FOLDBACK handbook",
  content_form: "markdown",
  tags: ["charging"],
  search_text: "E_THERMAL_FOLDBACK means thermal foldback protection engaged.",
  head_revision_id: "rev-1",
  updated_at: "2026-08-13T00:00:00.000Z"
};

const chunkRow = {
  entry_id: "6a4b2c9d-63e3-4b22-8b64-1a3b6b5d2b02",
  title: "Charging fault cases",
  content_form: "markdown",
  tags: [],
  revision_id: "rev-2",
  text: "Fault case: repeated foldback under high ambient temperature.",
  updated_at: "2026-08-13T00:00:00.000Z"
};

describe("searchPublishedKnowledgeForLogAnalysis", () => {
  it("restricts retrieval to the linked entry set and reports domain-linked scope", async () => {
    const { db, calls } = createScriptedDb([
      { match: "from knowledge_entries e", rows: [entryRow] },
      { match: "information_schema.columns", rows: [] }
    ]);

    const result = await searchPublishedKnowledgeForLogAnalysis(db, {
      organizationId: "org-1",
      query: "thermal foldback",
      linkedEntryIds: [entryRow.id]
    });

    expect(result.scope).toBe("domain-linked");
    expect(result.retrievalMode).toBe("fts_only");
    expect(result.items).toEqual([expect.objectContaining({ entryId: entryRow.id })]);

    const ftsCall = calls.find((call) => call.text.includes("from knowledge_entries e"));
    expect(ftsCall?.text).toContain("status = 'published'");
    expect(ftsCall?.text).toContain("e.id = any(");
    expect(ftsCall?.values[0]).toBe("org-1");
    expect(ftsCall?.values).toContainEqual([entryRow.id]);
  });

  it("falls back to organization-generic retrieval when the domain has no links and says so", async () => {
    const { db, calls } = createScriptedDb([
      { match: "from knowledge_entries e", rows: [entryRow] },
      { match: "information_schema.columns", rows: [] }
    ]);

    const result = await searchPublishedKnowledgeForLogAnalysis(db, {
      organizationId: "org-1",
      query: "thermal foldback",
      linkedEntryIds: []
    });

    expect(result.scope).toBe("organization-generic");
    const ftsCall = calls.find((call) => call.text.includes("from knowledge_entries e"));
    expect(ftsCall?.text).not.toContain("e.id = any(");
    expect(ftsCall?.text).toContain("status = 'published'");
  });

  it("fuses vector and FTS rankings with RRF when pgvector and an embedding client exist", async () => {
    const { db, calls } = createScriptedDb([
      { match: "from knowledge_entries e", rows: [entryRow] },
      { match: "information_schema.columns", rows: [{ exists: 1 }] },
      { match: "from knowledge_chunks c", rows: [chunkRow] }
    ]);

    const result = await searchPublishedKnowledgeForLogAnalysis(db, {
      organizationId: "org-1",
      query: "thermal foldback",
      linkedEntryIds: [entryRow.id, chunkRow.entry_id],
      embeddingClient: createDeterministicEmbeddingClient()
    });

    expect(result.scope).toBe("domain-linked");
    expect(result.retrievalMode).toBe("semantic_fts");
    expect(result.items.map((item) => item.entryId).sort()).toEqual([entryRow.id, chunkRow.entry_id].sort());

    const vectorCall = calls.find((call) => call.text.includes("from knowledge_chunks c"));
    expect(vectorCall?.text).toContain("e.status = 'published'");
    expect(vectorCall?.text).toContain("c.entry_id = any(");
    expect(vectorCall?.values[0]).toBe("org-1");
  });

  it("degrades to FTS-only per query when the embedding call fails", async () => {
    const { db } = createScriptedDb([
      { match: "from knowledge_entries e", rows: [entryRow] },
      { match: "information_schema.columns", rows: [{ exists: 1 }] }
    ]);

    const result = await searchPublishedKnowledgeForLogAnalysis(db, {
      organizationId: "org-1",
      query: "thermal foldback",
      linkedEntryIds: [entryRow.id],
      embeddingClient: {
        model: "failing",
        embed: async () => {
          throw new Error("embedding endpoint down");
        }
      }
    });

    expect(result.retrievalMode).toBe("fts_only");
    expect(result.items).toHaveLength(1);
  });
});
