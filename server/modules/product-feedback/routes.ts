import { z } from "zod";

import type { AuthContext } from "../auth/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import {
  createProductFeedback,
  getProductFeedback,
  getProductFeedbackAttachmentContent,
  listProductFeedback,
  updateProductFeedback
} from "./service";
import {
  createProductFeedbackBodySchema,
  listProductFeedbackQuerySchema,
  patchProductFeedbackBodySchema
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

function requireDb(db: Database | undefined) {
  if (!db) {
    throw new ApiError("INTERNAL_ERROR", "Database adapter is required for product feedback routes.", 500);
  }

  return db;
}

function requireObjectStore(objectStore: ObjectStore | undefined) {
  if (!objectStore) {
    throw new ApiError("INTERNAL_ERROR", "Object store is required for product feedback routes.", 500);
  }

  return objectStore;
}

function flattenQuery(query: Record<string, string | string[]>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
}

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown, message = "Invalid product feedback route input.") {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", message, 400, { issues: parsed.error.issues });
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
    throw new ApiError("VALIDATION_FAILED", "Invalid product feedback cursor.", 400);
  }
}

async function getAuth(getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext, request: RouteRequest) {
  return getCurrentAuthContext(request);
}

export function registerProductFeedbackRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  router.post("/api/v1/product-feedback", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const body = parseWithSchema(createProductFeedbackBodySchema, request.body);
    const item = await createProductFeedback(db, objectStore, auth, body, { requestId: request.requestId });

    return { status: 201, body: { item } };
  });

  router.get("/api/v1/product-feedback", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const query = parseWithSchema(listProductFeedbackQuerySchema, flattenQuery(request.query));
    const result = await listProductFeedback(db, auth, {
      ...query,
      cursor: parseCursor(query.cursor)
    });

    return { status: 200, body: result };
  });

  router.get("/api/v1/product-feedback/:id", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const item = await getProductFeedback(db, auth, params.id);

    return { status: 200, body: { item } };
  });

  router.patch("/api/v1/product-feedback/:id", async (request) => {
    const db = requireDb(options.db);
    const auth = await getAuth(options.getCurrentAuthContext, request);
    const params = parseWithSchema(paramsWithFeedbackIdSchema, request.params);
    const body = parseWithSchema(patchProductFeedbackBodySchema, request.body);
    const item = await updateProductFeedback(db, auth, params.id, body, { requestId: request.requestId });

    return { status: 200, body: { item } };
  });

  router.get("/api/v1/product-feedback/:id/attachments/:attachmentId/content", async (request) => {
    const db = requireDb(options.db);
    const objectStore = requireObjectStore(options.objectStore);
    const auth = await getAuth(options.getCurrentAuthContext, request);
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
