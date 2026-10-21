import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerKnowledgeRoutes } from "./routes";
import type { KnowledgeEntryDto } from "./types";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("document uploads over HTTP and PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: RootDatabase;
  const auth = makeTestAuthContext({ organizationId: "k1327-org", userId: "k1327-user",
    permissions: ["knowledge:view", "knowledge:edit"] });
  const store = createMemoryObjectStore();

  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("k1327upload");
    db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function request(method: string, path: string, body?: unknown) {
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => auth });
    return requestJson<{ item: KnowledgeEntryDto; items: KnowledgeEntryDto[]; error: { code: string; message: string; details: { reason: string } } }>(createHttpServer(router), `/api/v1/knowledge/${path}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  it.each(["guide.md", "guide.TXT"])("creates an editable uploaded draft from %s at revision 1", async (fileName) => {
    const created = await request("POST", "entries", { contentForm: "file", title: "文档", tags: ["k1327"],
      file: { fileName, contentType: "text/plain", contentBase64: Buffer.from("# 文档\r\n\n正文 😀\n").toString("base64") } });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ contentForm: "markdown", origin: "uploaded", status: "draft",
      headRevisionNumber: 1, contentMarkdown: "# 文档\r\n\n正文 😀\n", file: null });
    const id = created.body.item.id;
    const saved = await request("PATCH", `entries/${id}`, { expectedHeadRevisionNumber: 1, contentMarkdown: "修改正文" });
    expect(saved.status).toBe(200);
    expect(saved.body.item).toMatchObject({ headRevisionNumber: 2, contentMarkdown: "修改正文", origin: "uploaded" });
  });

  it.each([
    { fileName: "invalid.md", bytes: Buffer.from([0xc3, 0x28]), reason: "knowledge-upload-invalid-utf8", message: "UTF-8" },
    { fileName: "invalid.txt", bytes: Buffer.from([0xc3, 0x28]), reason: "knowledge-upload-invalid-utf8", message: "UTF-8" },
    { fileName: "long.md", bytes: Buffer.from("a".repeat(200_001)), reason: "knowledge-markdown-too-long", message: "200,000" },
    { fileName: "long.txt", bytes: Buffer.from("a".repeat(200_001)), reason: "knowledge-markdown-too-long", message: "200,000" }
  ])("refuses $fileName with $reason without creating an entry", async ({ fileName, bytes, reason, message }) => {
    const created = await request("POST", "entries", { contentForm: "file", title: reason, tags: [],
      file: { fileName, contentType: fileName.endsWith(".txt") ? "text/plain" : "text/markdown", contentBase64: bytes.toString("base64") } });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: { reason } });
    expect(created.body.error.message).toContain(message);
    const listed = await request("GET", `entries?q=${reason}`);
    expect(listed.body.items).toEqual([]);
  });

  it("accepts the exact character limit including multibyte UTF-8 text", async () => {
    const content = "中".repeat(200_000);
    const created = await request("POST", "entries", { contentForm: "file", title: "limit", tags: [],
      file: { fileName: "limit.txt", contentType: "text/plain", contentBase64: Buffer.from(content).toString("base64") } });
    expect(created.status).toBe(201);
    expect(created.body.item.contentMarkdown).toBe(content);
  });

  it.each([
    ["sample.pdf", "application/pdf"],
    ["sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]
  ])("keeps %s as a file entry", async (fileName, contentType) => {
    const bytes = await readFile(new URL(`./testing/fixtures/${fileName}`, import.meta.url));
    const created = await request("POST", "entries", { contentForm: "file", title: fileName, tags: [],
      file: { fileName, contentType, contentBase64: bytes.toString("base64") } });
    expect(created.status).toBe(201);
    expect(created.body.item).toMatchObject({ contentForm: "file", origin: "uploaded", headRevisionNumber: 1, contentMarkdown: null,
      file: { fileName, extractionStatus: "succeeded" } });
    // A file-form entry may already hold Markdown; replacement and reads must keep its form.
    const id = created.body.item.id;
    const replaced = await request("PATCH", `entries/${id}`, { expectedHeadRevisionNumber: 1,
      file: { fileName: "existing.md", contentType: "text/markdown", contentBase64: Buffer.from("old Markdown").toString("base64") } });
    expect(replaced.status).toBe(200);
    expect((await request("GET", `entries/${id}`)).body.item).toMatchObject({ contentForm: "file", headRevisionNumber: 2,
      contentMarkdown: null, file: { fileName: "existing.md" } });
  });
});
