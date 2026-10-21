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
    fixture = await createEphemeralTestDatabase("k1329import");
    db = createPostgresDatabase(fixture.url);
    await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }, { id: other.user.id }] });
    await seedCoreGraph(db, { organization: { id: foreign.organization.id }, users: [{ id: foreign.user.id }] });
  });
  afterAll(async () => { await db?.close(); await fixture?.drop(); });

  async function request(path: string, body: unknown = {}, context = auth, method = "POST") {
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore: store, getCurrentAuthContext: () => context });
    return requestJson<{
      item: { id: string; headRevisionId: string; status: string; entryId: string | null; tags: string[]; contentMarkdown: string; outcomes: { status: string; entryId: string | null }[]; counts: Record<string, number> };
      error: { message: string };
    }>(createHttpServer(router), `/api/v1/knowledge/${path}`, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  }
  async function open(context = auth) {
    const result = await request("imports", { tags: ["k1329", "batch"] }, context);
    expect(result.status).toBe(201);
    return result.body.item.id;
  }
  const submit = (id: string, upload: ReturnType<typeof file>, context = auth) => request(`imports/${id}/documents`, { relativePath: upload.fileName, file: upload }, context);

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
    const fresh = await open();
    const oversized = await submit(fresh, { ...twentyMb, contentBase64: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64") });
    expect(oversized.status).toBe(400);
    expect(oversized.body.error.message).toContain("20 MB");
    expect((await request(`imports/${fresh}/complete`)).body.item.outcomes).toEqual([]);
  }, 30_000);
});
