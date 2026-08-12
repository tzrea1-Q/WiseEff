import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import { createDefaultKnowledgeTextExtractor, type KnowledgeTextExtractor } from "./extraction";
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
import {
  createKnowledgeEntryBodySchema,
  listKnowledgeEntriesQuerySchema,
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

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid knowledge route input.") {
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
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  const extractor = options.textExtractor ?? createDefaultKnowledgeTextExtractor();

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

  router.get("/api/v1/knowledge/search", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const query = parseWithSchema(searchKnowledgeQuerySchema, flattenQuery(request.query));
    const items = await searchKnowledge(db, auth, query);

    return { status: 200, body: { items } };
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

  router.delete("/api/v1/knowledge/entries/:entryId", async (request) => {
    const db = requireDb(options.db);
    const auth = await options.getCurrentAuthContext(request);
    const params = parseWithSchema(paramsWithEntryIdSchema, request.params);
    await hardDeleteKnowledgeEntry(db, auth, params.entryId, { requestId: request.requestId });

    return { status: 200, body: { deleted: true } };
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
