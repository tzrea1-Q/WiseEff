import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerKnowledgeRoutes } from "./routes";
import * as service from "./service";
import type { KnowledgeEntryDto } from "./types";

vi.mock("./service", () => ({
  archiveKnowledgeEntry: vi.fn(),
  createKnowledgeEntry: vi.fn(),
  getKnowledgeEntry: vi.fn(),
  getKnowledgeFileContent: vi.fn(),
  hardDeleteKnowledgeEntry: vi.fn(),
  listKnowledgeEntries: vi.fn(),
  listKnowledgeRevisions: vi.fn(),
  publishKnowledgeEntry: vi.fn(),
  restoreKnowledgeEntry: vi.fn(),
  restoreKnowledgeRevision: vi.fn(),
  searchKnowledge: vi.fn(),
  updateKnowledgeEntry: vi.fn()
}));

const ENTRY_ID = "0a2b4d80-1111-4222-8333-444455556666";
const REVISION_ID = "0a2b4d80-7777-4888-8999-aaaabbbbcccc";

function makeAuth(): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: null, roleId: "software-user" }],
    permissions: ["knowledge:view", "knowledge:edit"]
  };
}

function makeDb(): Database {
  return {
    query: vi.fn(),
    transaction: vi.fn()
  };
}

function makeObjectStore(): ObjectStore {
  return {
    put: vi.fn(),
    get: vi.fn()
  };
}

function entryRecord(overrides: Partial<KnowledgeEntryDto> = {}): KnowledgeEntryDto {
  return {
    id: ENTRY_ID,
    organizationId: "org-1",
    title: "Fast charge tuning",
    contentForm: "markdown",
    status: "draft",
    tags: ["tuning"],
    sourceType: "human",
    sourceSessionId: null,
    createdByUserId: "user-1",
    headRevisionId: REVISION_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-08-12T08:00:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: "body",
    file: null,
    ...overrides
  };
}

function makeServer(options: { db?: Database; objectStore?: ObjectStore; auth?: AuthContext } = {}) {
  const router = createRouter();
  registerKnowledgeRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    textExtractor: { extract: vi.fn() },
    getCurrentAuthContext: () => options.auth ?? makeAuth()
  });
  return createHttpServer(router);
}

describe("knowledge routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /api/v1/knowledge/entries validates and delegates to create", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    const item = entryRecord();
    vi.mocked(service.createKnowledgeEntry).mockResolvedValue(item);

    const response = await requestJson<{ item: typeof item }>(makeServer({ db, objectStore }), "/api/v1/knowledge/entries", {
      method: "POST",
      body: JSON.stringify({ contentForm: "markdown", title: "Fast charge tuning", tags: ["tuning"], contentMarkdown: "body" })
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ item });
    expect(service.createKnowledgeEntry).toHaveBeenCalledWith(
      db,
      objectStore,
      expect.anything(),
      makeAuth(),
      { contentForm: "markdown", title: "Fast charge tuning", tags: ["tuning"], contentMarkdown: "body" },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/knowledge/entries rejects an invalid body before the service", async () => {
    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db: makeDb(), objectStore: makeObjectStore() }),
      "/api/v1/knowledge/entries",
      { method: "POST", body: JSON.stringify({ contentForm: "markdown" }) }
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(service.createKnowledgeEntry).not.toHaveBeenCalled();
  });

  it("GET /api/v1/knowledge/entries parses filters", async () => {
    const db = makeDb();
    vi.mocked(service.listKnowledgeEntries).mockResolvedValue([entryRecord()]);

    const response = await requestJson<{ items: KnowledgeEntryDto[] }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/entries?status=draft&tag=tuning&limit=10"
    );

    expect(response.status).toBe(200);
    expect(service.listKnowledgeEntries).toHaveBeenCalledWith(db, makeAuth(), {
      status: "draft",
      tag: "tuning",
      limit: 10
    });
  });

  it("GET /api/v1/knowledge/search requires q and delegates", async () => {
    const db = makeDb();
    vi.mocked(service.searchKnowledge).mockResolvedValue([]);

    const missing = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/search"
    );
    expect(missing.status).toBe(400);

    const response = await requestJson<{ items: unknown[] }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/search?q=%E5%BF%AB%E5%85%85"
    );
    expect(response.status).toBe(200);
    expect(service.searchKnowledge).toHaveBeenCalledWith(db, makeAuth(), { q: "快充" });
  });

  it("PATCH /api/v1/knowledge/entries/:entryId surfaces structured 409 conflicts", async () => {
    const db = makeDb();
    vi.mocked(service.updateKnowledgeEntry).mockRejectedValue(
      new ApiError("CONFLICT", "Knowledge entry was changed by another save.", 409, {
        code: "knowledge-revision-conflict",
        expectedHeadRevisionNumber: 1,
        currentHeadRevisionNumber: 2
      })
    );

    const response = await requestJson<{ error: { code: string; details: Record<string, unknown> } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}`,
      { method: "PATCH", body: JSON.stringify({ expectedHeadRevisionNumber: 1, contentMarkdown: "stale" }) }
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("CONFLICT");
    expect(response.body.error.details).toMatchObject({ code: "knowledge-revision-conflict" });
  });

  it("routes publish/archive/restore lifecycle actions", async () => {
    const db = makeDb();
    const item = entryRecord({ status: "published" });
    vi.mocked(service.publishKnowledgeEntry).mockResolvedValue(item);
    vi.mocked(service.archiveKnowledgeEntry).mockResolvedValue(entryRecord({ status: "archived" }));
    vi.mocked(service.restoreKnowledgeEntry).mockResolvedValue(item);

    const server = () => makeServer({ db, objectStore: makeObjectStore() });
    const publish = await requestJson<{ item: KnowledgeEntryDto }>(server(), `/api/v1/knowledge/entries/${ENTRY_ID}/publish`, {
      method: "POST",
      body: "{}"
    });
    expect(publish.status).toBe(200);
    expect(service.publishKnowledgeEntry).toHaveBeenCalledWith(db, makeAuth(), ENTRY_ID, { requestId: "test-request" });

    const archive = await requestJson<{ item: KnowledgeEntryDto }>(server(), `/api/v1/knowledge/entries/${ENTRY_ID}/archive`, {
      method: "POST",
      body: "{}"
    });
    expect(archive.status).toBe(200);

    const restore = await requestJson<{ item: KnowledgeEntryDto }>(server(), `/api/v1/knowledge/entries/${ENTRY_ID}/restore`, {
      method: "POST",
      body: "{}"
    });
    expect(restore.status).toBe(200);
  });

  it("DELETE /api/v1/knowledge/entries/:entryId delegates to hard delete", async () => {
    const db = makeDb();
    vi.mocked(service.hardDeleteKnowledgeEntry).mockResolvedValue();

    const response = await requestJson<{ deleted: boolean }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}`,
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: true });
    expect(service.hardDeleteKnowledgeEntry).toHaveBeenCalledWith(db, makeAuth(), ENTRY_ID, { requestId: "test-request" });
  });

  it("POST revision restore validates the expected head revision", async () => {
    const db = makeDb();
    vi.mocked(service.restoreKnowledgeRevision).mockResolvedValue(entryRecord({ headRevisionNumber: 3 }));

    const invalid = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}/revisions/${REVISION_ID}/restore`,
      { method: "POST", body: "{}" }
    );
    expect(invalid.status).toBe(400);

    const response = await requestJson<{ item: KnowledgeEntryDto }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}/revisions/${REVISION_ID}/restore`,
      { method: "POST", body: JSON.stringify({ expectedHeadRevisionNumber: 2 }) }
    );
    expect(response.status).toBe(200);
    expect(service.restoreKnowledgeRevision).toHaveBeenCalledWith(
      db,
      makeAuth(),
      ENTRY_ID,
      REVISION_ID,
      { expectedHeadRevisionNumber: 2 },
      { requestId: "test-request" }
    );
  });

  it("GET file content returns bytes with the stored content type", async () => {
    const db = makeDb();
    const objectStore = makeObjectStore();
    vi.mocked(service.getKnowledgeFileContent).mockResolvedValue({
      file: {
        id: "file-1",
        entryId: ENTRY_ID,
        organizationId: "org-1",
        storageKey: "org-1/abc-file.pdf",
        fileName: "file.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        checksum: "abc",
        extractionStatus: "succeeded",
        extractionError: null,
        createdAt: "2026-08-12T08:00:00.000Z",
        updatedAt: "2026-08-12T08:00:00.000Z"
      },
      bytes: Buffer.from("pdf")
    });

    const response = await requestJson<never>(
      makeServer({ db, objectStore }),
      `/api/v1/knowledge/entries/${ENTRY_ID}/file/content`
    );

    expect(response.status).toBe(200);
    expect(service.getKnowledgeFileContent).toHaveBeenCalledWith(db, objectStore, makeAuth(), ENTRY_ID);
  });

  it("maps service NOT_FOUND to a 404 envelope", async () => {
    const db = makeDb();
    vi.mocked(service.getKnowledgeEntry).mockRejectedValue(
      new ApiError("NOT_FOUND", "Knowledge entry was not found.", 404, { entryId: ENTRY_ID })
    );

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}`
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
