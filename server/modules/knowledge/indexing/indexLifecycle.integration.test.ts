import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../../auth/types";
import type { ObjectStore } from "../../logs/objectStore";
import type { InMemoryTestDatabase } from "../../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../../testing/testDatabase";
import { createDefaultKnowledgeTextExtractor } from "../extraction";
import {
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  getKnowledgeIndexHealth,
  getPublishedKnowledgeDocument,
  publishKnowledgeEntry,
  rebuildKnowledgeIndex,
  restoreKnowledgeEntry,
  retryKnowledgeEntryIndex,
  searchKnowledge,
  updateKnowledgeEntry
} from "../service";
import { getIndexStatusForEntry } from "./repository";
import { processNextKnowledgeIndexJob } from "./worker";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-index";
const EDITOR = "user-kb-index-editor";
const MANAGER = "user-kb-index-manager";
const VIEWER = "user-kb-index-viewer";

const viewEdit: BackendPermission[] = ["knowledge:view", "knowledge:edit"];
const viewOnly: BackendPermission[] = ["knowledge:view"];
const manageAll: BackendPermission[] = ["knowledge:view", "knowledge:edit", "knowledge:manage"];

function makeAuth(userId: string, permissions: BackendPermission[]): AuthContext {
  return {
    user: { id: userId, organizationId: ORG_ID, name: userId, title: "Engineer", isActive: true },
    organization: { id: ORG_ID, name: ORG_ID },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

function createFakeObjectStore(): ObjectStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(input) {
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      const storageKey = `${input.organizationId}/${checksum}-${input.fileName}`;
      objects.set(storageKey, input.bytes);
      return {
        storageKey,
        fileName: input.fileName,
        contentType: input.contentType,
        fileSizeBytes: input.bytes.byteLength,
        checksumSha256: checksum
      };
    },
    async get(storageKey) {
      const bytes = objects.get(storageKey);
      if (!bytes) throw new Error(`Missing object: ${storageKey}`);
      return bytes;
    }
  };
}

const extractor = createDefaultKnowledgeTextExtractor();

async function drainIndexQueue(db: InMemoryTestDatabase) {
  for (let round = 0; round < 20; round += 1) {
    const outcome = await processNextKnowledgeIndexJob({ db });
    if (outcome === "idle") return;
  }
  throw new Error("Knowledge index queue did not drain within 20 rounds.");
}

async function listChunks(db: InMemoryTestDatabase, entryId: string) {
  const result = await db.query<{ chunk_index: number; text: string; revision_id: string }>(
    `select chunk_index, text, revision_id from knowledge_chunks where entry_id = $1 order by chunk_index asc`,
    [entryId]
  );
  return result.rows;
}

describe.skipIf(!databaseAvailable)("knowledge index lifecycle", () => {
  let db: InMemoryTestDatabase;
  let objectStore: ObjectStore;
  const editor = makeAuth(EDITOR, viewEdit);
  const manager = makeAuth(MANAGER, manageAll);
  const viewer = makeAuth(VIEWER, viewOnly);

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    objectStore = createFakeObjectStore();
    await db.query(`insert into organizations (id, name) values ($1, $1) on conflict (id) do nothing`, [ORG_ID]);
    for (const userId of [EDITOR, MANAGER, VIEWER]) {
      await db.query(
        `insert into users (id, organization_id, name, title, is_active) values ($1, $2, $1, 'Engineer', true)
         on conflict (id) do update set organization_id = excluded.organization_id`,
        [userId, ORG_ID]
      );
    }
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("publish enqueues, the worker builds chunks with entry/revision identity, and drafts never index", async () => {
    const draft = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "快充温控调参经验",
      tags: ["快充"],
      contentMarkdown: "# 背景\n\n当电池温度超过 45 度时,按 0.5A 步长下调快充电流。"
    });

    // Draft creation never touches the index queue (published-only invariant).
    expect(await getIndexStatusForEntry(db, { entryId: draft.id, organizationId: ORG_ID })).toBeNull();
    expect(await listChunks(db, draft.id)).toHaveLength(0);

    const published = await publishKnowledgeEntry(db, editor, draft.id);
    const queued = await getIndexStatusForEntry(db, { entryId: draft.id, organizationId: ORG_ID });
    expect(queued).toMatchObject({ status: "pending" });

    await drainIndexQueue(db);

    const indexed = await getIndexStatusForEntry(db, { entryId: draft.id, organizationId: ORG_ID });
    expect(indexed).toMatchObject({
      status: "succeeded",
      error: null,
      indexedRevisionId: published.headRevisionId,
      indexedRevisionNumber: 1,
      embeddedChunkCount: 0
    });
    expect(indexed!.chunkCount).toBeGreaterThan(0);

    const chunks = await listChunks(db, draft.id);
    expect(chunks.length).toBe(indexed!.chunkCount);
    expect(chunks[0].revision_id).toBe(published.headRevisionId);
    expect(chunks.map((chunk) => chunk.text).join("\n")).toContain("45 度");
  });

  it("edit-of-published re-enqueues and reindexes the new head revision; archive removes chunks; restore re-adds them", async () => {
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "生命周期条目",
      tags: [],
      contentMarkdown: "初版内容:阈值 45 度。"
    });
    await publishKnowledgeEntry(db, editor, entry.id);
    await drainIndexQueue(db);

    const updated = await updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
      expectedHeadRevisionNumber: 1,
      contentMarkdown: "第二版内容:阈值改为 48 度并新增回滞。"
    });
    expect(await getIndexStatusForEntry(db, { entryId: entry.id, organizationId: ORG_ID })).toMatchObject({
      status: "pending"
    });
    await drainIndexQueue(db);

    const reindexed = await getIndexStatusForEntry(db, { entryId: entry.id, organizationId: ORG_ID });
    expect(reindexed).toMatchObject({ status: "succeeded", indexedRevisionNumber: 2, indexedRevisionId: updated.headRevisionId });
    expect((await listChunks(db, entry.id)).map((chunk) => chunk.text).join("\n")).toContain("48 度");

    await archiveKnowledgeEntry(db, editor, entry.id);
    await drainIndexQueue(db);
    // Archive removes the entry from the searchable set.
    expect(await listChunks(db, entry.id)).toHaveLength(0);
    expect(await getIndexStatusForEntry(db, { entryId: entry.id, organizationId: ORG_ID })).toMatchObject({
      status: "succeeded",
      chunkCount: 0
    });

    await restoreKnowledgeEntry(db, editor, entry.id);
    await drainIndexQueue(db);
    expect((await listChunks(db, entry.id)).length).toBeGreaterThan(0);
  });

  it("draft edits do not enqueue index refreshes", async () => {
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "草稿条目",
      tags: [],
      contentMarkdown: "尚未发布。"
    });
    await updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
      expectedHeadRevisionNumber: 1,
      contentMarkdown: "还是草稿。"
    });
    expect(await getIndexStatusForEntry(db, { entryId: entry.id, organizationId: ORG_ID })).toBeNull();
  });

  it("published file entries index their extracted text; failed extraction surfaces as an honest index failure", async () => {
    const good = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "file",
      title: "SC8562 手册",
      tags: ["硬件"],
      file: {
        fileName: "sc8562.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("charge pump ratio switching thresholds", "utf8").toString("base64")
      }
    });
    await publishKnowledgeEntry(db, editor, good.id);
    await drainIndexQueue(db);
    expect((await listChunks(db, good.id)).map((chunk) => chunk.text).join(" ")).toContain("charge pump");

    const legacy = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "file",
      title: "旧版 doc",
      tags: [],
      file: {
        fileName: "legacy.doc",
        contentType: "application/msword",
        contentBase64: Buffer.from("legacy binary", "utf8").toString("base64")
      }
    });
    await publishKnowledgeEntry(db, editor, legacy.id);
    await drainIndexQueue(db);

    const failed = await getIndexStatusForEntry(db, { entryId: legacy.id, organizationId: ORG_ID });
    expect(failed).toMatchObject({ status: "failed", chunkCount: 0 });
    expect(failed!.error).toContain("Text extraction failed");
  });

  it("hybrid search stays honest in FTS-only mode and hits chunk-backed published entries", async () => {
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "温控检索条目",
      tags: [],
      contentMarkdown: "当电池温度超过 45 度时降低快充电流。"
    });
    await publishKnowledgeEntry(db, editor, entry.id);
    await drainIndexQueue(db);

    const response = await searchKnowledge(db, viewer, { q: "温度" });
    expect(response.items.map((item) => item.entryId)).toContain(entry.id);
    expect(response.retrieval.embeddingConfigured).toBe(false);
    expect(response.retrieval.mode).toBe("fts_only");
  });

  it("getPublishedKnowledgeDocument only ever surfaces published entries — drafts stay invisible even to their owner", async () => {
    const draft = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "机密草稿",
      tags: [],
      contentMarkdown: "尚未发布的机密内容。"
    });

    await expect(getPublishedKnowledgeDocument(db, editor, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    await publishKnowledgeEntry(db, editor, draft.id);
    const document = await getPublishedKnowledgeDocument(db, viewer, draft.id);
    expect(document.entry.id).toBe(draft.id);
    expect(document.contentText).toContain("机密内容");

    await archiveKnowledgeEntry(db, editor, draft.id);
    await expect(getPublishedKnowledgeDocument(db, viewer, draft.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("index health, retry, and rebuild are manage-gated and audited", async () => {
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "健康面板条目",
      tags: [],
      contentMarkdown: "内容。"
    });
    await publishKnowledgeEntry(db, editor, entry.id);
    await drainIndexQueue(db);

    await expect(getKnowledgeIndexHealth(db, viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(retryKnowledgeEntryIndex(db, viewer, entry.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(rebuildKnowledgeIndex(db, viewer)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const health = await getKnowledgeIndexHealth(db, manager);
    expect(health.retrieval).toMatchObject({ mode: "fts_only", embeddingConfigured: false });
    const item = health.items.find((candidate) => candidate.entryId === entry.id);
    expect(item).toMatchObject({ status: "succeeded", title: "健康面板条目", entryStatus: "published" });

    await retryKnowledgeEntryIndex(db, manager, entry.id, { requestId: "req-retry" });
    expect(await getIndexStatusForEntry(db, { entryId: entry.id, organizationId: ORG_ID })).toMatchObject({
      status: "pending"
    });

    const { enqueued } = await rebuildKnowledgeIndex(db, manager, { requestId: "req-rebuild" });
    expect(enqueued).toBeGreaterThanOrEqual(1);

    const audits = await db.query<{ kind: string }>(
      `select kind from audit_events where organization_id = $1 and kind in ('knowledge-index-retry', 'knowledge-index-rebuild')`,
      [ORG_ID]
    );
    expect(audits.rows.map((row) => row.kind).sort()).toEqual(["knowledge-index-rebuild", "knowledge-index-retry"]);

    await drainIndexQueue(db);
  });

  it("worker reports idle on an empty queue and recovers stale processing rows", async () => {
    expect(await processNextKnowledgeIndexJob({ db })).toBe("idle");

    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "markdown",
      title: "过期领用",
      tags: [],
      contentMarkdown: "内容。"
    });
    await publishKnowledgeEntry(db, editor, entry.id);
    // Simulate a crashed worker: claimed long ago, never finished.
    await db.query(
      `update knowledge_index_status set status = 'processing', started_at = now() - interval '10 minutes' where entry_id = $1`,
      [entry.id]
    );

    expect(await processNextKnowledgeIndexJob({ db })).toBe("processed");
    expect(await getIndexStatusForEntry(db, { entryId: entry.id, organizationId: ORG_ID })).toMatchObject({
      status: "succeeded"
    });
  });
});
