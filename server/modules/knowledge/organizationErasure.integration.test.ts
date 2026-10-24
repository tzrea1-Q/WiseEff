import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWiseEffServer } from "../../app";
import { requestJson } from "../../test/testClient";
import { createEphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type Database, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { seedBaselineAuthCatalog } from "../auth/baselineCatalog";
import { createLocalObjectStore, type ObjectStore } from "../logs/objectStore";
import type { KnowledgeEntryDto } from "./types";
import JSZip from "jszip";
import { getAuthContext } from "../auth/repository";
import { createKnowledgeEntry } from "./service";
import { processNextKnowledgeIndexJob } from "./indexing/worker";
import { ensureKnowledgePdfPages } from "./pdfPageBackfill";
import { detectKnowledgeReferenceSuggestions } from "./referenceSuggestions";
import { loadIndexEntrySnapshot } from "./indexing/service";
import { scanKnowledgeReferenceSuggestions } from "./indexing/referenceSuggestionsEnsure";
import { randomBytes, randomUUID } from "node:crypto";
import { provisionPublicationRuntimeLogins, dropLabRuntimeLogins } from "../../testing/labRuntimeLogins";
import { createDefaultKnowledgeTextExtractor } from "./extraction";
import { knowledgeOrganizationErasure } from "./organizationErasure";

describe("Knowledge Organization erasure through HTTP, PostgreSQL and isolated physical storage", () => {
  let database: Awaited<ReturnType<typeof createEphemeralTestDatabase>>, db: RootDatabase;
  let directory: string, store: ObjectStore;
  beforeEach(async () => {
    database = await createEphemeralTestDatabase("knowledgeerase"); db = createPostgresDatabase(database.url);
    directory = await mkdtemp(join(tmpdir(), "org1396-")); store = createLocalObjectStore(directory);
    await seedCoreGraph(db, { organization: { id: "knowledge-home" }, users: [{ id: "knowledge-platform" }] });
    await seedCoreGraph(db, { organization: { id: "knowledge-target" }, users: [{ id: "knowledge-author" }] });
    await seedBaselineAuthCatalog(db);
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('knowledge-platform-role','knowledge-platform','knowledge-home','platform-admin'),('knowledge-author-role','knowledge-author','knowledge-target','admin')");
  });
  afterEach(async () => { await db?.close(); await database?.drop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  async function request<T>(path: string, method = "GET", body?: unknown, user = "knowledge-platform") {
    return requestJson<T>(createWiseEffServer({ db, objectStore: store }), path, { method, headers: { "x-wiseeff-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function uploadInput() {
    const file = { fileName: "private.pdf", contentType: "application/pdf", contentBase64: (await readFile(new URL("./testing/fixtures/sample.pdf", import.meta.url))).toString("base64") };
    return { contentForm: "file" as const, title: "Private knowledge", tags: [], file };
  }
  async function upload() {
    const response = await request<{ item: KnowledgeEntryDto }>("/api/v1/knowledge/entries", "POST", await uploadInput(), "knowledge-author");
    expect(response.status, response.bodyText).toBe(201); return response.body.item;
  }
  async function start() {
    const target = "/api/v1/platform/organizations/knowledge-target";
    const preview = await request<{ item: { stateDigest: string } }>(`${target}/deletion-preview`);
    expect(preview.status, preview.bodyText).toBe(200);
    return request<{ item: { id: string; status: string } }>(`${target}/deletions`, "POST", { stateDigest: preview.body.item.stateDigest, confirmationOrganizationId: "knowledge-target" });
  }
  it("removes all knowledge history and physical attachments before completing the existing Organization flow", async () => {
    const entry = await upload();
    const bytes = await store.get(entry.file!.storageKey); expect(bytes.length).toBeGreaterThan(0);
    const result = await start(); expect(result.status, result.bodyText).toBe(202); expect(result.body.item.status).toBe("deleted");
    await expect(store.get(entry.file!.storageKey)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await db.query(`select 'knowledge_entries' relation from knowledge_entries where organization_id=$1
      union all select 'knowledge_revisions' from knowledge_revisions where organization_id=$1
      union all select 'knowledge_files' from knowledge_files where organization_id=$1
      union all select 'knowledge_index_status' from knowledge_index_status where organization_id=$1
      union all select 'knowledge_chunks' from knowledge_chunks where organization_id=$1
      union all select 'knowledge_import_batches' from knowledge_import_batches where organization_id=$1
      union all select 'knowledge_import_documents' from knowledge_import_documents where organization_id=$1`, ["knowledge-target"])).rows).toEqual([]);
    expect((await request(`/api/v1/platform/organization-deletions/${result.body.item.id}`)).status).toBe(200);
  });
  it("cleans a physical upload whose response was lost before any metadata was registered", async () => {
    const put = store.put; let written = "";
    store.put = async input => { const result = await put(input); written = result.storageKey; throw new Error("Lost physical write response"); };
    const failed = await request("/api/v1/knowledge/entries", "POST", await uploadInput(), "knowledge-author");
    expect(failed.status).toBe(500); expect((await store.get(written)).length).toBeGreaterThan(0);
    expect((await start()).body.item.status).toBe("deleted");
    await expect(store.get(written)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains failed replacement custody independently of the entry revision rollback", async () => {
    const entry = await upload(), input = await uploadInput(), put = store.put; let written = "";
    store.put = async value => { const result = await put(value); written = result.storageKey; throw new Error("Lost replacement response"); };
    const failed = await request(`/api/v1/knowledge/entries/${entry.id}`, "PATCH", { expectedHeadRevisionNumber: 1, file: input.file }, "knowledge-author");
    expect(failed.status).toBe(500); expect(written).not.toBe(entry.file!.storageKey);
    expect((await start()).body.item.status).toBe("deleted");
    await expect(store.get(written).then(() => true, () => false)).resolves.toBe(false);
  });
  it("keeps every physical archive member in committed custody when the outer import transaction rolls back", async () => {
    const input = await uploadInput(), zip = new JSZip();
    zip.file("one.pdf", Buffer.from(input.file.contentBase64, "base64"));
    zip.file("two.docx", await readFile(new URL("./testing/fixtures/sample.docx", import.meta.url)));
    const batch = await request<{ item: { id: string } }>("/api/v1/knowledge/imports", "POST", { tags: [] }, "knowledge-author");
    const put = store.put, written: string[] = [];
    store.put = async value => { const result = await put(value); written.push(result.storageKey); if (written.length === 2) throw new Error("Lost second member response"); return result; };
    const imported = await request(`/api/v1/knowledge/imports/${batch.body.item.id}/archive`, "POST", { file: { fileName: "private.zip", contentType: "application/zip", contentBase64: await zip.generateAsync({ type: "base64" }) } }, "knowledge-author");
    expect(imported.status, imported.bodyText).toBe(500); expect(written).toHaveLength(2);
    // A fresh root connection observes custody even though all entry savepoints rolled back.
    await db.close(); db = createPostgresDatabase(database.url); store = createLocalObjectStore(directory);
    expect((await start()).body.item.status).toBe("deleted");
    for (const key of written) await expect(store.get(key).then(() => true, () => false)).resolves.toBe(false);
  });
  it("keeps deletion failed while a put is running and cleans its late bytes on retry", async () => {
    const put = store.put; let written = "", entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    store.put = async input => { const value = await put(input); written = value.storageKey; entered(); await held; return value; };
    const uploading = request("/api/v1/knowledge/entries", "POST", await uploadInput(), "knowledge-author");
    try {
      await started;
      const erased = await start(); expect(erased.status).toBe(202); expect(erased.body.item.status).toBe("failed");
      release(); expect((await uploading).status).toBe(500);
      const retry = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${erased.body.item.id}/retry`, "POST");
      expect(retry.body.item.status).toBe("deleted");
      await expect(store.get(written).then(() => true, () => false)).resolves.toBe(false);
    } finally { release(); await uploading; }
  });
  it("retains an identical physical key still referenced by another Organization", async () => {
    const entry = await upload();
    const foreign = await request<{ item: KnowledgeEntryDto }>("/api/v1/knowledge/entries", "POST", await uploadInput());
    expect(foreign.status, foreign.bodyText).toBe(201);
    await db.query("update knowledge_files set storage_key=$2 where id=$1", [foreign.body.item.file!.id, entry.file!.storageKey]);
    expect((await start()).body.item.status).toBe("deleted");
    expect((await request(`/api/v1/knowledge/entries/${foreign.body.item.id}/file/content`)).status).toBe(200);
    expect((await store.get(entry.file!.storageKey)).length).toBeGreaterThan(0);
  });
  it("retries only unfinished physical keys after storage failure and server restart", async () => {
    const first = await upload(), second = await upload(), remove = store.delete!;
    let completed = "";
    store.delete = async key => { if (completed) throw new Error("Physical storage unavailable"); await remove(key); completed = key; };
    const failed = await start(); expect(failed.body.item.status).toBe("failed"); expect(completed).not.toBe("");
    await db.close(); db = createPostgresDatabase(database.url); store = createLocalObjectStore(directory);
    const remaining: string[] = [], retryDelete = store.delete!;
    store.delete = async key => { remaining.push(key); await retryDelete(key); };
    const retried = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
    expect(retried.body.item.status).toBe("deleted"); expect(remaining).toHaveLength(1); expect(remaining).not.toContain(completed);
    for (const key of [first.file!.storageKey, second.file!.storageKey]) await expect(store.get(key).then(() => true, () => false)).resolves.toBe(false);
  });
  it("finishes with a real surviving platform actor after target rows and original actor are gone", async () => {
    await upload();
    await seedCoreGraph(db, { organization: { id: "knowledge-other-home" }, users: [{ id: "knowledge-surviving-platform" }] });
    await db.query("insert into user_role_bindings(id,user_id,organization_id,role_id) values('knowledge-survivor-role','knowledge-surviving-platform','knowledge-other-home','platform-admin')");
    await db.query(`create function fail_knowledge_final_receipt() returns trigger language plpgsql as $$ begin
      if new.status='deleted' then raise exception 'Receipt persistence unavailable'; end if; return new; end $$;
      create trigger test_final_receipt before update on organization_erasures for each row execute function fail_knowledge_final_receipt()`);
    const failed = await start(); expect(failed.body.item.status).toBe("failed");
    expect((await db.query("select count(*)::int n from organizations where id='knowledge-target'")).rows).toEqual([{ n: 0 }]);
    await db.query("delete from users where id='knowledge-platform'");
    await db.query("drop trigger test_final_receipt on organization_erasures");
    await db.close(); db = createPostgresDatabase(database.url); store = createLocalObjectStore(directory);
    const retried = await request<{ item: { status: string; actorUserId: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST", undefined, "knowledge-surviving-platform");
    expect(retried.body.item).toMatchObject({ status: "deleted", actorUserId: "knowledge-platform" });
    expect(JSON.stringify(retried.body)).not.toMatch(/private\.pdf|Private knowledge|storage_key|knowledge-author/);
  });
  it("blocks a claimed worker's late vectors and suggestions after deletion and restart", async () => {
    const entry = await upload();
    expect((await request(`/api/v1/knowledge/entries/${entry.id}/publish`, "POST", {}, "knowledge-author")).status).toBe(200);
    const snapshot = await loadIndexEntrySnapshot(db, { entryId: entry.id, organizationId: "knowledge-target" });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const worker = processNextKnowledgeIndexJob({ db, embeddingClient: { model: "org1396-held", async embed(texts) { entered(); await held; return texts.map(() => [1, 0, 0]); } } });
    try {
      await started; expect((await start()).body.item.status).toBe("deleted");
      release(); expect(await worker).toBe("processed");
      await detectKnowledgeReferenceSuggestions(db, snapshot!, "org1396-late-suggestion");
      await scanKnowledgeReferenceSuggestions(db, { organizationId: "knowledge-target", requestId: "org1396-restart-scan" });
      expect((await db.query(`select 'knowledge_chunks' relation from knowledge_chunks where organization_id=$1
        union all select 'knowledge_index_status' from knowledge_index_status where organization_id=$1
        union all select 'knowledge_reference_suggestions' from knowledge_reference_suggestions where organization_id=$1
        union all select 'knowledge_entries' from knowledge_entries where organization_id=$1`, ["knowledge-target"])).rows).toEqual([]);
      expect(await processNextKnowledgeIndexJob({ db })).toBe("idle");
    } finally { release(); await worker; }
  });
  it("discards extraction and PDF page backfill results obtained before erasure", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const extracting = createKnowledgeEntry(db, store, { async extract() { entered(); await held; return { status: "succeeded", text: "Late private text" }; } },
      await getAuthContext(db, "knowledge-author"), await uploadInput());
    // Install the rejection handler before the controlled result is released.
    const extraction = extracting.then(() => "created", error => (error as { code?: string }).code);
    try {
      await started; expect((await start()).body.item.status).toBe("deleted"); release();
      expect(await extraction).toBe("NOT_FOUND");
      expect(await ensureKnowledgePdfPages(db, store)).toEqual({ updated: 0, failed: 0 });
      expect((await db.query("select count(*)::int n from knowledge_index_status where organization_id='knowledge-target'")).rows).toEqual([{ n: 0 }]);
    } finally { release(); await extraction; }
  });
  it("discards a PDF backfill already reading physical bytes when deletion completes", async () => {
    const entry = await upload();
    await db.query("update knowledge_files set page_offsets=null where id=$1", [entry.file!.id]);
    const get = store.get; let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    store.get = async key => { const bytes = await get(key); entered(); await held; return bytes; };
    const backfill = ensureKnowledgePdfPages(db, store);
    try {
      await started; expect((await start()).body.item.status).toBe("deleted"); release();
      expect(await backfill).toEqual({ updated: 0, failed: 0 });
      expect((await db.query("select count(*)::int n from knowledge_files where organization_id='knowledge-target'")).rows).toEqual([{ n: 0 }]);
    } finally { release(); await backfill; }
  });
  it("uses the actual API LOGIN for uploads and cleanup while workers cannot read or mutate custody", async () => {
    const token = `org1396${randomBytes(4).toString("hex")}`, login = await provisionPublicationRuntimeLogins(database.url, { mode: "lab", runToken: token });
    const administrator = db, api = createPostgresDatabase(login.apiUrl), worker = createPostgresDatabase(login.workerUrl);
    try {
      db = api;
      const entry = await upload();
      expect((await start()).body.item.status).toBe("deleted");
      await expect(store.get(entry.file!.storageKey).then(() => true, () => false)).resolves.toBe(false);
      await expect(worker.query("select * from knowledge_attachment_writes")).rejects.toMatchObject({ code: "42501" });
      await expect(worker.query("select knowledge_erasure_object_referenced('missing','missing','key')")).rejects.toMatchObject({ code: "42501" });
    } finally { db = administrator; await api.close(); await worker.close(); await dropLabRuntimeLogins(database.url, token); }
  }, 120_000);
  it("refuses an unknown store before writing untraceable physical objects", async () => {
    store = { ...store, planKey: undefined };
    const result = await request<{ error: { details: { reason: string } } }>("/api/v1/knowledge/entries", "POST", await uploadInput(), "knowledge-author");
    expect(result.status).toBe(500); expect(result.body.error.details.reason).toBe("knowledge-upload-custody-unavailable");
    expect((await start()).body.item.status).toBe("deleted");
  });
  it("cancels an admitted upload still waiting to enter its metadata transaction before physical IO", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const queued: Database = { query: db.query, async transaction(write) { entered(); await held; return db.transaction(write); } };
    const uploading = createKnowledgeEntry(queued, store, createDefaultKnowledgeTextExtractor(), await getAuthContext(db, "knowledge-author"), await uploadInput(), { attachmentRoot: db })
      .then(() => "created", error => (error as { code?: string }).code);
    try {
      await started; expect((await start()).body.item.status).toBe("deleted"); release();
      expect(await uploading).toBe("CONFLICT"); expect(await readdir(directory)).toEqual([]);
    } finally { release(); await uploading; }
  });
  it("keeps a foreign pending upload's physical key without adopting its custody", async () => {
    const entry = await upload(), id = randomUUID();
    await db.query("insert into knowledge_attachment_writes(id,organization_id,storage_key) values($1,'knowledge-home',$2)", [id, entry.file!.storageKey]);
    expect((await start()).body.item.status).toBe("deleted");
    expect((await store.get(entry.file!.storageKey)).length).toBeGreaterThan(0);
    expect((await db.query("select organization_id,erasure_id from knowledge_attachment_writes where id=$1", [id])).rows).toEqual([{ organization_id: "knowledge-home", erasure_id: null }]);
  });
  it("settles durable domain custody with its real intent after target accounts and Organization have vanished", async () => {
    const entry = await upload(); store.delete = async () => { throw new Error("Storage unavailable"); };
    const failed = await start(); expect(failed.body.item.status).toBe("failed");
    const lease = randomUUID();
    // A persisted partial/restore state; the domain must not resolve target auth.
    await db.transaction(async tx => {
      await tx.query("update organization_erasures set status='running',stage='management',lease_owner=$2,lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1", [failed.body.item.id, lease]);
      await tx.query("select set_config('wiseeff.organization_erasure_id',$1,true),set_config('wiseeff.organization_erasure_lease',$2,true)", [failed.body.item.id, lease]);
      await tx.query("delete from audit_events where organization_id='knowledge-target'");
      await tx.query("delete from users where organization_id='knowledge-target'");
      await tx.query("delete from organizations where id='knowledge-target'");
      await tx.query("update organization_erasures set stage='domains' where id=$1", [failed.body.item.id]);
    });
    await db.close(); db = createPostgresDatabase(database.url); store = createLocalObjectStore(directory);
    await knowledgeOrganizationErasure.erase(db, { id: failed.body.item.id, targetOrganizationId: "knowledge-target", actorUserId: "knowledge-platform", leaseOwner: lease }, {
      objectStore: store,
      async renewLease() {
        const renewed = await db.query("update organization_erasures set lease_expires_at=clock_timestamp()+interval '1 minute' where id=$1 and lease_owner=$2 and status='running' and lease_expires_at>clock_timestamp()", [failed.body.item.id, lease]);
        expect(renewed.rowCount).toBe(1);
      }
    });
    await expect(store.get(entry.file!.storageKey).then(() => true, () => false)).resolves.toBe(false);
    expect((await db.query("select count(*)::int n from knowledge_attachment_writes where erasure_id=$1", [failed.body.item.id])).rows).toEqual([{ n: 0 }]);
  });
  it("fails closed rather than cascading into a foreign-owned historical child", async () => {
    const entry = await upload(), id = randomUUID();
    const foreign = await store.put({ organizationId: "knowledge-home", fileName: "foreign-private.pdf", contentType: "application/pdf", bytes: Buffer.from("Foreign private attachment") });
    // The old file FK is entry-only; erasure must not treat this mismatched owner as B.
    await db.query("insert into knowledge_files(id,entry_id,organization_id,storage_key,file_name,content_type,size_bytes,checksum) values($1,$2,'knowledge-home',$3,'foreign-private.pdf','application/pdf',$4,$5)", [id, entry.id, foreign.storageKey, foreign.fileSizeBytes, foreign.checksumSha256]);
    expect((await start()).body.item.status).toBe("failed");
    expect((await db.query("select storage_key from knowledge_files where id=$1", [id])).rows).toEqual([{ storage_key: foreign.storageKey }]);
    expect((await store.get(foreign.storageKey)).toString()).toBe("Foreign private attachment");
  });
  it("keeps exclusive bytes pending when the configured store has no deletion capability", async () => {
    const entry = await upload(); store = { ...store, delete: undefined };
    const failed = await start(); expect(failed.body.item.status).toBe("failed");
    expect((await store.get(entry.file!.storageKey)).length).toBeGreaterThan(0);
    store = createLocalObjectStore(directory);
    const retried = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
    expect(retried.body.item.status).toBe("deleted");
    await expect(store.get(entry.file!.storageKey).then(() => true, () => false)).resolves.toBe(false);
  });
  it("leaves a key pending while a foreign reference is committing, then retains the committed shared bytes", async () => {
    const entry = await upload(), id = randomUUID(); let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const foreign = db.transaction(async tx => {
      await tx.query("insert into knowledge_attachment_writes(id,organization_id,storage_key) values($1,'knowledge-home',$2)", [id, entry.file!.storageKey]);
      entered(); await held;
    });
    try {
      await started; const failed = await start(); expect(failed.body.item.status).toBe("failed");
      expect((await store.get(entry.file!.storageKey)).length).toBeGreaterThan(0);
      release(); await foreign;
      const retried = await request<{ item: { status: string } }>(`/api/v1/platform/organization-deletions/${failed.body.item.id}/retry`, "POST");
      expect(retried.body.item.status).toBe("deleted"); expect((await store.get(entry.file!.storageKey)).length).toBeGreaterThan(0);
    } finally { release(); await foreign; }
  });
});
