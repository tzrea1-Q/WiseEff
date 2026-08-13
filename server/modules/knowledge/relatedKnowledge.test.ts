import { describe, expect, it, vi } from "vitest";

import type { LogRecordDto } from "../logs/types";
import type { Queryable, QueryResult } from "../../shared/database/client";
import { getLogRecord } from "../logs/service";
import { createDeterministicEmbeddingClient } from "./indexing/embeddingClient";
import {
  deriveRelatedKnowledgeQuery,
  RELATED_KNOWLEDGE_MAX_VECTOR_DISTANCE,
  RELATED_KNOWLEDGE_MIN_TEXT_SIMILARITY
} from "./relatedKnowledge";
import { findRelatedKnowledgeForLog } from "./service";

vi.mock("../logs/service", () => ({
  getLogRecord: vi.fn()
}));

describe("deriveRelatedKnowledgeQuery", () => {
  it("joins conclusion and impact with collapsed whitespace", () => {
    expect(
      deriveRelatedKnowledgeQuery({
        conclusion: "  快充后段降频源于\n温度超过 45 度  ",
        impact: "夜间快充时长增加约 25 分钟。"
      })
    ).toBe("快充后段降频源于 温度超过 45 度 夜间快充时长增加约 25 分钟。");
  });

  it("skips empty parts and returns an empty query when nothing is stored", () => {
    expect(deriveRelatedKnowledgeQuery({ conclusion: "结论文本", impact: "   " })).toBe("结论文本");
    expect(deriveRelatedKnowledgeQuery({ conclusion: "", impact: "" })).toBe("");
  });

  it("caps the derived query length", () => {
    const query = deriveRelatedKnowledgeQuery({ conclusion: "长".repeat(500), impact: "尾".repeat(100) });
    expect(query).toHaveLength(400);
  });
});

/**
 * Scripted-SQL harness for the vector path (same approach as the knowledge
 * vector-path unit tests): the local and CI PostgreSQL have no pgvector, so
 * the fusion branch is pinned on exact query shapes instead of a live scan.
 */
type QueryCall = { text: string; values: unknown[] };

function createScriptedDb(
  handlers: Array<{ match: string; rows: unknown[] }>
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
        return { rows: handler.rows as Row[], rowCount: handler.rows.length };
      }
    }
  };
}

function makeAuth() {
  return {
    user: { id: "user-1", organizationId: "org-1", name: "user-1", title: "Engineer", isActive: true },
    organization: { id: "org-1", name: "org-1" },
    roles: [{ projectId: null, roleId: "hardware-user" as const }],
    permissions: ["knowledge:view", "logs:view"]
  };
}

function completedLog(): LogRecordDto {
  return {
    id: "log-1",
    reportId: "RPT-1",
    fileName: "charging.log",
    source: "upload",
    fileSizeBytes: 2048,
    status: "complete",
    archiveState: "active",
    stage: "report",
    confidence: 87,
    conclusion: "快充后段降频源于电池温度超过 45 度触发降流保护",
    impact: "夜间快充整体时长增加约 25 分钟。",
    evidence: [],
    suggestedActions: [],
    severity: "Critical",
    rawLines: [],
    capturedAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    submittedBy: "user-1"
  };
}

const textRow = {
  id: "5f3a1f8e-52f2-4a11-9a53-0f2a5a4c1a01",
  title: "快充温控降流案例",
  content_form: "markdown",
  tags: ["快充"],
  search_text: "快充后段降频源于电池温度超过 45 度触发降流保护",
  head_revision_id: "rev-1",
  updated_at: "2026-08-13T00:00:00.000Z"
};

const chunkRow = {
  entry_id: "6a4b2c9d-63e3-4b22-8b64-1a3b6b5d2b02",
  title: "热降额故障案例集",
  content_form: "markdown",
  tags: [],
  revision_id: "rev-2",
  text: "高温环境下反复触发热降额的案例。",
  updated_at: "2026-08-13T00:00:00.000Z"
};

describe("findRelatedKnowledgeForLog (scripted vector path)", () => {
  it("fuses the trigram and vector rankings with the relevance cutoffs and reports semantic_fts", async () => {
    vi.mocked(getLogRecord).mockResolvedValue(completedLog());
    const { db, calls } = createScriptedDb([
      { match: "information_schema.columns", rows: [{ exists: 1 }] },
      { match: "word_similarity", rows: [textRow] },
      { match: "from knowledge_chunks c", rows: [chunkRow] }
    ]);

    const result = await findRelatedKnowledgeForLog(
      db,
      makeAuth(),
      { logId: "log-1" },
      { embeddingClient: createDeterministicEmbeddingClient() }
    );

    expect(result.retrieval).toMatchObject({ mode: "semantic_fts", vectorAvailable: true, embeddingConfigured: true });
    expect(result.items.map((item) => item.entryId).sort()).toEqual([textRow.id, chunkRow.entry_id].sort());

    const textCall = calls.find((call) => call.text.includes("word_similarity"));
    expect(textCall?.text).toContain("status = 'published'");
    expect(textCall?.values).toEqual(["org-1", expect.stringContaining("快充后段降频"), RELATED_KNOWLEDGE_MIN_TEXT_SIMILARITY, 5]);

    const vectorCall = calls.find((call) => call.text.includes("from knowledge_chunks c"));
    expect(vectorCall?.text).toContain("e.status = 'published'");
    expect(vectorCall?.text).toContain("<=");
    expect(vectorCall?.values).toContainEqual(RELATED_KNOWLEDGE_MAX_VECTOR_DISTANCE);
  });

  it("degrades to trigram-only per query when the embedding call fails and says why", async () => {
    vi.mocked(getLogRecord).mockResolvedValue(completedLog());
    const { db } = createScriptedDb([
      { match: "information_schema.columns", rows: [{ exists: 1 }] },
      { match: "word_similarity", rows: [textRow] }
    ]);

    const result = await findRelatedKnowledgeForLog(
      db,
      makeAuth(),
      { logId: "log-1" },
      {
        embeddingClient: {
          model: "failing",
          embed: async () => {
            throw new Error("embedding endpoint down");
          }
        }
      }
    );

    expect(result.retrieval).toMatchObject({ mode: "fts_only", degradedReason: "embedding endpoint down" });
    expect(result.items).toEqual([expect.objectContaining({ entryId: textRow.id })]);
  });

  it("runs trigram-only without querying chunks when pgvector is absent", async () => {
    vi.mocked(getLogRecord).mockResolvedValue(completedLog());
    const { db, calls } = createScriptedDb([
      { match: "information_schema.columns", rows: [] },
      { match: "word_similarity", rows: [textRow] }
    ]);

    const result = await findRelatedKnowledgeForLog(
      db,
      makeAuth(),
      { logId: "log-1" },
      { embeddingClient: createDeterministicEmbeddingClient() }
    );

    expect(result.retrieval).toMatchObject({ mode: "fts_only", vectorAvailable: false, embeddingConfigured: true });
    expect(calls.some((call) => call.text.includes("from knowledge_chunks c"))).toBe(false);
  });
});
