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
  addKnowledgeParameterReference: vi.fn(),
  archiveKnowledgeEntry: vi.fn(),
  createKnowledgeEntry: vi.fn(),
  distillKnowledgeFromLog: vi.fn(),
  distillKnowledgeFromReloadRun: vi.fn(),
  findRelatedKnowledgeForLog: vi.fn(),
  findRelatedKnowledgeForSpec: vi.fn(),
  getKnowledgeEntry: vi.fn(),
  getKnowledgeFileContent: vi.fn(),
  hardDeleteKnowledgeEntry: vi.fn(),
  listKnowledgeEntries: vi.fn(),
  listKnowledgeRevisions: vi.fn(),
  publishKnowledgeEntry: vi.fn(),
  rejectAgentKnowledgeDraft: vi.fn(),
  removeKnowledgeParameterReference: vi.fn(),
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
    sourceLogId: null,
    sourceReloadRunId: null,
    createdByUserId: "user-1",
    headRevisionId: REVISION_ID,
    headRevisionNumber: 1,
    createdAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-08-12T08:00:00.000Z",
    publishedAt: null,
    archivedAt: null,
    contentMarkdown: "body",
    file: null,
    parameterReferences: [],
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

  it("GET /api/v1/knowledge/search requires q, delegates, and reports the retrieval mode", async () => {
    const db = makeDb();
    vi.mocked(service.searchKnowledge).mockResolvedValue({
      items: [],
      retrieval: { mode: "fts_only", vectorAvailable: false, embeddingConfigured: false }
    });

    const missing = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/search"
    );
    expect(missing.status).toBe(400);

    const response = await requestJson<{ items: unknown[]; retrieval: { mode: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/search?q=%E5%BF%AB%E5%85%85"
    );
    expect(response.status).toBe(200);
    expect(response.body.retrieval).toMatchObject({ mode: "fts_only" });
    expect(service.searchKnowledge).toHaveBeenCalledWith(db, makeAuth(), { q: "快充" }, { embeddingClient: undefined });
  });

  it("GET /api/v1/knowledge/related-to-log requires logId, delegates, and reports the retrieval mode", async () => {
    const db = makeDb();
    vi.mocked(service.findRelatedKnowledgeForLog).mockResolvedValue({
      items: [],
      retrieval: { mode: "fts_only", vectorAvailable: false, embeddingConfigured: false }
    });

    const missing = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/related-to-log"
    );
    expect(missing.status).toBe(400);
    expect(service.findRelatedKnowledgeForLog).not.toHaveBeenCalled();

    const response = await requestJson<{ items: unknown[]; retrieval: { mode: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/related-to-log?logId=log-1&limit=3"
    );
    expect(response.status).toBe(200);
    expect(response.body.retrieval).toMatchObject({ mode: "fts_only" });
    expect(service.findRelatedKnowledgeForLog).toHaveBeenCalledWith(
      db,
      makeAuth(),
      { logId: "log-1", limit: 3 },
      { embeddingClient: undefined }
    );
  });

  it("GET /api/v1/knowledge/related-to-spec requires specId and delegates", async () => {
    const db = makeDb();
    vi.mocked(service.findRelatedKnowledgeForSpec).mockResolvedValue({ items: [] });

    const missing = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/related-to-spec"
    );
    expect(missing.status).toBe(400);
    expect(service.findRelatedKnowledgeForSpec).not.toHaveBeenCalled();

    const response = await requestJson<{ items: unknown[] }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/related-to-spec?specId=pspec%3Aabc&limit=5"
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [] });
    expect(service.findRelatedKnowledgeForSpec).toHaveBeenCalledWith(db, makeAuth(), {
      specId: "pspec:abc",
      limit: 5
    });
  });

  it("PUT and DELETE /api/v1/knowledge/entries/:entryId/parameter-references/:specId delegate with the raw spec id", async () => {
    const db = makeDb();
    const item = entryRecord({
      parameterReferences: [
        {
          specId: "pspec:abc",
          propertyKey: "charge_pump_ratio",
          displayName: "充电泵比率",
          driverModule: "SC8562",
          lifecycle: "active",
          createdByUserId: "user-1",
          createdAt: "2026-08-13T00:00:00.000Z"
        }
      ]
    });
    vi.mocked(service.addKnowledgeParameterReference).mockResolvedValue(item);
    vi.mocked(service.removeKnowledgeParameterReference).mockResolvedValue(entryRecord());

    const added = await requestJson<{ item: typeof item }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}/parameter-references/pspec%3Aabc`,
      { method: "PUT", body: JSON.stringify({}) }
    );
    expect(added.status).toBe(200);
    expect(added.body.item.parameterReferences).toHaveLength(1);
    expect(service.addKnowledgeParameterReference).toHaveBeenCalledWith(
      db,
      makeAuth(),
      { entryId: ENTRY_ID, specId: "pspec:abc" },
      expect.objectContaining({ requestId: expect.any(String) })
    );

    const removed = await requestJson<{ item: typeof item }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}/parameter-references/pspec%3Aabc`,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(200);
    expect(service.removeKnowledgeParameterReference).toHaveBeenCalledWith(
      db,
      makeAuth(),
      { entryId: ENTRY_ID, specId: "pspec:abc" },
      expect.objectContaining({ requestId: expect.any(String) })
    );
  });

  it("PATCH /api/v1/knowledge/entries/:entryId surfaces structured 409 conflicts", async () => {
    const db = makeDb();
    vi.mocked(service.updateKnowledgeEntry).mockRejectedValue(
      new ApiError("CONFLICT", "Knowledge entry was changed by another save.", {
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

  it("POST /api/v1/knowledge/distill-from-log validates the log id and delegates to distillation", async () => {
    const db = makeDb();
    const item = entryRecord({ sourceLogId: "log-1", tags: ["日志分析", "严重"] });
    vi.mocked(service.distillKnowledgeFromLog).mockResolvedValue(item);

    const missing = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/distill-from-log",
      { method: "POST", body: "{}" }
    );
    expect(missing.status).toBe(400);

    const response = await requestJson<{ item: KnowledgeEntryDto }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/distill-from-log",
      { method: "POST", body: JSON.stringify({ logId: "log-1" }) }
    );
    expect(response.status).toBe(201);
    expect(response.body.item.sourceLogId).toBe("log-1");
    expect(service.distillKnowledgeFromLog).toHaveBeenCalledWith(db, makeAuth(), { logId: "log-1" }, { requestId: "test-request" });
  });

  it("POST /api/v1/knowledge/distill-from-reload-run validates the run id and delegates to distillation", async () => {
    const db = makeDb();
    const item = entryRecord({ sourceReloadRunId: "run-1", tags: ["参数调试", "DTS重载", "不可验证"] });
    vi.mocked(service.distillKnowledgeFromReloadRun).mockResolvedValue(item);

    const missing = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/distill-from-reload-run",
      { method: "POST", body: "{}" }
    );
    expect(missing.status).toBe(400);

    const response = await requestJson<{ item: KnowledgeEntryDto }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/distill-from-reload-run",
      { method: "POST", body: JSON.stringify({ runId: "run-1" }) }
    );
    expect(response.status).toBe(201);
    expect(response.body.item.sourceReloadRunId).toBe("run-1");
    expect(service.distillKnowledgeFromReloadRun).toHaveBeenCalledWith(
      db,
      makeAuth(),
      { runId: "run-1" },
      { requestId: "test-request" }
    );
  });

  it("POST /api/v1/knowledge/entries/:entryId/reject delegates to the agent-draft reject", async () => {
    const db = makeDb();
    vi.mocked(service.rejectAgentKnowledgeDraft).mockResolvedValue(entryRecord({ status: "archived", sourceType: "agent" }));

    const response = await requestJson<{ item: KnowledgeEntryDto }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}/reject`,
      { method: "POST", body: "{}" }
    );

    expect(response.status).toBe(200);
    expect(response.body.item.status).toBe("archived");
    expect(service.rejectAgentKnowledgeDraft).toHaveBeenCalledWith(db, makeAuth(), ENTRY_ID, { requestId: "test-request" });
  });

  it("GET /api/v1/knowledge/entries accepts the sourceType filter", async () => {
    const db = makeDb();
    vi.mocked(service.listKnowledgeEntries).mockResolvedValue([]);

    const response = await requestJson<{ items: unknown[] }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      "/api/v1/knowledge/entries?status=draft&sourceType=agent"
    );

    expect(response.status).toBe(200);
    expect(service.listKnowledgeEntries).toHaveBeenCalledWith(db, makeAuth(), { status: "draft", sourceType: "agent" });
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
      new ApiError("NOT_FOUND", "Knowledge entry was not found.", { entryId: ENTRY_ID })
    );

    const response = await requestJson<{ error: { code: string } }>(
      makeServer({ db, objectStore: makeObjectStore() }),
      `/api/v1/knowledge/entries/${ENTRY_ID}`
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
