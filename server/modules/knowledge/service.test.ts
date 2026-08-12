import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import { ApiError } from "../../shared/http/errors";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createDefaultKnowledgeTextExtractor } from "./extraction";
import {
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  getKnowledgeEntry,
  getKnowledgeFileContent,
  hardDeleteKnowledgeEntry,
  listKnowledgeEntries,
  listKnowledgeRevisions,
  publishKnowledgeEntry,
  restoreKnowledgeEntry,
  restoreKnowledgeRevision,
  searchKnowledge,
  updateKnowledgeEntry
} from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-kb-service";
const OTHER_ORG_ID = "org-kb-other";
const EDITOR_A = "user-kb-editor-a";
const EDITOR_B = "user-kb-editor-b";
const VIEWER = "user-kb-viewer";
const MANAGER = "user-kb-manager";
const OTHER_ORG_EDITOR = "user-kb-foreign";

const viewEdit: BackendPermission[] = ["knowledge:view", "knowledge:edit"];
const viewOnly: BackendPermission[] = ["knowledge:view"];
const manageAll: BackendPermission[] = ["knowledge:view", "knowledge:edit", "knowledge:manage"];

function makeAuth(userId: string, permissions: BackendPermission[], organizationId = ORG_ID): AuthContext {
  return {
    user: {
      id: userId,
      organizationId,
      name: userId,
      title: "Engineer",
      isActive: true
    },
    organization: { id: organizationId, name: organizationId },
    roles: [{ projectId: null, roleId: "hardware-user" }],
    permissions
  };
}

function createFakeObjectStore(): ObjectStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
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

async function seedUsers(db: InMemoryTestDatabase) {
  for (const [orgId, name] of [
    [ORG_ID, "KB Service Org"],
    [OTHER_ORG_ID, "KB Other Org"]
  ] as const) {
    await db.query(
      `insert into organizations (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name`,
      [orgId, name]
    );
  }
  for (const [userId, orgId] of [
    [EDITOR_A, ORG_ID],
    [EDITOR_B, ORG_ID],
    [VIEWER, ORG_ID],
    [MANAGER, ORG_ID],
    [OTHER_ORG_EDITOR, OTHER_ORG_ID]
  ] as const) {
    await db.query(
      `
      insert into users (id, organization_id, name, title, is_active)
      values ($1, $2, $1, 'Engineer', true)
      on conflict (id) do update set organization_id = excluded.organization_id
      `,
      [userId, orgId]
    );
  }
}

function markdownInput(overrides: Partial<{ title: string; tags: string[]; contentMarkdown: string }> = {}) {
  return {
    contentForm: "markdown" as const,
    title: overrides.title ?? `Fast charge tuning ${randomUUID().slice(0, 8)}`,
    tags: overrides.tags ?? ["project-aurora", "tuning"],
    contentMarkdown: overrides.contentMarkdown ?? "Increase fast charge current in 0.5A steps and watch NTC."
  };
}

async function listAuditEvents(db: InMemoryTestDatabase, entryId: string) {
  const result = await db.query<{ kind: string; action: string; severity: string; trace_id: string; metadata: Record<string, unknown> }>(
    `select kind, action, severity, trace_id, metadata from audit_events where organization_id = $1 and target_id = $2 order by created_at asc, kind asc`,
    [ORG_ID, entryId]
  );
  return result.rows;
}

describe.skipIf(!databaseAvailable)("knowledge service", () => {
  let db: InMemoryTestDatabase;
  let objectStore: ReturnType<typeof createFakeObjectStore>;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    objectStore = createFakeObjectStore();
    await seedUsers(db);
  });

  afterEach(async () => {
    await db.rollback();
  });

  it("creates a markdown draft with revision 1, audit evidence, and owner attribution", async () => {
    const auth = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, auth, markdownInput(), {
      requestId: "req-kb-create"
    });

    expect(entry.status).toBe("draft");
    expect(entry.contentForm).toBe("markdown");
    expect(entry.headRevisionNumber).toBe(1);
    expect(entry.sourceType).toBe("human");
    expect(entry.createdByUserId).toBe(EDITOR_A);
    expect(entry.contentMarkdown).toContain("fast charge current");

    const revisions = await listKnowledgeRevisions(db, auth, entry.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revisionNumber).toBe(1);

    const audits = await listAuditEvents(db, entry.id);
    expect(audits).toEqual([
      expect.objectContaining({ kind: "knowledge-entry-create", action: "create", trace_id: "req-kb-create" })
    ]);
  });

  it("denies create without knowledge:edit", async () => {
    await expect(
      createKnowledgeEntry(db, objectStore, extractor, makeAuth(VIEWER, viewOnly), markdownInput())
    ).rejects.toMatchObject({ code: "FORBIDDEN", details: { permission: "knowledge:edit" } });
  });

  it("keeps drafts and archived entries out of search; publishing is the only gate in", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const viewer = makeAuth(VIEWER, viewOnly);
    const entry = await createKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      markdownInput({ title: "Thermal derating case", contentMarkdown: "Derating threshold analysis for aurora." })
    );

    expect((await searchKnowledge(db, viewer, { q: "derating" })).items).toHaveLength(0);

    await publishKnowledgeEntry(db, editor, entry.id);
    const published = await searchKnowledge(db, viewer, { q: "derating" });
    expect(published.items).toHaveLength(1);
    expect(published.items[0].entryId).toBe(entry.id);
    expect(published.items[0].excerpt.length).toBeGreaterThan(0);
    expect(published.items[0].revisionId).toBeTruthy();
    // No embedding client configured: the response must honestly report FTS-only.
    expect(published.retrieval).toMatchObject({ mode: "fts_only", embeddingConfigured: false });

    await archiveKnowledgeEntry(db, editor, entry.id);
    expect((await searchKnowledge(db, viewer, { q: "derating" })).items).toHaveLength(0);

    await restoreKnowledgeEntry(db, editor, entry.id);
    expect((await searchKnowledge(db, viewer, { q: "derating" })).items).toHaveLength(1);
  });

  it("matches CJK queries through the trigram branch", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const viewer = makeAuth(VIEWER, viewOnly);
    const entry = await createKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      markdownInput({ title: "快充温控经验", contentMarkdown: "当电池温度超过 45 度时降低快充电流。" })
    );
    await publishKnowledgeEntry(db, editor, entry.id);

    const results = await searchKnowledge(db, viewer, { q: "温控" });
    expect(results.items.map((item) => item.entryId)).toContain(entry.id);

    const contentHit = await searchKnowledge(db, viewer, { q: "快充电流" });
    expect(contentHit.items.map((item) => item.entryId)).toContain(entry.id);
  });

  it("scopes list and search to the caller organization", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      markdownInput({ title: "Org isolation entry" })
    );
    await publishKnowledgeEntry(db, editor, entry.id);

    const foreign = makeAuth(OTHER_ORG_EDITOR, viewEdit, OTHER_ORG_ID);
    expect((await searchKnowledge(db, foreign, { q: "isolation" })).items).toHaveLength(0);
    expect((await listKnowledgeEntries(db, foreign)).map((item) => item.id)).not.toContain(entry.id);
    await expect(getKnowledgeEntry(db, foreign, entry.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hides drafts from other editors but shows them to the owner and managers", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput());

    const ownList = await listKnowledgeEntries(db, editor);
    expect(ownList.map((item) => item.id)).toContain(entry.id);

    const otherList = await listKnowledgeEntries(db, makeAuth(EDITOR_B, viewEdit));
    expect(otherList.map((item) => item.id)).not.toContain(entry.id);
    await expect(getKnowledgeEntry(db, makeAuth(EDITOR_B, viewEdit), entry.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });

    const managerList = await listKnowledgeEntries(db, makeAuth(MANAGER, manageAll));
    expect(managerList.map((item) => item.id)).toContain(entry.id);
  });

  it("edits published entries in place producing immutable revisions", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      markdownInput({ contentMarkdown: "original body" })
    );
    await publishKnowledgeEntry(db, editor, entry.id);

    const updated = await updateKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      entry.id,
      { expectedHeadRevisionNumber: 1, contentMarkdown: "revised body" },
      { requestId: "req-kb-update" }
    );

    expect(updated.status).toBe("published");
    expect(updated.headRevisionNumber).toBe(2);
    expect(updated.contentMarkdown).toBe("revised body");

    const revisions = await listKnowledgeRevisions(db, editor, entry.id);
    expect(revisions).toHaveLength(2);
    expect(revisions.find((revision) => revision.revisionNumber === 1)?.contentMarkdown).toBe("original body");
    expect(revisions.find((revision) => revision.revisionNumber === 2)?.contentMarkdown).toBe("revised body");
  });

  it("rejects stale saves with a structured 409 revision conflict", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput());
    await updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
      expectedHeadRevisionNumber: 1,
      contentMarkdown: "second save"
    });

    let conflict: ApiError | null = null;
    try {
      await updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
        expectedHeadRevisionNumber: 1,
        contentMarkdown: "stale save"
      });
    } catch (error) {
      conflict = error as ApiError;
    }

    expect(conflict).toBeInstanceOf(ApiError);
    expect(conflict?.code).toBe("CONFLICT");
    expect(conflict?.status).toBe(409);
    expect(conflict?.details).toMatchObject({
      code: "knowledge-revision-conflict",
      expectedHeadRevisionNumber: 1,
      currentHeadRevisionNumber: 2
    });

    const revisions = await listKnowledgeRevisions(db, editor, entry.id);
    expect(revisions).toHaveLength(2);
  });

  it("restores a prior revision as a new revision instead of rewriting history", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      markdownInput({ contentMarkdown: "v1 body" })
    );
    await updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
      expectedHeadRevisionNumber: 1,
      contentMarkdown: "v2 body"
    });

    const revisions = await listKnowledgeRevisions(db, editor, entry.id);
    const firstRevision = revisions.find((revision) => revision.revisionNumber === 1)!;

    const restored = await restoreKnowledgeRevision(db, editor, entry.id, firstRevision.id, {
      expectedHeadRevisionNumber: 2
    });

    expect(restored.headRevisionNumber).toBe(3);
    expect(restored.contentMarkdown).toBe("v1 body");

    const afterRestore = await listKnowledgeRevisions(db, editor, entry.id);
    expect(afterRestore).toHaveLength(3);
    expect(afterRestore.find((revision) => revision.revisionNumber === 3)?.restoredFromRevisionId).toBe(firstRevision.id);

    const audits = await listAuditEvents(db, entry.id);
    expect(audits.map((event) => event.kind)).toContain("knowledge-revision-restore");
  });

  it("blocks editing archived entries until they are restored", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput());
    await publishKnowledgeEntry(db, editor, entry.id);
    await archiveKnowledgeEntry(db, editor, entry.id);

    await expect(
      updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
        expectedHeadRevisionNumber: 1,
        contentMarkdown: "should fail"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("enforces publisher accountability: edit governs own entries only, manage governs any", async () => {
    const editorA = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editorA, markdownInput());

    // Non-owner editors cannot even see the draft, let alone publish it.
    await expect(publishKnowledgeEntry(db, makeAuth(EDITOR_B, viewEdit), entry.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });

    const manager = makeAuth(MANAGER, manageAll);
    const published = await publishKnowledgeEntry(db, manager, entry.id);
    expect(published.status).toBe("published");

    // Published entries are readable by everyone, but only owner/manage can archive.
    await expect(archiveKnowledgeEntry(db, makeAuth(EDITOR_B, viewEdit), entry.id)).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });

  it("rejects illegal lifecycle transitions", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput());

    await expect(archiveKnowledgeEntry(db, editor, entry.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(restoreKnowledgeEntry(db, editor, entry.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    await publishKnowledgeEntry(db, editor, entry.id);
    await expect(publishKnowledgeEntry(db, editor, entry.id)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("hard delete requires knowledge:manage and leaves audit evidence", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput());

    await expect(hardDeleteKnowledgeEntry(db, editor, entry.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
      details: { permission: "knowledge:manage" }
    });

    const manager = makeAuth(MANAGER, manageAll);
    await hardDeleteKnowledgeEntry(db, manager, entry.id, { requestId: "req-kb-delete" });

    await expect(getKnowledgeEntry(db, manager, entry.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const revisionCount = await db.query<{ count: string }>(
      `select count(*)::text as count from knowledge_revisions where entry_id = $1`,
      [entry.id]
    );
    expect(Number(revisionCount.rows[0].count)).toBe(0);

    const audits = await listAuditEvents(db, entry.id);
    expect(audits).toEqual([
      expect.objectContaining({ kind: "knowledge-entry-create" }),
      expect.objectContaining({ kind: "knowledge-entry-delete", action: "delete", severity: "High", trace_id: "req-kb-delete" })
    ]);
  });

  it("creates a file entry through the object store, extracts text, and makes it searchable after publish", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const viewer = makeAuth(VIEWER, viewOnly);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "file",
      title: "SC8562 datasheet notes",
      tags: ["hardware"],
      file: {
        fileName: "sc8562-notes.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("SC8562 charge pump ratio configuration guide", "utf8").toString("base64")
      }
    });

    expect(entry.contentForm).toBe("file");
    expect(entry.file?.extractionStatus).toBe("succeeded");
    expect(entry.file?.fileName).toBe("sc8562-notes.txt");
    expect(objectStore.objects.size).toBe(1);

    expect((await searchKnowledge(db, viewer, { q: "charge pump ratio" })).items).toHaveLength(0);
    await publishKnowledgeEntry(db, editor, entry.id);
    const results = await searchKnowledge(db, viewer, { q: "charge pump ratio" });
    expect(results.items.map((item) => item.entryId)).toContain(entry.id);

    const download = await getKnowledgeFileContent(db, objectStore, viewer, entry.id);
    expect(download.bytes.toString("utf8")).toContain("charge pump ratio");
  });

  it("records extraction failures honestly while keeping the entry durable", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "file",
      title: "Legacy doc upload",
      tags: [],
      file: {
        fileName: "legacy.doc",
        contentType: "application/msword",
        contentBase64: Buffer.from("legacy binary", "utf8").toString("base64")
      }
    });

    expect(entry.file?.extractionStatus).toBe("failed");
    expect(entry.file?.extractionError).toContain(".docx");

    const fetched = await getKnowledgeEntry(db, editor, entry.id);
    expect(fetched.file?.extractionStatus).toBe("failed");
  });

  it("replaces the file binary as a new revision without editing the old one", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const entry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "file",
      title: "Replaceable binary",
      tags: [],
      file: {
        fileName: "v1.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("first binary content", "utf8").toString("base64")
      }
    });

    const updated = await updateKnowledgeEntry(db, objectStore, extractor, editor, entry.id, {
      expectedHeadRevisionNumber: 1,
      file: {
        fileName: "v2.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("second binary content", "utf8").toString("base64")
      }
    });

    expect(updated.headRevisionNumber).toBe(2);
    expect(updated.file?.fileName).toBe("v2.txt");
    expect(updated.file?.extractionStatus).toBe("succeeded");
    expect(objectStore.objects.size).toBe(2);

    const revisions = await listKnowledgeRevisions(db, editor, entry.id);
    const first = revisions.find((revision) => revision.revisionNumber === 1);
    const second = revisions.find((revision) => revision.revisionNumber === 2);
    expect(first?.fileId).not.toBeNull();
    expect(second?.fileId).not.toBeNull();
    expect(first?.fileId).not.toBe(second?.fileId);
  });

  it("rejects cross-form payloads", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const markdownEntry = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput());
    await expect(
      updateKnowledgeEntry(db, objectStore, extractor, editor, markdownEntry.id, {
        expectedHeadRevisionNumber: 1,
        file: {
          fileName: "x.txt",
          contentType: "text/plain",
          contentBase64: Buffer.from("x", "utf8").toString("base64")
        }
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

    const fileEntry = await createKnowledgeEntry(db, objectStore, extractor, editor, {
      contentForm: "file",
      title: "File form entry",
      tags: [],
      file: {
        fileName: "y.txt",
        contentType: "text/plain",
        contentBase64: Buffer.from("y", "utf8").toString("base64")
      }
    });
    await expect(
      updateKnowledgeEntry(db, objectStore, extractor, editor, fileEntry.id, {
        expectedHeadRevisionNumber: 1,
        contentMarkdown: "not allowed"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("filters the entry list by status, tag, and content form", async () => {
    const editor = makeAuth(EDITOR_A, viewEdit);
    const draft = await createKnowledgeEntry(db, objectStore, extractor, editor, markdownInput({ tags: ["tag-a"] }));
    const publishedEntry = await createKnowledgeEntry(
      db,
      objectStore,
      extractor,
      editor,
      markdownInput({ tags: ["tag-b"] })
    );
    await publishKnowledgeEntry(db, editor, publishedEntry.id);

    const draftsOnly = await listKnowledgeEntries(db, editor, { status: "draft" });
    expect(draftsOnly.map((item) => item.id)).toContain(draft.id);
    expect(draftsOnly.map((item) => item.id)).not.toContain(publishedEntry.id);

    const tagFiltered = await listKnowledgeEntries(db, editor, { tag: "tag-b" });
    expect(tagFiltered.map((item) => item.id)).toEqual([publishedEntry.id]);

    const fileOnly = await listKnowledgeEntries(db, editor, { contentForm: "file" });
    expect(fileOnly.map((item) => item.id)).not.toContain(draft.id);
  });
});
