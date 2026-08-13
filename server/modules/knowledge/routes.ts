import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { createDefaultKnowledgeTextExtractor, type KnowledgeTextExtractor } from "./extraction";
import type { KnowledgeEmbeddingClient } from "./indexing/embeddingClient";
import {
  addKnowledgeParameterReference,
  archiveKnowledgeEntry,
  createKnowledgeEntry,
  distillKnowledgeFromLog,
  findRelatedKnowledgeForLog,
  findRelatedKnowledgeForSpec,
  getKnowledgeEntry,
  getKnowledgeFileContent,
  getKnowledgeIndexHealth,
  hardDeleteKnowledgeEntry,
  listKnowledgeEntries,
  listKnowledgeRevisions,
  publishKnowledgeEntry,
  rebuildKnowledgeIndex,
  rejectAgentKnowledgeDraft,
  removeKnowledgeParameterReference,
  restoreKnowledgeEntry,
  restoreKnowledgeRevision,
  retryKnowledgeEntryIndex,
  searchKnowledge,
  updateKnowledgeEntry
} from "./service";
import {
  createKnowledgeEntryBodySchema,
  distillKnowledgeFromLogBodySchema,
  listKnowledgeEntriesQuerySchema,
  relatedKnowledgeForLogQuerySchema,
  relatedKnowledgeForSpecQuerySchema,
  restoreKnowledgeRevisionBodySchema,
  searchKnowledgeQuerySchema,
  updateKnowledgeEntryBodySchema
} from "./schemas";

const paramsWithEntryIdSchema = z.object({
  entryId: z.string().uuid()
});

const paramsWithRevisionIdSchema = paramsWithEntryIdSchema.extend({
  revisionId: z.string().uuid()
});

// parameter_specs.id is a text surrogate (e.g. "pspec:…"), not a uuid.
const paramsWithSpecIdSchema = paramsWithEntryIdSchema.extend({
  specId: z.string().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for knowledge routes.", 500);
  }
  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for knowledge routes.", 500);
  }
  return objectStore;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

function parseWithSchema<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
  message = "Invalid knowledge route input."
): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
  }
  return parsed.data;
}

export function registerKnowledgeRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    textExtractor?: KnowledgeTextExtractor;
    /** Optional embedding client; absent means FTS-only retrieval. */
    knowledgeEmbeddingClient?: KnowledgeEmbeddingClient;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  const extractor = options.textExtractor ?? createDefaultKnowledgeTextExtractor();
  const embeddingClient = options.knowledgeEmbeddingClient;

  router.post("/api/v1/knowledge/entries", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(createKnowledgeEntryBodySchema, request.body);
    const item = await createKnowledgeEntry(db, objectStore, extractor, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/knowledge/entries", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(listKnowledgeEntriesQuerySchema, flattenQuery(request.query));
    const items = await listKnowledgeEntries(db, auth, query);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/knowledge/distill-from-log", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const body = parseWithSchema(distillKnowledgeFromLogBodySchema, request.body);
    const item = await distillKnowledgeFromLog(db, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/knowledge/search", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(searchKnowledgeQuerySchema, flattenQuery(request.query));
    const result = await searchKnowledge(db, auth, query, { embeddingClient });

    return { status: 200, body: { items: result.items, retrieval: result.retrieval } };
  });

  router.get("/api/v1/knowledge/related-to-log", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(relatedKnowledgeForLogQuerySchema, flattenQuery(request.query));
    const result = await findRelatedKnowledgeForLog(db, auth, query, { embeddingClient });

    return { status: 200, body: { items: result.items, retrieval: result.retrieval } };
  });

  router.get("/api/v1/knowledge/related-to-spec", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(relatedKnowledgeForSpecQuerySchema, flattenQuery(request.query));
    const result = await findRelatedKnowledgeForSpec(db, auth, query);

    return { status: 200, body: { items: result.items } };
  });

  router.get("/api/v1/knowledge/index/status", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const health = await getKnowledgeIndexHealth(db, auth, { embeddingClient });

    return { status: 200, body: health };
  });

  router.post("/api/v1/knowledge/index/rebuild", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const result = await rebuildKnowledgeIndex(db, auth, { requestId: request.requestId });

    return { status: 200, body: result };
  });

  router.post("/api/v1/knowledge/entries/:entryId/index/retry", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    await retryKnowledgeEntryIndex(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { enqueued: true } };
  });

  router.get("/api/v1/knowledge/entries/:entryId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const item = await getKnowledgeEntry(db, auth, params.entryId);

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/knowledge/entries/:entryId", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const body = parseWithSchema(updateKnowledgeEntryBodySchema, request.body);
    const item = await updateKnowledgeEntry(db, objectStore, extractor, auth, params.entryId, body, {
      requestId: request.requestId
    });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/knowledge/entries/:entryId/publish", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const item = await publishKnowledgeEntry(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/knowledge/entries/:entryId/archive", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const item = await archiveKnowledgeEntry(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/knowledge/entries/:entryId/restore", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const item = await restoreKnowledgeEntry(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/knowledge/entries/:entryId/reject", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const item = await rejectAgentKnowledgeDraft(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/knowledge/entries/:entryId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    await hardDeleteKnowledgeEntry(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { deleted: true } };
  });

  router.put("/api/v1/knowledge/entries/:entryId/parameter-references/:specId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSpecIdSchema, request.params);
    const item = await addKnowledgeParameterReference(
      db,
      auth,
      { entryId: params.entryId, specId: params.specId },
      { requestId: request.requestId }
    );

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/knowledge/entries/:entryId/parameter-references/:specId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithSpecIdSchema, request.params);
    const item = await removeKnowledgeParameterReference(
      db,
      auth,
      { entryId: params.entryId, specId: params.specId },
      { requestId: request.requestId }
    );

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/knowledge/entries/:entryId/revisions", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const items = await listKnowledgeRevisions(db, auth, params.entryId);

    return { status: 200, body: { items } };
  });

  router.post("/api/v1/knowledge/entries/:entryId/revisions/:revisionId/restore", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithRevisionIdSchema, request.params);
    const body = parseWithSchema(restoreKnowledgeRevisionBodySchema, request.body);
    const item = await restoreKnowledgeRevision(db, auth, params.entryId, params.revisionId, body, {
      requestId: request.requestId
    });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/knowledge/entries/:entryId/file/content", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    const result = await getKnowledgeFileContent(db, objectStore, auth, params.entryId);

    return {
      status: 200,
      bytes: result.bytes,
      contentType: result.file.contentType,
      fileName: result.file.fileName
    };
  });
}
