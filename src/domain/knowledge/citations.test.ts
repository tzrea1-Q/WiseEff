import { describe, expect, it } from "vitest";
import { formatKnowledgePageLabel, knowledgeEntryHref, parseKnowledgeEntryQuery } from "./citations";

const revisionId = "b7d73ebe-d4db-4b28-a9f9-e159a0000001";

describe("knowledge citation links", () => {
  it("keeps plain entry links unchanged and round-trips a revision and physical page", () => {
    expect(knowledgeEntryHref({ entryId: "a b&c" })).toBe("/knowledge?entryId=a%20b%26c");
    const href = knowledgeEntryHref({ entryId: "a b&c", revisionId, page: 3 });
    expect(parseKnowledgeEntryQuery(new URL(href, "https://example.test").searchParams)).toEqual({ entryId: "a b&c", revisionId, page: 3 });
    expect(knowledgeEntryHref({ entryId: "entry", revisionId })).toBe(`/knowledge?entryId=entry&revisionId=${revisionId}`);
  });

  it.each(["0", "-1", "1.5", "NaN", "9007199254740992", "01", "1e2", " 2"])("ignores invalid page %s", (page) => {
    expect(parseKnowledgeEntryQuery(new URLSearchParams({ page })).page).toBeNull();
  });

  it("accepts safe integer pages and UUID revisions only", () => {
    expect(parseKnowledgeEntryQuery(new URLSearchParams({ page: "9007199254740991", revisionId })).page).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseKnowledgeEntryQuery(new URLSearchParams({ revisionId: "missing" })).revisionId).toBeNull();
    expect(parseKnowledgeEntryQuery(new URLSearchParams())).toEqual({ entryId: null, revisionId: null, page: null });
  });

  it("formats physical pages, ranges and recorded page lists", () => {
    expect(formatKnowledgePageLabel(3)).toBe("第 3 页");
    expect(formatKnowledgePageLabel(3, 3)).toBe("第 3 页");
    expect(formatKnowledgePageLabel(3, 7)).toBe("第 3–7 页");
    expect(formatKnowledgePageLabel([3, 7])).toBe("第 3、7 页");
  });
});
