import { describe, expect, it, vi } from "vitest";

import { KnowledgeRevisionConflictError } from "@/application/ports/KnowledgeRepository";
import { createApiClient } from "./apiClient";
import { createHttpKnowledgeRepository, normalizeKnowledgeFileContentType, type KnowledgeEntryDto } from "./knowledgeClient";

const baseEntryDto: KnowledgeEntryDto = {
  id: "entry-1",
  organizationId: "org-1",
  title: "快充温控经验",
  contentForm: "markdown",
  status: "draft",
  tags: ["快充"],
  sourceType: "human",
  sourceSessionId: null,
  createdByUserId: "user-1",
  headRevisionId: "rev-1",
  headRevisionNumber: 1,
  createdAt: "2026-08-12T08:00:00.000Z",
  updatedAt: "2026-08-12T08:00:00.000Z",
  publishedAt: null,
  archivedAt: null,
  contentMarkdown: "正文",
  file: null
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function createRepository(fetchMock: typeof fetch) {
  return createHttpKnowledgeRepository({
    apiClient: createApiClient({ baseUrl: "http://127.0.0.1:8787", authorization: "Bearer test-token", fetchImpl: fetchMock }),
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: fetchMock
  });
}

describe("createHttpKnowledgeRepository", () => {
  it("lists entries with encoded filters", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ items: [baseEntryDto] }));
    const repository = createRepository(fetchMock);

    const result = await repository.list({ status: "published", tag: "快充", q: "温控" });
    expect(result.items[0]).toMatchObject({ id: "entry-1", title: "快充温控经验", headRevisionNumber: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:8787/api/v1/knowledge/entries?status=published&tag=%E5%BF%AB%E5%85%85&q=%E6%B8%A9%E6%8E%A7"
    );
  });

  it("creates a markdown entry", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item: baseEntryDto }, 201));
    const repository = createRepository(fetchMock);

    await repository.createMarkdown({ title: "快充温控经验", tags: ["快充"], contentMarkdown: "正文" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      contentForm: "markdown",
      title: "快充温控经验",
      tags: ["快充"],
      contentMarkdown: "正文"
    });
  });

  it("creates a file entry with base64 content and normalized content type", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item: baseEntryDto }, 201));
    const repository = createRepository(fetchMock);
    const file = new File(["pdf-bytes"], "manual.pdf", { type: "" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("pdf-bytes").buffer
    });

    await repository.createFile({ title: "手册", tags: [], file });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      contentForm: "file",
      title: "手册",
      tags: [],
      file: { fileName: "manual.pdf", contentType: "application/pdf", contentBase64: btoa("pdf-bytes") }
    });
  });

  it("translates 409 CONFLICT into KnowledgeRevisionConflictError", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: "CONFLICT",
            message: "Knowledge entry was changed by another save.",
            details: { code: "knowledge-revision-conflict", expectedHeadRevisionNumber: 1, currentHeadRevisionNumber: 3 },
            requestId: "req-1"
          }
        },
        409
      )
    );
    const repository = createRepository(fetchMock);

    let error: unknown;
    try {
      await repository.update("entry-1", { expectedHeadRevisionNumber: 1, contentMarkdown: "stale" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(KnowledgeRevisionConflictError);
    expect((error as KnowledgeRevisionConflictError).currentHeadRevisionNumber).toBe(3);
  });

  it("returns null for missing entries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: { code: "NOT_FOUND", message: "missing", details: {}, requestId: "req" } }, 404)
    );
    const repository = createRepository(fetchMock);
    expect(await repository.get("missing-entry")).toBeNull();
  });

  it("posts lifecycle transitions and revision restore with the expected head revision", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ item: baseEntryDto }));
    const repository = createRepository(fetchMock);

    await repository.publish("entry-1");
    await repository.restoreRevision("entry-1", "rev-9", 4);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v1/knowledge/entries/entry-1/publish");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/v1/knowledge/entries/entry-1/revisions/rev-9/restore");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ expectedHeadRevisionNumber: 4 });
  });

  it("searches published entries", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [{ entryId: "entry-1", title: "t", contentForm: "markdown", tags: [], excerpt: "e", updatedAt: "2026-08-12T08:00:00.000Z" }] })
    );
    const repository = createRepository(fetchMock);

    const results = await repository.search("温控");
    expect(results).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8787/api/v1/knowledge/search?q=%E6%B8%A9%E6%8E%A7");
  });

  it("normalizes file content types from extensions", () => {
    expect(normalizeKnowledgeFileContentType(new File([""], "a.pdf", { type: "" }))).toBe("application/pdf");
    expect(normalizeKnowledgeFileContentType(new File([""], "a.docx", { type: "" }))).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect(normalizeKnowledgeFileContentType(new File([""], "a.doc", { type: "" }))).toBe("application/msword");
    expect(normalizeKnowledgeFileContentType(new File([""], "a.md", { type: "" }))).toBe("text/markdown");
    expect(normalizeKnowledgeFileContentType(new File([""], "a.log", { type: "" }))).toBe("text/plain");
  });
});
