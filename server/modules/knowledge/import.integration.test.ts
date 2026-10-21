import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerKnowledgeRoutes } from "./routes";

const available = await isTestDatabaseAvailable();
const auth = makeTestAuthContext({ organizationId: "k1329-org", userId: "k1329-user", permissions: ["knowledge:view", "knowledge:edit"] });
const other = makeTestAuthContext({ organizationId: auth.organization.id, userId: "k1329-other", permissions: auth.permissions });
const foreign = makeTestAuthContext({ organizationId: "k1329-foreign", userId: "k1329-foreign-user", permissions: auth.permissions });
const file = (fileName: string, text = fileName) => ({ fileName, contentType: "text/plain", contentBase64: Buffer.from(text).toString("base64") });

describe.skipIf(!available)("knowledge import over HTTP and PostgreSQL", () => {
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let db: RootDatabase;
  const store = createMemoryObjectStore();
  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("k1330import");
    db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }, { id: other.user.id }] });
    await seedCoreGraph(db, { organization: { id: foreign.organization.id }, users: [{ id: foreign.user.id }] });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function request(path: string, body: unknown = {}, context = auth, method = "POST") {
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => context });
    return requestJson<{
      item: { id: string; headRevisionId: string; status: string; entryId: string | null; tags: string[]; contentMarkdown: string; documentCount: number; totalBytes: number; outcomes: { relativePath: string; status: string; entryId: string | null }[]; counts: Record<string, number> };
      items: { id: string }[];
      error: { message: string };
    }>(createHttpServer(router), `/api/v1/knowledge/${path}`, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  }
  async function open(context = auth) {
    const result = await request("imports", { tags: ["k1329", "batch"] }, context);
    expect(result.status).toBe(201);
    return result.body.item.id;
  }
  const submit = (id: string, upload: ReturnType<typeof file>, context = auth) => request(`imports/${id}/documents`, { relativePath: upload.fileName, file: upload }, context);

  async function archive(id: string, members: Record<string, string | Buffer>, context = auth) {
    const zip = new JSZip();
    for (const [path, bytes] of Object.entries(members)) zip.file(path, bytes, { createFolders: false });
    return request(`imports/${id}/archive`, { file: { fileName: "knowledge.zip", contentType: "application/zip",
      contentBase64: await zip.generateAsync({ type: "base64", compression: "DEFLATE", compressionOptions: { level: 1 } }) } }, context);
  }

  it("imports ZIP folder tags and member outcomes through the document path, ignoring OS junk", async () => {
    const batch = await open();
    const result = await archive(batch, { " batch / topic /topic/guide.md": "# ZIP guide", "image.png": "unsupported",
      "__MACOSX/._guide.md": "metadata", "nested/.DS_Store": "metadata", "empty/": "" });
    expect(result.status).toBe(200);
    expect(result.body.item.outcomes).toEqual([
      expect.objectContaining({ relativePath: " batch / topic /topic/guide.md", status: "created" }),
      expect.objectContaining({ relativePath: "image.png", status: "unsupported_skipped", entryId: null })
    ]);
    const entryId = result.body.item.outcomes[0].entryId;
    const entry = await request(`entries/${entryId}`, undefined, auth, "GET");
    expect(entry.body.item).toMatchObject({ status: "draft", tags: ["k1329", "batch", "topic"], contentMarkdown: "# ZIP guide" });
    expect((await submit(batch, file("copy.md", "# ZIP guide"))).body.item).toMatchObject({ status: "duplicate_skipped", entryId });
    const summary = await request(`imports/${batch}/complete`);
    expect(summary.body.item.counts).toMatchObject({ created: 1, unsupported_skipped: 1, duplicate_skipped: 1 });
  });

  it.each(["../escape.md", "/absolute.md", "C:/drive.md", "folder\\..\\escape.md", "folder/../escape.md",
    `${"deep/".repeat(21)}guide.md`, "deep/".repeat(21), "bad\u0001.md", `${"x".repeat(256)}.md`])("refuses unsafe or excessive ZIP paths before creating any entry: %s", async (path) => {
    const batch = await open();
    const before = await request("entries", undefined, auth, "GET");
    const result = await archive(batch, { "valid-first.md": `must not import ${path}`, [path]: "unsafe" });
    expect(result.status).toBe(400);
    const report = await request(`imports/${batch}`, undefined, auth, "GET");
    expect(report.body.item).toMatchObject({ documentCount: 0, totalBytes: 0, outcomes: [] });
    expect((await request("entries", undefined, auth, "GET")).body.items).toEqual(before.body.items);
  });

  it("refuses too many ZIP documents and excessive metadata entries before creating anything", async () => {
    for (const count of [201, 4081]) {
      const batch = await open();
      const members = Object.fromEntries(Array.from({ length: count }, (_, index) => [`${index}.md`, `unique ${index}`]));
      expect((await archive(batch, members)).status).toBe(400);
      expect((await request(`imports/${batch}`, undefined, auth, "GET")).body.item)
        .toMatchObject({ documentCount: 0, totalBytes: 0, outcomes: [] });
    }
  });

  it("refuses oversized expanded ZIP totals and members before creating any entry", async () => {
    const twentyMb = Buffer.alloc(20 * 1024 * 1024, 97);
    for (const members of [
      { "valid-first.md": "not created", "large.bin": Buffer.alloc(20 * 1024 * 1024 + 1, 97) },
      { "valid-first.md": "not created", ...Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`${index}.bin`, twentyMb])) }
    ]) {
      const batch = await open();
      expect((await archive(batch, members)).status).toBe(400);
      expect((await request(`imports/${batch}`, undefined, auth, "GET")).body.item)
        .toMatchObject({ documentCount: 0, totalBytes: 0, outcomes: [] });
    }
  }, 30_000);

  it("shares document capacity with files and ignores junk when charging the batch", async () => {
    const batch = await open();
    for (let index = 0; index < 199; index++) expect((await submit(batch, file(`${index}.bin`))).status).toBe(200);
    expect((await archive(batch, { "first.md": "no partial creation", "second.md": "also refused" })).status).toBe(400);
    expect((await request(`imports/${batch}`, undefined, auth, "GET")).body.item.documentCount).toBe(199);
    expect((await archive(batch, { "last.md": "last ZIP document", "__MACOSX/._last.md": "junk", ".DS_Store": "junk" })).status).toBe(200);
    expect((await submit(batch, file("over.bin"))).status).toBe(400);
    const report = await request(`imports/${batch}/complete`);
    expect(report.body.item.documentCount).toBe(200);
    expect(report.body.item.counts).toMatchObject({ created: 1, unsupported_skipped: 199 });
  }, 30_000);

  it("requires edit permission and importer ownership, and refuses archives after completion", async () => {
    const batch = await open();
    const members = { "owned.md": "archive authorization" };
    expect((await archive(batch, members, { ...auth, permissions: ["knowledge:view"] })).status).toBe(403);
    for (const context of [other, foreign]) expect((await archive(batch, members, context)).status).toBe(404);
    await request(`imports/${batch}/complete`);
    expect((await archive(batch, members)).status).toBe(409);
  });

  it("imports overlapping archives in opposite member order without deadlocking duplicate detection", async () => {
    const first = await open();
    const second = await open();
    const results = await Promise.all([
      archive(first, { "one.md": "ZIP concurrent one", "two.md": "ZIP concurrent two" }),
      archive(second, { "renamed-two.md": "ZIP concurrent two", "renamed-one.md": "ZIP concurrent one" })
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const outcomes = results.flatMap((result) => result.body.item.outcomes);
    expect(outcomes.filter((outcome) => outcome.status === "created")).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome.status === "duplicate_skipped")).toHaveLength(2);
  });

  it("reuses uploaded drafts, skips identical readable bytes and never overwrites changed content", async () => {
    const batch = await open();
    const created = await submit(batch, file("first.md", "# First"));
    expect(created.status).toBe(200);
    expect(created.body.item).toMatchObject({ status: "created", entryId: expect.any(String) });
    const duplicate = await submit(batch, file("renamed.txt", "# First"));
    expect(duplicate.body.item).toMatchObject({ status: "duplicate_skipped", entryId: created.body.item.entryId });
    const changed = await submit(batch, file("first.md", "# Changed"));
    expect(changed.body.item.status).toBe("created");
    expect(changed.body.item.entryId).not.toBe(created.body.item.entryId);
    const read = await request(`entries/${created.body.item.entryId}`, undefined, auth, "GET");
    expect(read.body.item).toMatchObject({ status: "draft", tags: ["k1329", "batch"], contentMarkdown: "# First" });
  });

  it("does not match or reveal another user's draft or another organization's entry; managers follow canReadEntry", async () => {
    const privateEntry = await request("entries", { contentForm: "file", title: "private", tags: [], file: file("private.md", "private bytes") }, other);
    expect(privateEntry.status).toBe(201);
    const batch = await open();
    const created = await submit(batch, file("copy.md", "private bytes"));
    expect(created.body.item.status).toBe("created");
    expect(JSON.stringify(created.body)).not.toContain(privateEntry.body.item.id);
    const manager = { ...other, permissions: [...other.permissions, "knowledge:manage" as const] };
    const managerBatch = await open(manager);
    const matched = await submit(managerBatch, file("copy.md", "private bytes"), manager);
    expect(matched.body.item).toMatchObject({ status: "duplicate_skipped", entryId: privateEntry.body.item.id });

    const foreignEntry = await request("entries", { contentForm: "file", title: "foreign", tags: [], file: file("foreign.md", "foreign bytes") }, foreign);
    await request(`entries/${foreignEntry.body.item.id}/publish`, {}, foreign);
    const isolated = await submit(batch, file("local.md", "foreign bytes"));
    expect(isolated.body.item.status).toBe("created");
    expect(JSON.stringify(isolated.body)).not.toContain(foreignEntry.body.item.id);
    for (const context of [foreign, other]) {
      expect((await submit(batch, file("no.md"), context)).status).toBe(404);
      expect((await request(`imports/${batch}`, undefined, context, "GET")).status).toBe(404);
      expect((await request(`imports/${batch}/complete`, {}, context)).status).toBe(404);
    }
  });

  it("matches published PDF bytes from the existing single-upload path", async () => {
    const upload = { ...file("single.pdf", "broken PDF but durable draft"), contentType: "application/pdf" };
    const original = await request("entries", { contentForm: "file", title: "single", tags: [], file: upload }, other);
    expect(original.status).toBe(201);
    await request(`entries/${original.body.item.id}/publish`, {}, other);
    const batch = await open();
    expect((await submit(batch, { ...upload, fileName: "renamed.pdf" })).body.item)
      .toMatchObject({ status: "duplicate_skipped", entryId: original.body.item.id });
  });

  it("rejects document links to another organization's entry or batch at the database constraint", async () => {
    const batch = await open();
    await submit(batch, file("tenant-constraint.md"));
    const foreignBatch = await open(foreign);
    const foreignDocument = await submit(foreignBatch, file("foreign-constraint.md"), foreign);
    for (const [column, id] of [["entry_id", foreignDocument.body.item.entryId], ["batch_id", foreignBatch]] as const) {
      await expect(db.query(`update knowledge_import_documents set ${column} = $1 where batch_id = $2 and organization_id = $3`,
        [id, batch, auth.organization.id])).rejects.toMatchObject({ code: "23503" });
    }
  });

  it("keeps partial failures, records every outcome and writes exactly one server-computed summary", async () => {
    const batch = await open();
    const first = await submit(batch, file("summary.md", "summary unique"));
    await submit(batch, file("duplicate.md", "summary unique"));
    expect((await submit(batch, file("archive.zip"))).body.item.status).toBe("unsupported_skipped");
    const failed = await submit(batch, { ...file("bad.pdf", "bad PDF"), contentType: "application/pdf" });
    expect(failed.body.item).toMatchObject({ status: "extraction_failed", entryId: expect.any(String) });
    const rejected = await submit(batch, { ...file("bad.md"), contentBase64: Buffer.from([0xc3, 0x28]).toString("base64") });
    expect(rejected.body.item).toMatchObject({ status: "rejected", entryId: null });
    expect((await submit(batch, file("after.md", "still works"))).body.item.status).toBe("created");
    expect((await request(`imports/${batch}/complete`, { counts: { created: 999 } })).status).toBe(400);
    const summary = await request(`imports/${batch}/complete`);
    expect(summary.body.item.outcomes).toHaveLength(6);
    const counts = { created: 2, duplicate_skipped: 1, unsupported_skipped: 1, extraction_failed: 1, rejected: 1 };
    expect(summary.body.item.counts).toEqual(counts);
    expect((await request(`imports/${batch}/complete`)).body.item.counts).toEqual(counts);
    expect((await submit(batch, file("late.md"))).status).toBe(409);
    const audits = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where target_id = $1 and kind = 'knowledge-import-complete'", [batch]);
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].metadata).toMatchObject({ importBatchId: batch, documentCount: 6, counts });
    const perEntry = await db.query<{ metadata: Record<string, unknown> }>(
      "select metadata from audit_events where target_id = $1 and kind = 'knowledge-entry-create'", [first.body.item.entryId]);
    expect(perEntry.rows).toHaveLength(1);
    expect(perEntry.rows[0].metadata).toMatchObject({ importBatchId: batch });
    const allCreates = await db.query("select id from audit_events where kind = 'knowledge-entry-create' and metadata->>'importBatchId' = $1", [batch]);
    expect(allCreates.rows).toHaveLength(3);
    expect((await request(`entries/${failed.body.item.entryId}`, undefined, auth, "GET")).body.item.status).toBe("draft");
  });

  it("requires knowledge:edit on every import operation and validates document paths and server-owned tags", async () => {
    const viewer = { ...auth, permissions: ["knowledge:view" as const] };
    expect((await request("imports", { tags: [] }, viewer)).status).toBe(403);
    const batch = await open();
    expect((await submit(batch, file("view.md"), viewer)).status).toBe(403);
    expect((await request(`imports/${batch}/complete`, {}, viewer)).status).toBe(403);
    expect((await request(`imports/${batch}`, undefined, viewer, "GET")).status).toBe(403);
    expect((await request(`imports/${batch}/documents`, { relativePath: "../escape.md", file: file("escape.md") })).status).toBe(400);
    expect((await request(`imports/${batch}/documents`, { relativePath: "tags.md", file: file("tags.md"), tags: ["override"] })).status).toBe(400);
  });

  it("keeps source checksums through metadata edits and restores, but never matches an obsolete edited body", async () => {
    const original = await request("entries", { contentForm: "file", title: "metadata", tags: [], file: file("metadata.md", "source bytes") });
    const id = original.body.item.id;
    expect((await request(`entries/${id}`, { expectedHeadRevisionNumber: 1, tags: ["changed"] }, auth, "PATCH")).status).toBe(200);
    const batch = await open();
    expect((await submit(batch, file("metadata.txt", "source bytes"))).body.item).toMatchObject({ status: "duplicate_skipped", entryId: id });
    expect((await request(`entries/${id}`, { expectedHeadRevisionNumber: 2, contentMarkdown: "edited body" }, auth, "PATCH")).status).toBe(200);
    const replacement = await submit(batch, file("metadata.txt", "source bytes"));
    expect(replacement.body.item.status).toBe("created");
    expect(replacement.body.item.entryId).not.toBe(id);
    expect((await request(`entries/${id}/revisions/${original.body.item.headRevisionId}/restore`, { expectedHeadRevisionNumber: 3 })).status).toBe(200);
    expect((await submit(batch, file("restored.txt", "source bytes"))).body.item).toMatchObject({ status: "duplicate_skipped", entryId: id });
  });

  it("serializes identical document imports across concurrent batches", async () => {
    const first = await open();
    const second = await open();
    const results = await Promise.all([submit(first, file("race.md", "unique concurrent bytes")), submit(second, file("race.md", "unique concurrent bytes"))]);
    expect(results.map((result) => result.body.item.status).sort()).toEqual(["created", "duplicate_skipped"]);
    expect(results[0].body.item.entryId).toBe(results[1].body.item.entryId);
  });

  it("enforces 200 documents including unsupported files, with concurrent requests at the boundary", async () => {
    const batch = await open();
    for (let index = 0; index < 199; index++) {
      expect((await submit(batch, file(`${index}.bin`))).status).toBe(200);
    }
    const results = await Promise.all([submit(batch, file("200.bin")), submit(batch, file("201.bin"))]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const refused = results.find((result) => result.status === 400)!;
    expect(refused.body.error.message).toContain("200");
    const summary = await request(`imports/${batch}/complete`);
    expect(summary.body.item.counts.unsupported_skipped).toBe(200);
  }, 30_000);

  it("enforces actual decoded byte totals at 100 MB and the existing 20 MB per-document limit", async () => {
    const batch = await open();
    const twentyMb = { ...file("large.bin"), contentBase64: Buffer.alloc(20 * 1024 * 1024, 97).toString("base64") };
    for (let index = 0; index < 5; index++) expect((await submit(batch, twentyMb)).status).toBe(200);
    const overBatch = await submit(batch, file("one-more.bin", "x"));
    expect(overBatch.status).toBe(400);
    expect(overBatch.body.error.message).toContain("100 MB");
    const overArchive = await archive(batch, { "one-more.md": "x" });
    expect(overArchive.status).toBe(400);
    expect(overArchive.body.error.message).toContain("100 MB");
    expect((await request(`imports/${batch}`, undefined, auth, "GET")).body.item.documentCount).toBe(5);
    const fresh = await open();
    const oversized = await submit(fresh, { ...twentyMb, contentBase64: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64") });
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.message).toContain("20 MB");
    expect((await request(`imports/${fresh}/complete`)).body.item.outcomes).toEqual([]);
  }, 30_000);
});
