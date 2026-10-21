import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";

import type { AuthContext } from "../auth/types";
import { createLocalObjectStore } from "../logs/objectStore";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { createInMemoryTestDatabase, isTestDatabaseAvailable, type InMemoryTestDatabase } from "../../testing/testDatabase";
import type { KnowledgeEntryDto } from "./types";
import { registerKnowledgeRoutes } from "./routes";
import { processNextKnowledgeIndexJob } from "./indexing/worker";
import type { KnowledgeIndexHealthDto } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
const auth: AuthContext = {
  user: { id: "k1328-user", organizationId: "k1328-org", name: "Uploader", title: "Engineer", isActive: true },
  organization: { id: "k1328-org", name: "Knowledge" },
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["knowledge:view", "knowledge:edit", "knowledge:manage"]
};
const samplePdf = readFileSync(new URL("./testing/fixtures/sample.pdf", import.meta.url));
// Preserve PDF object offsets while removing the page's only text.
const emptyPdf = Buffer.from(samplePdf.toString().replace(/WiseEff knowledge pdf fixture: thermal derating case/, (text) => " ".repeat(text.length)));

describe.skipIf(!databaseAvailable)("empty knowledge extraction over HTTP and PostgreSQL", () => {
  let db: InMemoryTestDatabase;
  let server: Server;
  let baseUrl: string;
  let root: string;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
    await db.query("insert into organizations (id, name) values ($1, $1)", [auth.organization.id]);
    await db.query("insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'Uploader', 'Engineer', true)", [auth.user.id, auth.organization.id]);
    root = await mkdtemp(join(tmpdir(), "k1328-"));
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: createLocalObjectStore(root), getCurrentAuthContext: () => auth });
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
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    expect(response.status).toBe(method === "POST" && path === "/entries" ? 201 : 200);
    return await response.json() as T;
  }

  async function drainIndexQueue() {
    for (let round = 0; round < 20; round += 1) {
      if (await processNextKnowledgeIndexJob({ db }) === "idle") return;
    }
    throw new Error("Knowledge index queue did not drain.");
  }

  it("records a textless PDF upload as failed and returns the reason on list and detail", async () => {
    const { item } = await request("POST", "/entries", {
      contentForm: "file", title: "Scanned PDF", tags: [],
      file: { fileName: "scan.pdf", contentType: "application/pdf", contentBase64: emptyPdf.toString("base64") }
    });
    expect(item.file).toMatchObject({ extractionStatus: "failed", extractionError: "无可提取文本" });
    expect((await request("GET", `/entries/${item.id}`)).item.file).toMatchObject({ extractionStatus: "failed", extractionError: "无可提取文本" });
    const list = await request<{ items: KnowledgeEntryDto[] }>("GET", "/entries");
    expect(list.items.find((entry) => entry.id === item.id)?.file).toMatchObject({ extractionStatus: "failed", extractionError: "无可提取文本" });
  });

  it.each([
    ["sample.pdf", "application/pdf"],
    ["sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["multipage.pdf", "application/pdf"]
  ])("keeps normal %s extraction successful and marks an empty replacement as failed", async (fileName, contentType) => {
    const bytes = readFileSync(new URL(`./testing/fixtures/${fileName}`, import.meta.url));
    const { item } = await request("POST", "/entries", {
      contentForm: "file", title: fileName, tags: [],
      file: { fileName, contentType, contentBase64: bytes.toString("base64") }
    });
    expect(item.file).toMatchObject({ extractionStatus: "succeeded", extractionError: null });
    await request("POST", `/entries/${item.id}/publish`);
    await drainIndexQueue();
    const before = await request<KnowledgeIndexHealthDto>("GET", "/index/status");
    expect(before.items.find((entry) => entry.entryId === item.id)?.chunkCount).toBeGreaterThan(0);

    let emptyBytes = emptyPdf;
    if (fileName.endsWith(".docx")) {
      const zip = await JSZip.loadAsync(bytes);
      zip.file("word/document.xml", (await zip.file("word/document.xml")!.async("string")).replace(/<w:t[^>]*>.*?<\/w:t>/gs, "<w:t> </w:t>"));
      emptyBytes = await zip.generateAsync({ type: "nodebuffer" });
    }
    const replaced = await request("PATCH", `/entries/${item.id}`, {
      expectedHeadRevisionNumber: 1,
      file: { fileName, contentType, contentBase64: emptyBytes.toString("base64") }
    });
    expect(replaced.item.file).toMatchObject({ extractionStatus: "failed", extractionError: "无可提取文本" });
    expect(replaced.item.headRevisionNumber).toBe(2);
    await drainIndexQueue();
    const after = await request<KnowledgeIndexHealthDto>("GET", "/index/status");
    expect(after.items.find((entry) => entry.entryId === item.id)).toMatchObject({ status: "failed", chunkCount: 0 });

    const recovered = await request("PATCH", `/entries/${item.id}`, {
      expectedHeadRevisionNumber: 2,
      file: { fileName, contentType, contentBase64: bytes.toString("base64") }
    });
    expect(recovered.item.file).toMatchObject({ extractionStatus: "succeeded", extractionError: null });
    const emptyUpload = await request("POST", "/entries", {
      contentForm: "file", title: `Empty ${fileName}`, tags: [],
      file: { fileName, contentType, contentBase64: emptyBytes.toString("base64") }
    });
    expect(emptyUpload.item.file).toMatchObject({ extractionStatus: "failed", extractionError: "无可提取文本" });
  });

  it("exposes legacy successful empty extractions as zero-chunk entries in index health without rewriting the file", async () => {
    const { item } = await request("POST", "/entries", {
      contentForm: "file", title: "Legacy empty extraction", tags: [],
      file: { fileName: "legacy.pdf", contentType: "application/pdf", contentBase64: samplePdf.toString("base64") }
    });
    // Arrange a pre-fix file row; observations stay at the HTTP boundary.
    await db.query("update knowledge_files set extracted_text = '' where id = $1", [item.file!.id]);
    await request("POST", `/entries/${item.id}/publish`);
    await drainIndexQueue();
    // Model an existing zero-chunk index without changing its successful extraction record.
    await db.query("delete from knowledge_chunks where entry_id = $1", [item.id]);
    await db.query("update knowledge_index_status set chunk_count = 0 where entry_id = $1", [item.id]);
    const health = await request<KnowledgeIndexHealthDto>("GET", "/index/status");
    expect(health.items.find((entry) => entry.entryId === item.id)).toMatchObject({
      title: "Legacy empty extraction", entryStatus: "published", status: "succeeded", chunkCount: 0
    });
    expect((await request("GET", `/entries/${item.id}`)).item.file).toMatchObject({ extractionStatus: "succeeded", extractionError: null });
  });
});
