import { z } from "zod";
import { cleanupFeedbackAttachmentUploads } from "./attachmentUploads";
import { deleteProductFeedbackAttachment } from "./attachmentDeletion";

import type { AuthContext } from "../auth/types";
import { createUserInvocation } from "../auth/trustedInvocation";
import { resolveOperatingContext } from "../auth/operatingContext";
import { feedbackInvocation, withProductFeedbackInvocation } from "./scope";
import { listFeedbackHandovers, assignFeedbackResponsibility, feedbackHandoverBodySchema } from "./handover";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  appendProductFeedbackProgress,
  createProductFeedback,
  createProductFeedbackDraft,
  deleteProductFeedbackDraft,
  getMyProductFeedback,
  getMyProductFeedbackAttachmentContent,
  getProductFeedback,
  getProductFeedbackAttachmentContent,
  getProductFeedbackStats,
  listMyProductFeedback,
  listProductFeedback,
  listProductFeedbackAssignees,
  replyToProductFeedback,
  saveProductFeedbackDraft,
  submitProductFeedbackDraft,
  updateProductFeedback
} from "./service";
import {
  appendProductFeedbackProgressBodySchema,
  createProductFeedbackBodySchema,
  createProductFeedbackDraftBodySchema,
  listMyFeedbackQuerySchema,
  listProductFeedbackQuerySchema,
  patchProductFeedbackBodySchema,
  patchProductFeedbackDraftBodySchema,
  replyToProductFeedbackBodySchema,
  submitProductFeedbackDraftBodySchema
} from "./schemas";

const paramsWithFeedbackIdSchema = z.object({
  id: z.string().min(1)
});

const paramsWithAttachmentIdSchema = paramsWithFeedbackIdSchema.extend({
  attachmentId: z.string().min(1)
});

const cursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1)
});

const myCursorSchema = z.object({
  updatedAt: z.string().datetime(),
  id: z.string().min(1)
});

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for product feedback routes.");
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for product feedback routes.");
  }

  return objectStore;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid product feedback route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, { issues: parsed.error.issues });
  }

  return parsed.data;
}

function parseCursor(cursor: string | undefined) {
  if (!cursor) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return parseWithSchema(cursorSchema, payload);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("VALIDATION_FAILED", "Invalid product feedback cursor.");
  }
}

function parseMyCursor(cursor: string | undefined) {
  if (!cursor) {
    return undefined;
  }

  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return parseWithSchema(myCursorSchema, payload);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("VALIDATION_FAILED", "Invalid product feedback cursor.");
  }
}

async function getAuth(getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext, request: RouteRequest, db?: Database) {
  const auth = await getCurrentAuthContext(request);
  const { organizationId } = parseWithSchema(z.object({ organizationId: z.string().trim().min(1).max(200).optional() }), flattenQuery(request.query));
  const invocation = createUserInvocation(auth);
  return withProductFeedbackInvocation(auth, organizationId === undefined ? invocation : await resolveOperatingContext(requireDb(db), invocation, organizationId));
}

export function registerProductFeedbackRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.get("/api/v1/product-feedback/handovers", async request => ({ status: 200, body: await listFeedbackHandovers(requireDb(options.db), await getAuth(options.getCurrentAuthContext, request, options.db)) }));
  router.patch("/api/v1/product-feedback/handovers/:id", async request => {
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db), { id } = parseWithSchema(z.object({ id: z.string().uuid() }), request.params);
    await assignFeedbackResponsibility(requireDb(options.db), auth, id, parseWithSchema(feedbackHandoverBodySchema, request.body), request.requestId);
    return { status: 200, body: { ok: true } };
  });
  router.post("/api/v1/product-feedback", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const body = parseWithSchema(createProductFeedbackBodySchema, request.body);
    const item = await createProductFeedback(db, objectStore, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/product-feedback/mine", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const query = parseWithSchema(listMyFeedbackQuerySchema, flattenQuery(request.query));
    const result = await listMyProductFeedback(db, auth, {
      ...query,
      cursor: parseMyCursor(query.cursor)
    });

    return { status: 200, body: {
      ...result,
      nextCursor: result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url") : null
    } };
  });

  router.post("/api/v1/product-feedback/mine/attachment-cleanup", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    return { status: 200, body: await cleanupFeedbackAttachmentUploads(requireDb(options.db), requireObjectStore(options.objectStore), auth) };
  });

  router.delete("/api/v1/product-feedback/:id/attachments/:attachmentId", async (request) => {
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(z.object({ id: z.string().uuid(), attachmentId: z.string().uuid() }), request.params);
    return { status: 200, body: await deleteProductFeedbackAttachment(requireDb(options.db), requireObjectStore(options.objectStore), auth, params.id, params.attachmentId, feedbackInvocation(auth), request.requestId) };
  });

  router.get("/api/v1/product-feedback/mine/:id", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const item = await getMyProductFeedback(db, auth, params.id);

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/product-feedback/mine/:id/replies", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const body = parseWithSchema(replyToProductFeedbackBodySchema, request.body);
    const item = await replyToProductFeedback(db, objectStore, auth, params.id, body, { requestId: request.requestId });
    return { status: 201, body: { item } };
  });

  router.get("/api/v1/product-feedback/mine/:id/attachments/:attachmentId/content", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithAttachmentIdSchema, request.params);
    const result = await getMyProductFeedbackAttachmentContent(db, objectStore, auth, params.id, params.attachmentId);

    return {
      status: 200,
      bytes: result.bytes,
      contentType: result.attachment.contentType,
      fileName: result.attachment.fileName
    };
  });

  router.post("/api/v1/product-feedback/drafts", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const body = parseWithSchema(createProductFeedbackDraftBodySchema, request.body ?? {});
    const item = await createProductFeedbackDraft(db, objectStore, auth, body);

    return { status: 201, body: { item } };
  });

  router.patch("/api/v1/product-feedback/drafts/:id", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const body = parseWithSchema(patchProductFeedbackDraftBodySchema, request.body ?? {});
    const item = await saveProductFeedbackDraft(db, objectStore, auth, params.id, body);

    return { status: 200, body: { item } };
  });

  router.delete("/api/v1/product-feedback/drafts/:id", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const result = await deleteProductFeedbackDraft(db, objectStore, auth, params.id);

    return { status: 200, body: result };
  });

  router.post("/api/v1/product-feedback/drafts/:id/submit", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const body = parseWithSchema(submitProductFeedbackDraftBodySchema, request.body ?? {});
    const item = await submitProductFeedbackDraft(db, auth, params.id, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/product-feedback", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const query = parseWithSchema(listProductFeedbackQuerySchema, flattenQuery(request.query));
    const result = await listProductFeedback(db, auth, {
      ...query,
      cursor: parseCursor(query.cursor)
    });

    return { status: 200, body: {
      ...result,
      nextCursor: result.nextCursor ? Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url") : null
    } };
  });

  router.get("/api/v1/product-feedback/stats", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const stats = await getProductFeedbackStats(db, auth);

    return { status: 200, body: stats };
  });

  router.get("/api/v1/product-feedback/assignees", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    return { status: 200, body: await listProductFeedbackAssignees(db, auth) };
  });

  router.get("/api/v1/product-feedback/:id", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const item = await getProductFeedback(db, auth, params.id);

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/product-feedback/:id", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const body = parseWithSchema(patchProductFeedbackBodySchema, request.body);
    const item = await updateProductFeedback(db, auth, params.id, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.post("/api/v1/product-feedback/:id/progress", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const body = parseWithSchema(appendProductFeedbackProgressBodySchema, request.body ?? {});
    const item = await appendProductFeedbackProgress(db, auth, params.id, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/product-feedback/:id/attachments/:attachmentId/content", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request, options.db);
    const params = parseWithSchema(paramsWithAttachmentIdSchema, request.params);
    const result = await getProductFeedbackAttachmentContent(db, objectStore, auth, params.id, params.attachmentId);

    return {
      status: 200,
      bytes: result.bytes,
      contentType: result.attachment.contentType,
      fileName: result.attachment.fileName
    };
  });
}

