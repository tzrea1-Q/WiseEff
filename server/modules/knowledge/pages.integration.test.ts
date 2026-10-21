import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { createLocalObjectStore } from "../logs/objectStore";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { createInMemoryTestDatabase, isTestDatabaseAvailable, type InMemoryTestDatabase } from "../../testing/testDatabase";
import type { KnowledgeEntryDto, KnowledgeSearchResponseDto } from "./types";
import { registerKnowledgeRoutes } from "./routes";
import { processNextKnowledgeIndexJob } from "./indexing/worker";
import { knowledgeDtoSchemaCatalog } from "../contracts/dtoSchemas/knowledge";

const databaseAvailable = await isTestDatabaseAvailable();
const auth: AuthContext = {
  user: { id: "k1342-user", organizationId: "k1342-org", name: "Uploader", title: "Engineer", isActive: true },
  organization: { id: "k1342-org", name: "Knowledge" },
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["knowledge:view", "knowledge:edit", "knowledge:manage"]
};

function fixture(fileName: string, contentType = "application/pdf") {
  return { fileName, contentType, contentBase64: readFileSync(new URL(`./testing/fixtures/${fileName}`, import.meta.url)).toString("base64") };
}

describe.skipIf(!databaseAvailable)("PDF search pages over HTTP and PostgreSQL", () => {
  let db: InMemoryTestDatabase;
  let server: Server;
  let baseUrl: string;
  let root: string;
  let currentAuth = auth;
  let embeddingsEnabled = false;
  const embeddingClient = {
    model: "pages-test",
    async embed(texts: string[]) {
      if (!embeddingsEnabled) throw new Error("Embedding endpoint unavailable");
      return texts.map(() => [1, 0, 0]);
    }
  };

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
    await db.query("insert into organizations (id, name) values ($1, $1), ('k1342-other', 'Other')", [auth.organization.id]);
    await db.query("insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'Uploader', 'Engineer', true)", [auth.user.id, auth.organization.id]);
    root = await mkdtemp(join(tmpdir(), "k1342-"));
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: createLocalObjectStore(root), getCurrentAuthContext: () => currentAuth, knowledgeEmbeddingClient: embeddingClient });
    server = createHttpServer(router);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db?.rollback();
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function request<T = { item: KnowledgeEntryDto }>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}/api/v1/knowledge${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    expect(response.status).toBe(method === "POST" && path === "/entries" ? 201 : 200);
    return await response.json() as T;
  }

  async function drainIndexQueue() {
    for (let round = 0; round < 20; round += 1) {
      if (await processNextKnowledgeIndexJob({ db, ...(embeddingsEnabled ? { embeddingClient } : {}) }) === "idle") return;
    }
    throw new Error("Knowledge index queue did not drain.");
  }

  const search = (q: string) => request<KnowledgeSearchResponseDto>("GET", `/search?q=${encodeURIComponent(q)}`);

  it("returns the matching PDF chunk's physical range and revision after upload and replacement", async () => {
    const { item } = await request("POST", "/entries", {
      contentForm: "file", title: "Physical pages", tags: [], file: fixture("multipage.pdf")
    });
    await request("POST", `/entries/${item.id}/publish`);
    await drainIndexQueue();
    const result = await search("Second page");
    expect(knowledgeDtoSchemaCatalog.KnowledgeSearchResponse.parse(result)).toEqual(result);
    expect(result.retrieval.mode).toBe("fts_only");
    expect(result.items).toEqual([expect.objectContaining({
      entryId: item.id, revisionId: item.headRevisionId, pageStart: 1, pageEnd: 2,
      excerpt: expect.stringContaining("Second page text")
    })]);

    const replaced = await request("PATCH", `/entries/${item.id}`, {
      expectedHeadRevisionNumber: 1, file: fixture("sample.pdf")
    });
    const beforeIndex = (await search("thermal derating")).items.find((row) => row.entryId === item.id);
    expect(beforeIndex).toMatchObject({ revisionId: replaced.item.headRevisionId });
    expect(beforeIndex).not.toHaveProperty("pageStart");
    await drainIndexQueue();
    expect((await search("Second page")).items).toEqual([]);
    expect((await search("thermal derating")).items).toEqual([expect.objectContaining({
      entryId: item.id, revisionId: replaced.item.headRevisionId, pageStart: 1, pageEnd: 1
    })]);
  });

  it("uses physical page 2 after a blank first page and keeps pages organization-scoped and published-only", async () => {
    const file = fixture("multipage.pdf");
    file.contentBase64 = Buffer.from(Buffer.from(file.contentBase64, "base64").toString().replace("First page text", "               ")).toString("base64");
    const { item } = await request("POST", "/entries", { contentForm: "file", title: "Blank first page", tags: [], file });
    await drainIndexQueue();
    expect((await search("Second page")).items).toEqual([]);
    await request("POST", `/entries/${item.id}/publish`);
    await drainIndexQueue();
    expect((await search("Second page")).items).toEqual([expect.objectContaining({ entryId: item.id, pageStart: 2, pageEnd: 2 })]);
    currentAuth = { ...auth, organization: { id: "k1342-other", name: "Other" } };
    try {
      expect((await search("Second page")).items).toEqual([]);
    } finally {
      currentAuth = auth;
    }
    await request("POST", `/entries/${item.id}/archive`);
    expect((await search("Second page")).items).toEqual([]);
  });

  it.each([
    ["sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx fixture"],
    ["notes.txt", "text/plain", "plain unchanged"],
    ["notes.md", "text/markdown", "heading unchanged"]
  ])("replacing a PDF with %s removes page metadata", async (fileName, contentType, q) => {
    const { item } = await request("POST", "/entries", { contentForm: "file", title: fileName, tags: [], file: fixture("multipage.pdf") });
    await request("POST", `/entries/${item.id}/publish`);
    await drainIndexQueue();
    const file = fileName.endsWith(".docx") ? fixture(fileName, contentType) : {
      fileName, contentType, contentBase64: Buffer.from(q).toString("base64")
    };
    const replaced = await request("PATCH", `/entries/${item.id}`, { expectedHeadRevisionNumber: 1, file });
    await drainIndexQueue();
    const results = (await search(q)).items;
    const match = results.find((row) => row.entryId === item.id);
    expect(match).toMatchObject({ entryId: item.id, revisionId: replaced.item.headRevisionId, excerpt: expect.stringContaining(q) });
    expect(match).not.toHaveProperty("pageStart");
    expect(match).not.toHaveProperty("pageEnd");
  });

  it("returns pages with the vector chunk excerpt and preserves the FTS chunk when rankings fuse", async () => {
    embeddingsEnabled = true;
    try {
      const { item } = await request("POST", "/entries", { contentForm: "file", title: "Semantic PDF", tags: [], file: fixture("multipage.pdf") });
      await request("POST", `/entries/${item.id}/publish`);
      await drainIndexQueue();
      const semantic = await search("unrelated-vector-query");
      expect(semantic.retrieval.mode).toBe("semantic_fts");
      expect(semantic.items).toEqual([expect.objectContaining({
        entryId: item.id, revisionId: item.headRevisionId, pageStart: 1, pageEnd: 2,
        excerpt: expect.stringContaining("Second page text")
      })]);
      const hybrid = await search("Second page");
      expect(hybrid.retrieval.mode).toBe("semantic_fts");
      expect(hybrid.items.find((row) => row.entryId === item.id)).toMatchObject({
        revisionId: item.headRevisionId, pageStart: 1, pageEnd: 2, excerpt: expect.stringContaining("Second page text")
      });
    } finally {
      embeddingsEnabled = false;
    }
  });
});
