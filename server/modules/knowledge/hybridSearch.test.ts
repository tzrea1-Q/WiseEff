import { describe, expect, it } from "vitest";

import { fuseKnowledgeSearchResults } from "./hybridSearch";
import type { KnowledgeSearchResultDto } from "./types";

function item(entryId: string, excerpt = `excerpt-${entryId}`): KnowledgeSearchResultDto {
  return {
    entryId,
    title: `Title ${entryId}`,
    contentForm: "markdown",
    tags: [],
    excerpt,
    updatedAt: "2026-08-12T00:00:00.000Z",
    revisionId: `rev-${entryId}`
  };
}

describe("fuseKnowledgeSearchResults", () => {
  it("ranks entries present in both rankings above single-ranking entries", () => {
    const fused = fuseKnowledgeSearchResults({
      fts: [item("a"), item("b")],
      vector: [item("c"), item("a")],
      limit: 10
    });

    expect(fused[0].entryId).toBe("a");
    expect(fused.map((entry) => entry.entryId)).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });

  it("keeps the FTS excerpt for entries in both rankings and the chunk excerpt for vector-only hits", () => {
    const fused = fuseKnowledgeSearchResults({
      fts: [item("a", "fts-highlight")],
      vector: [item("a", "chunk-context"), item("v", "chunk-only")],
      limit: 10
    });

    expect(fused.find((entry) => entry.entryId === "a")?.excerpt).toBe("fts-highlight");
    expect(fused.find((entry) => entry.entryId === "v")?.excerpt).toBe("chunk-only");
  });

  it("respects the limit after fusion", () => {
    const fused = fuseKnowledgeSearchResults({
      fts: [item("a"), item("b"), item("c")],
      vector: [item("d"), item("e")],
      limit: 2
    });
    expect(fused).toHaveLength(2);
  });

  it("returns FTS ordering unchanged when the vector ranking is empty", () => {
    const fused = fuseKnowledgeSearchResults({ fts: [item("a"), item("b")], vector: [], limit: 5 });
    expect(fused.map((entry) => entry.entryId)).toEqual(["a", "b"]);
  });
});
