import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { createInMemoryTestDatabase, isTestDatabaseAvailable, type InMemoryTestDatabase } from "../../testing/testDatabase";
import type { KnowledgeEntryDto, KnowledgeRevisionDto, KnowledgeSearchResponseDto } from "./types";
import { registerKnowledgeRoutes } from "./routes";
import { processNextKnowledgeIndexJob } from "./indexing/worker";
import { ensureKnowledgePdfPages as backfillKnowledgePdfPages } from "./pdfPageBackfill";
import type { KnowledgeIndexHealthDto } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();
const auth: AuthContext = {
  user: { id: "k1343-user", organizationId: "k1343-org", name: "Uploader", title: "Engineer", isActive: true },
  organization: { id: "k1343-org", name: "Knowledge" },
  roles: [{ roleId: "admin", projectId: null }],
  permissions: ["knowledge:view", "knowledge:edit", "knowledge:manage"]
};

describe.skipIf(!databaseAvailable)("Existing PDF page backfill over HTTP and PostgreSQL", () => {
  let db: InMemoryTestDatabase;
  let server: Server;
  let baseUrl: string;
  let root: string;
  let objectStore: ObjectStore;
  let currentAuth = auth;

  beforeAll(async () => {
    db = await createInMemoryTestDatabase();
    await db.query("insert into organizations (id, name) values ($1, $1)", [auth.organization.id]);
    await db.query("insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'Uploader', 'Engineer', true)", [auth.user.id, auth.organization.id]);
    root = await mkdtemp(join(tmpdir(), "k1343-"));
    objectStore = createLocalObjectStore(root);
    const router = createRouter();
    registerKnowledgeRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
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
      if (await processNextKnowledgeIndexJob({ db }) === "idle") return;
    }
    throw new Error("Knowledge index queue did not drain.");
  }

  const search = () => request<KnowledgeSearchResponseDto>("GET", "/search?q=Second%20page");

  async function legacyPdf(publish = true) {
    const { item } = await request("POST", "/entries", {
      contentForm: "file", title: "Legacy PDF", tags: [],
      file: { fileName: "multipage.pdf", contentType: "application/pdf",
        contentBase64: readFileSync(new URL("./testing/fixtures/multipage.pdf", import.meta.url)).toString("base64") }
    });
    await db.query("update knowledge_files set page_offsets = null where entry_id = $1", [item.id]);
    if (publish) await request("POST", `/entries/${item.id}/publish`);
    await drainIndexQueue();
    const match = (await search()).items.find((row) => row.entryId === item.id);
    if (publish) expect(match).not.toHaveProperty("pageStart");
    else expect(match).toBeUndefined();
    return item;
  }

  it("adds physical pages without changing the entry, revisions or audit history, and reruns do no work", async () => {
    const item = await legacyPdf();
    const before = await request("GET", `/entries/${item.id}`);
    const revisions = await request("GET", `/entries/${item.id}/revisions`);
    const audits = await db.query("select * from audit_events order by id");

    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 1, failed: 0 });
    await drainIndexQueue();

    expect((await search()).items.find((row) => row.entryId === item.id)).toMatchObject({
      revisionId: item.headRevisionId, pageStart: 1, pageEnd: 2
    });
    expect(await request("GET", `/entries/${item.id}`)).toEqual(before);
    expect(await request("GET", `/entries/${item.id}/revisions`)).toEqual(revisions);
    expect((await db.query("select * from audit_events order by id")).rows).toEqual(audits.rows);
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 0, failed: 0 });
  });

  it("discards extraction if the entry's file is replaced in flight, and becomes a no-op after retry", async () => {
    const original = await legacyPdf();
    let replacement: KnowledgeEntryDto | undefined;
    const replacingStore: ObjectStore = {
      ...objectStore,
      async get(key) {
        const bytes = await objectStore.get(key);
        replacement = (await request("PATCH", `/entries/${original.id}`, {
          expectedHeadRevisionNumber: 1,
          file: { fileName: "sample.pdf", contentType: "application/pdf",
            contentBase64: readFileSync(new URL("./testing/fixtures/sample.pdf", import.meta.url)).toString("base64") }
        })).item;
        return bytes;
      }
    };
    expect(await backfillKnowledgePdfPages(db, replacingStore)).toEqual({ updated: 0, failed: 0 });
    await drainIndexQueue();
    expect((await request<KnowledgeSearchResponseDto>("GET", "/search?q=thermal%20derating")).items.find((row) => row.entryId === original.id)).toMatchObject({
      revisionId: replacement!.headRevisionId, pageStart: 1, pageEnd: 1
    });
    expect((await search()).items.some((row) => row.entryId === original.id)).toBe(false);
    // The old file remains a historical revision and is eligible on the next start.
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 1, failed: 0 });
    await drainIndexQueue();
    const before = await request("GET", `/entries/${original.id}`);
    const health = await request<KnowledgeIndexHealthDto>("GET", "/index/status");
    expect(await backfillKnowledgePdfPages(db, {
      ...objectStore, async get() { throw new Error("Steady state must not download files"); }
    })).toEqual({ updated: 0, failed: 0 });
    expect(await request("GET", `/entries/${original.id}`)).toEqual(before);
    expect(await request<KnowledgeIndexHealthDto>("GET", "/index/status")).toEqual(health);
  });

  it.each(["missing", "invalid"])("keeps a searchable index and reports health when the stored PDF is %s, then permits retry", async (failure) => {
    const item = await legacyPdf();
    const healthy = await legacyPdf();
    const before = await request("GET", `/entries/${item.id}`);
    const revisions = await request("GET", `/entries/${item.id}/revisions`);
    const audits = await db.query("select * from audit_events order by id");
    const beforeSearch = (await search()).items.find((row) => row.entryId === item.id);
    const beforeHealth = (await request<KnowledgeIndexHealthDto>("GET", "/index/status")).items.find((row) => row.entryId === item.id)!;
    const objectPath = join(root, item.file!.storageKey);
    const bytes = await objectStore.get(item.file!.storageKey);
    if (failure === "missing") await rm(objectPath);
    else await writeFile(objectPath, "broken PDF");

    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 1, failed: 1 });
    await drainIndexQueue();
    expect(await processNextKnowledgeIndexJob({ db })).toBe("idle");
    expect((await search()).items.find((row) => row.entryId === healthy.id)).toMatchObject({ pageStart: 1, pageEnd: 2 });
    expect((await search()).items.find((row) => row.entryId === item.id)).toEqual(beforeSearch);
    expect((await request<KnowledgeIndexHealthDto>("GET", "/index/status")).items.find((row) => row.entryId === item.id)).toMatchObject({
      status: "failed", error: expect.stringContaining("PDF page backfill failed:"),
      indexedRevisionId: beforeHealth.indexedRevisionId, chunkCount: beforeHealth.chunkCount,
      embeddedChunkCount: beforeHealth.embeddedChunkCount
    });
    expect(await request("GET", `/entries/${item.id}`)).toEqual(before);
    expect(await request("GET", `/entries/${item.id}/revisions`)).toEqual(revisions);
    expect((await db.query("select * from audit_events order by id")).rows).toEqual(audits.rows);

    await writeFile(objectPath, bytes);
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 1, failed: 0 });
    await drainIndexQueue();
    expect((await search()).items.find((row) => row.entryId === item.id)).toMatchObject({ pageStart: 1, pageEnd: 2 });
    expect((await request<KnowledgeIndexHealthDto>("GET", "/index/status")).items.find((row) => row.entryId === item.id)).toMatchObject({ status: "succeeded", error: null });
  });

  it("backfills every organization's stored revisions and drafts while keeping retrieval organization-scoped and published-only", async () => {
    const historical = await legacyPdf();
    await request("PATCH", `/entries/${historical.id}`, {
      expectedHeadRevisionNumber: 1,
      file: { fileName: "sample.pdf", contentType: "application/pdf",
        contentBase64: readFileSync(new URL("./testing/fixtures/sample.pdf", import.meta.url)).toString("base64") }
    });
    await db.query("update knowledge_files set page_offsets = null where entry_id = $1", [historical.id]);
    await drainIndexQueue();

    const otherAuth: AuthContext = {
      ...auth, user: { ...auth.user, id: "k1343-other-user", organizationId: "k1343-other" },
      organization: { id: "k1343-other", name: "Other" }
    };
    await db.query("insert into organizations (id, name) values ($1, $1)", [otherAuth.organization.id]);
    await db.query("insert into users (id, organization_id, name, title, is_active) values ($1, $2, 'Other', 'Engineer', true)", [otherAuth.user.id, otherAuth.organization.id]);
    currentAuth = otherAuth;
    try {
      const draft = await legacyPdf(false);
      const published = await legacyPdf();
      const beforeDraft = await request("GET", `/entries/${draft.id}`);
      const revisions = await request<{ items: KnowledgeRevisionDto[] }>("GET", `/entries/${published.id}/revisions`);
      expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 4, failed: 0 });
      await drainIndexQueue();
      expect((await search()).items).toEqual([expect.objectContaining({ entryId: published.id, pageStart: 1, pageEnd: 2 })]);
      expect(await request("GET", `/entries/${draft.id}`)).toEqual(beforeDraft);
      expect(await request("GET", `/entries/${published.id}/revisions`)).toEqual(revisions);
      await request("POST", `/entries/${draft.id}/publish`);
      await drainIndexQueue();
      expect((await search()).items.find((row) => row.entryId === draft.id)).toMatchObject({ pageStart: 1, pageEnd: 2 });
    } finally {
      currentAuth = auth;
    }
    expect((await search()).items.some((row) => row.entryId === historical.id)).toBe(false);
    // Restoring the old PDF reuses its stored extraction: it must already have offsets.
    await request("POST", `/entries/${historical.id}/revisions/${historical.headRevisionId}/restore`, { expectedHeadRevisionNumber: 2 });
    await request("POST", `/entries/${historical.id}/index/retry`);
    await drainIndexQueue();
    expect((await search()).items.find((row) => row.entryId === historical.id)).toMatchObject({ pageStart: 1, pageEnd: 2 });
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 0, failed: 0 });
  });

  it("rolls back an entry's partial extraction if one stored revision fails", async () => {
    const original = await legacyPdf();
    const replacement = await request("PATCH", `/entries/${original.id}`, {
      expectedHeadRevisionNumber: 1,
      file: { fileName: "sample.pdf", contentType: "application/pdf",
        contentBase64: readFileSync(new URL("./testing/fixtures/sample.pdf", import.meta.url)).toString("base64") }
    });
    await db.query("update knowledge_files set page_offsets = null where entry_id = $1", [original.id]);
    await drainIndexQueue();
    const before = await request("GET", `/entries/${original.id}`);
    const revisions = await request("GET", `/entries/${original.id}/revisions`);
    const beforeSearch = await request<KnowledgeSearchResponseDto>("GET", "/search?q=thermal%20derating");
    // Fail the second file processed so the first one's update must roll back.
    const lastFile = [original.file!, replacement.item.file!].sort((a, b) => a.id < b.id ? -1 : 1)[1];
    const bytes = await objectStore.get(lastFile.storageKey);
    await writeFile(join(root, lastFile.storageKey), "broken PDF");
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 0, failed: 1 });
    expect(await processNextKnowledgeIndexJob({ db })).toBe("idle");
    expect(await request<KnowledgeSearchResponseDto>("GET", "/search?q=thermal%20derating")).toEqual(beforeSearch);
    expect(await request("GET", `/entries/${original.id}`)).toEqual(before);
    expect(await request("GET", `/entries/${original.id}/revisions`)).toEqual(revisions);

    await writeFile(join(root, lastFile.storageKey), bytes);
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 2, failed: 0 });
    await drainIndexQueue();
    expect((await request<KnowledgeSearchResponseDto>("GET", "/search?q=thermal%20derating")).items.find((row) => row.entryId === original.id)).toMatchObject({ pageStart: 1, pageEnd: 1 });
  });

  it.each(["success", "failure"])("an in-flight index worker cannot overwrite backfill %s", async (outcome) => {
    const item = await legacyPdf();
    await request("POST", `/entries/${item.id}/index/retry`);
    let extracted = false;
    await processNextKnowledgeIndexJob({
      db,
      embeddingClient: {
        model: "backfill-race",
        async embed(texts) {
          extracted = true;
          const store = outcome === "success" ? objectStore : {
            ...objectStore, async get() { throw new Error("Object store unavailable"); }
          };
          expect(await backfillKnowledgePdfPages(db, store)).toEqual(
            outcome === "success" ? { updated: 1, failed: 0 } : { updated: 0, failed: 1 }
          );
          return texts.map(() => [1, 0, 0]);
        }
      }
    });
    expect(extracted).toBe(true);
    expect((await request<KnowledgeIndexHealthDto>("GET", "/index/status")).items.find((row) => row.entryId === item.id)).toMatchObject({
      status: outcome === "success" ? "pending" : "failed",
      error: outcome === "success" ? null : expect.stringContaining("PDF page backfill failed:")
    });
    await drainIndexQueue();
    const match = (await search()).items.find((row) => row.entryId === item.id);
    if (outcome === "success") expect(match).toMatchObject({ pageStart: 1, pageEnd: 2 });
    else {
      expect(match).not.toHaveProperty("pageStart");
      expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 1, failed: 0 });
      await drainIndexQueue();
    }
  });

  it.each(["pending", "failed"])("skips %s extractions, including status changes during download", async (status) => {
    const item = await legacyPdf();
    await db.query("update knowledge_files set extraction_status = $2 where id = $1", [item.file!.id, status]);
    const before = await request("GET", `/entries/${item.id}`);
    expect(await backfillKnowledgePdfPages(db, {
      ...objectStore, async get() { throw new Error("Ineligible files must not be downloaded"); }
    })).toEqual({ updated: 0, failed: 0 });
    expect(await request("GET", `/entries/${item.id}`)).toEqual(before);

    await db.query("update knowledge_files set extraction_status = 'succeeded' where id = $1", [item.file!.id]);
    expect(await backfillKnowledgePdfPages(db, {
      ...objectStore,
      async get(key) {
        const bytes = await objectStore.get(key);
        await db.query("update knowledge_files set extraction_status = $2 where id = $1", [item.file!.id, status]);
        return bytes;
      }
    })).toEqual({ updated: 0, failed: 0 });
    expect(await request("GET", `/entries/${item.id}`)).toEqual(before);
    await db.query("update knowledge_files set extraction_status = 'succeeded' where id = $1", [item.file!.id]);
    expect(await backfillKnowledgePdfPages(db, objectStore)).toEqual({ updated: 1, failed: 0 });
    await drainIndexQueue();
  });
});
